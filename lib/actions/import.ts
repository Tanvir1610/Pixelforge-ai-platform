"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { hasOrgRole, requireOrgRole, requireSession } from "@/lib/auth/session";
import { startAnalysisRun } from "@/lib/repositories/generation";
import { ingestFigmaFile } from "@/lib/figma/ingest";
import { parseFigmaUrl } from "@/lib/figma/url";
import { beginFigmaConnect, isFigmaOauthConfigured } from "@/lib/figma/oauth";
import { FigmaTokenError, savePersonalToken, verifyPersonalToken } from "@/lib/figma/personal-token";
import { classifyUpload, ingestImage, storeUpload, UNSUPPORTED_MESSAGE } from "@/lib/figma/image-ingest";
import { isInferenceConfigured } from "@/lib/ai/bootstrap";
import { markRun, markStep } from "@/lib/repositories/generation";
import { fieldErrors, figmaUrlSchema } from "@/lib/validation/schemas";
import { z } from "zod";

export interface ImportState {
  errors?: Record<string, string>;
  message?: string;
  runId?: string;
  projectSlug?: string;
}

const importSchema = z.object({
  projectId: z.string().uuid("Pick a project first."),
  url: figmaUrlSchema,
});

/**
 * Resolves the Figma credential for this organization.
 *
 * Reads `figma_connections` with the service role because that table has no
 * client policy at all — a browser session can learn that a connection exists,
 * never the token. Falls back to a personal access token in development.
 */
async function resolveFigmaToken(
  organizationId: string,
): Promise<{ accessToken: string; tokenKind: "oauth" | "personal" } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("figma_connections")
    .select("access_token, expires_at, revoked_at, token_kind")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (data?.access_token) {
    const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
    // The kind is read, not assumed: OAuth sends a bearer and a personal token
    // sends X-Figma-Token, and the wrong one comes back as a bare 401.
    if (!expired) return { accessToken: data.access_token, tokenKind: data.token_kind ?? "oauth" };
  }

  const personal = process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  if (personal) return { accessToken: personal, tokenKind: "personal" };

  return null;
}

/**
 * Imports a Figma file into a project.
 *
 * The run row is created before any network call so the analysis screen has
 * something to subscribe to immediately. Ingestion is then awaited — moving it
 * to a queue worker is a Phase 5 change that touches only this function.
 */
export async function importFigmaFileAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const parsed = importSchema.safeParse({
    projectId: formData.get("projectId"),
    url: formData.get("url"),
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const ref = parseFigmaUrl(parsed.data.url);
  if (!ref) return { errors: { url: "That doesn't look like a Figma file URL." } };

  try {
    const session = await requireOrgRole("developer");

    const credential = await resolveFigmaToken(session.organization.id);
    if (!credential) {
      return { message: "Connect your Figma account before importing, or set FIGMA_PERSONAL_ACCESS_TOKEN locally." };
    }

    // Opening the run FIRST is deliberate. It goes through the user's RLS-scoped
    // client, so it is the step that proves this caller may touch this project.
    // The service-role write below has no such check, and running it first let a
    // developer in one organization set the status of any project in any other
    // simply by posting its id.
    const runId = await startAnalysisRun(parsed.data.projectId, "import");

    const supabase = createServiceClient();
    await supabase.from("projects").update({ status: "importing" }).eq("id", parsed.data.projectId);

    const outcome = await ingestFigmaFile({
      projectId: parsed.data.projectId,
      runId,
      ref,
      sourceUrl: parsed.data.url,
      accessToken: credential.accessToken,
      tokenKind: credential.tokenKind,
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/analysis");

    if (!outcome.ok) return { runId, message: outcome.errorMessage };
    return { runId };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "The import could not be started." };
  }
}

/**
 * Starts the Figma connect flow.
 *
 * A form action rather than an onClick, so the button works before hydration.
 *
 * `redirect` works by throwing, so every call to it here sits outside the try
 * below — a catch meant for real failures must never swallow a redirect. That
 * also avoids reaching for Next's internal `isRedirectError`, which is not a
 * public API and moves between versions.
 */
export async function connectFigmaAction(): Promise<void> {
  // Outside the try: requireSession redirects to /login, and that has to
  // propagate rather than be reported as a failed connection.
  const session = await requireSession();

  if (!hasOrgRole(session, "developer")) {
    redirect("/dashboard/import?connect_error=forbidden");
  }

  if (!isFigmaOauthConfigured()) {
    redirect("/dashboard/import?connect_error=not_configured");
  }

  let destination: string | null = null;
  try {
    destination = await beginFigmaConnect({
      organizationId: session.organization.id,
      userId: session.user.id,
      origin: await connectOrigin(),
      redirectPath: "/dashboard/import",
    });
  } catch (error) {
    console.error("[connect:figma:begin]", error);
  }

  redirect(destination ?? "/dashboard/import?connect_error=begin_failed");
}

/**
 * The origin Figma is told to return to.
 *
 * Configured value first: behind a proxy the request's own origin is the Host
 * header, and a redirect_uri built from a header a caller controls is not one
 * to hand an OAuth provider.
 */
async function connectOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request's own host.
    }
  }
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${protocol}://${host}`;
}

/**
 * Importing an uploaded screenshot.
 *
 * The drop zone listed four extensions and its file input had no handler at
 * all, so every one of them did nothing. A screenshot has no layer tree, so
 * this is a vision inference rather than a read — weaker than the Figma URL
 * path by nature, and recorded as such on every node it produces.
 */
export async function importImageAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  const projectId = formData.get("projectId");

  if (!(file instanceof File) || file.size === 0) {
    return { message: "Choose an image to import." };
  }
  if (typeof projectId !== "string" || !projectId) {
    return { message: "Create a project first — an import has to land somewhere." };
  }

  const kind = classifyUpload(file.name);
  if (kind === "unsupported") {
    return { message: UNSUPPORTED_MESSAGE };
  }

  try {
    const session = await requireOrgRole("developer");

    // Opened through the RLS-scoped client, so this is also the check that the
    // caller may touch this project at all.
    const runId = await startAnalysisRun(projectId, "import", IMAGE_IMPORT_STEPS);

    const bytes = await file.arrayBuffer();

    await markStep(runId, "upload", "running");
    const stored = await storeUpload({ projectId, filename: file.name, bytes });
    await markStep(runId, "upload", "completed", `${Math.round(stored.bytes / 1024)} KB`);

    // An SVG is kept as an asset and nothing more. Reading structure out of one
    // is a parser this does not have, and guessing at it with vision would be
    // worse than the file already is.
    if (kind === "vector") {
      await markStep(runId, "interpret", "cancelled", "SVG is stored as an asset, not interpreted");
      await markRun(runId, "completed");
      revalidatePath("/dashboard/assets");
      return {
        runId,
        message: `${file.name} was saved to your assets. SVG isn't converted to a layout yet — use a Figma URL or a screenshot for that.`,
      };
    }

    if (!isInferenceConfigured()) {
      await markStep(runId, "interpret", "failed", "No model provider configured");
      await markRun(runId, "failed", { code: "not_configured", message: "No AI provider configured." });
      return {
        runId,
        message: "The image was saved, but reading a screenshot needs a vision model. Set ANTHROPIC_API_KEY.",
      };
    }

    await markStep(runId, "interpret", "running");
    const result = await ingestImage({ projectId, image: stored, bytes });
    await markStep(runId, "interpret", "completed", `${result.nodesWritten} layers`);

    await markStep(runId, "persist", "completed", result.frameName);
    await markRun(runId, "completed");

    const supabase = createServiceClient();
    await supabase.from("projects").update({ status: "review" }).eq("id", projectId);

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/analysis");
    revalidatePath("/dashboard/assets");

    return { runId, message: `Imported ${result.nodesWritten} layers from ${file.name}.` };
  } catch (error) {
    console.error("[import:image]", error);
    return {
      message: error instanceof Error ? error.message : "That image could not be imported.",
    };
  }
}

/** Steps for an image import, which has no Figma file to walk. */
const IMAGE_IMPORT_STEPS: [string, string][] = [
  ["upload", "Storing the image"],
  ["interpret", "Reading the layout"],
  ["persist", "Building the component tree"],
];

/**
 * Connects Figma with a personal access token.
 *
 * The OAuth app on this deployment is published privately, so it is visible
 * only to the organization that owns it and every other account is told it does
 * not exist. Making it work for anyone means a Public app and Figma's review.
 *
 * This path needs none of that, and is not a downgrade: a personal token
 * authorises exactly the files its own account can open — the same boundary
 * OAuth draws — and it is the user's own credential to revoke.
 */
export async function connectFigmaTokenAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const token = formData.get("figmaToken");

  if (typeof token !== "string" || !token.trim()) {
    return { message: "Paste your Figma personal access token." };
  }

  try {
    const session = await requireOrgRole("developer");

    // Checked against Figma before it is stored, so a mistyped paste fails here
    // rather than at the first import, where it would read as a broken product.
    const account = await verifyPersonalToken(token);

    await savePersonalToken({
      organizationId: session.organization.id,
      userId: session.user.id,
      token,
      account,
    });

    revalidatePath("/dashboard/import");
    return { message: `Connected as ${account.handle}. You can import any file that account can open.` };
  } catch (error) {
    if (error instanceof FigmaTokenError) return { message: error.message };
    console.error("[connect:figma:token]", error);
    return { message: "That token could not be saved. Try again in a moment." };
  }
}
