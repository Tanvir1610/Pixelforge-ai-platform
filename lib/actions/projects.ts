"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/session";
import { createProject, renameProject, softDeleteProject } from "@/lib/repositories/projects";
import { z } from "zod";
import { createProjectSchema, fieldErrors } from "@/lib/validation/schemas";

export interface CreateProjectState {
  errors?: Record<string, string>;
  message?: string;
  slug?: string;
}

/**
 * Creates a project.
 *
 * Authorization happens twice on purpose: requireOrgRole gives a clear error
 * here, and the database INSERT policy is the boundary that actually holds.
 */
export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    framework: formData.get("framework") ?? undefined,
    styling: formData.get("styling") ?? undefined,
    typescript: formData.get("typescript") === "on",
    responsive: formData.get("responsive") === "on",
    hostProvider: formData.get("hostProvider") ?? undefined,
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    const session = await requireOrgRole("developer");
    const project = await createProject(session, parsed.data);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/projects");
    return { slug: project.slug };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not create the project." };
  }
}

export interface ProjectMutationState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /**
   * Echoed back from the submitted form.
   *
   * It lets the dialog close itself by comparing what it opened with against
   * what the action last answered, rather than closing from an effect — which
   * means a second edit of the same project still opens, and no state is set
   * during render.
   */
  nonce?: string;
}

const renameSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the project a name.").max(120),
});

export async function renameProjectAction(
  _prev: ProjectMutationState,
  formData: FormData,
): Promise<ProjectMutationState> {
  const nonce = typeof formData.get("nonce") === "string" ? String(formData.get("nonce")) : undefined;

  const parsed = renameSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), nonce };

  try {
    // Authorised twice on purpose: a clear message here, and the RLS policy
    // underneath as the boundary that actually holds.
    await requireOrgRole("developer");
    const project = await renameProject(parsed.data.projectId, parsed.data.name);

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/projects");
    return { ok: true, message: `Renamed to ${project.name}.`, nonce };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not rename the project.", nonce };
  }
}

const deleteSchema = z.object({
  projectId: z.string().uuid(),
  /** Typed by the user. The one destructive action deserves a deliberate act. */
  confirm: z.string(),
  expected: z.string().min(1),
});

export async function deleteProjectAction(
  _prev: ProjectMutationState,
  formData: FormData,
): Promise<ProjectMutationState> {
  const nonce = typeof formData.get("nonce") === "string" ? String(formData.get("nonce")) : undefined;

  const parsed = deleteSchema.safeParse({
    projectId: formData.get("projectId"),
    confirm: formData.get("confirm"),
    expected: formData.get("expected"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), nonce };

  if (parsed.data.confirm.trim() !== parsed.data.expected.trim()) {
    return { message: "The name didn't match, so nothing was deleted.", nonce };
  }

  try {
    await requireOrgRole("developer");
    await softDeleteProject(parsed.data.projectId);

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/projects");
    return { ok: true, message: "Project deleted.", nonce };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not delete the project.", nonce };
  }
}
