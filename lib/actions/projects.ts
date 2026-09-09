"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/session";
import { createProject } from "@/lib/repositories/projects";
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
