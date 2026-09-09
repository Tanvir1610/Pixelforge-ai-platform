"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgRole } from "@/lib/auth/session";
import { startAnalysisRun } from "@/lib/repositories/generation";
import { runAnalysisStage, ANALYSIS_STAGE_STEPS } from "@/lib/ai/orchestrator";
import { isInferenceConfigured } from "@/lib/ai/bootstrap";
import { fieldErrors } from "@/lib/validation/schemas";

export interface AnalyseState {
  errors?: Record<string, string>;
  message?: string;
  runId?: string;
  summary?: string;
}

const schema = z.object({
  projectId: z.string().uuid(),
  autoApply: z.boolean().default(false),
});

/**
 * Runs the Design Analyst over a project's persisted IR.
 *
 * Like the import action, the run row is opened before the model is called so
 * the screen has something to subscribe to. Moving execution to a queue worker
 * is a change to this function only.
 */
export async function analyseDesignAction(_prev: AnalyseState, formData: FormData): Promise<AnalyseState> {
  const parsed = schema.safeParse({
    projectId: formData.get("projectId"),
    autoApply: formData.get("autoApply") === "on",
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (!isInferenceConfigured()) {
    return { message: "No AI provider is configured. Set ANTHROPIC_API_KEY to run analysis." };
  }

  try {
    const session = await requireOrgRole("developer");
    const runId = await startAnalysisRun(parsed.data.projectId, "manual");

    const outcome = await runAnalysisStage({
      organizationId: session.organization.id,
      projectId: parsed.data.projectId,
      runId,
      autoApply: parsed.data.autoApply,
    });

    revalidatePath("/dashboard/understanding");
    revalidatePath("/dashboard/analysis");

    if (!outcome.ok) return { runId, message: outcome.errorMessage };
    return { runId, summary: outcome.summary };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Analysis could not be started." };
  }
}

export { ANALYSIS_STAGE_STEPS };
