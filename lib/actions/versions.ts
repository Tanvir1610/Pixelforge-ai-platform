"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/session";
import { restoreVersion } from "@/lib/repositories/code";

/**
 * Restoring a previous version.
 *
 * `listVersions` and `restoreVersion` have existed since the versioning layer
 * landed and nothing ever called them, so every generation was effectively
 * final: the history was recorded and unreachable.
 *
 * Restoring is additive — it copies the old file set forward as a new version
 * rather than deleting anything — so it is safe to offer without a
 * confirmation, and reversible by restoring the other way.
 */
export interface RestoreState {
  ok?: boolean;
  message?: string;
}

export async function restoreVersionAction(
  _prev: RestoreState,
  formData: FormData,
): Promise<RestoreState> {
  const versionId = formData.get("versionId");
  if (typeof versionId !== "string" || !versionId) {
    return { message: "Pick a version to restore." };
  }

  try {
    await requireOrgRole("developer");
    await restoreVersion(versionId);

    revalidatePath("/dashboard");
    return { ok: true, message: "Restored as a new version. Nothing was overwritten." };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not restore that version." };
  }
}
