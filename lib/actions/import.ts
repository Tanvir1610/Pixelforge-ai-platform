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
    .select("access_token, expires_at, revoked_at")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (data?.access_token) {
    const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
    if (!expired) return { accessToken: data.access_token, tokenKind: "oauth" };
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
