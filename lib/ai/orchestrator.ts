import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { loadDesignDocument } from "@/lib/repositories/design-read";
import { recordModelRun, saveArtifact } from "@/lib/repositories/artifacts";
import { markRun, markStep } from "@/lib/repositories/generation";
import { AnalystError, runDesignAnalyst } from "./agents/design-analyst";
import { bootstrapProviders } from "./bootstrap";
import type { Json } from "@/lib/db/database.types";

/**
 * Stage orchestration.
 *
 * The pipeline is a sequence of stages, each of which loads what it needs,
 * calls one agent, validates the output, records the cost, and persists a
 * structured artifact. Progress and failure are written to the run so the UI
 * reflects real state rather than an animation.
 *
 * Corrections are applied through a single SQL function so a partially-applied
 * review can never leave the IR half-classified.
 */

export const ANALYSIS_STAGE_STEPS: [string, string][] = [
  ["load_ir", "Loading the design representation"],
  ["analyse_design", "Reading the design"],
  ["apply_corrections", "Applying corrections"],
];

export interface AnalysisStageInput {
  organizationId: string;
  projectId: string;
  runId: string;
  /** Applies proposed role corrections. Off leaves them for human review. */
  autoApply?: boolean;
}

export interface AnalysisStageOutcome {
  ok: boolean;
  summary?: string;
  sections?: number;
  corrections?: number;
  applied?: number;
  costUsd?: number;
  errorCode?: string;
  errorMessage?: string;
}

const USER_MESSAGE: Record<string, string> = {
  not_configured: "No AI provider is configured. Set ANTHROPIC_API_KEY and try again.",
  empty_design: "There's no imported design to analyse yet.",
  invalid_output: "The analysis came back in an unusable shape. Try running it again.",
  provider_error: "The model provider didn't respond. Try again in a moment.",
  no_credits:
    "You've used this month's AI credits. Analysis and preview stay free — upgrade or wait for the reset to generate again.",
};

export async function runAnalysisStage(input: AnalysisStageInput): Promise<AnalysisStageOutcome> {
  const { organizationId, projectId, runId, autoApply = false } = input;
  bootstrapProviders();

  const supabase = createServiceClient();
  await markRun(runId, "running");

  try {
    await markStep(runId, "load_ir", "running");
    const document = await loadDesignDocument(projectId);

    if (!document) {
      throw new AnalystError("empty_design", USER_MESSAGE.empty_design);
    }

    const nodeCount = Object.keys(document.nodes).length;
    await markStep(runId, "load_ir", "completed", `${nodeCount} nodes`);

    // Checked before the call, not after: a user over their limit gets a clear
    // message instead of a half-finished run they were still charged for.
    // The balance is computed in Postgres from usage_records — never trusted
    // from a client.
    const { data: hasCredits } = await supabase.rpc("has_credits", {
      p_organization_id: organizationId,
      p_needed: 1,
    });

    if (hasCredits === false) {
      throw new AnalystError("no_credits", USER_MESSAGE.no_credits);
    }

    await markStep(runId, "analyse_design", "running");
    const result = await runDesignAnalyst({ document });

    const modelRunId = await recordModelRun({
      organizationId,
      projectId,
      generationRunId: runId,
      agent: "design_analyst",
      purpose: "design_analysis",
      modelKey: result.modelKey,
      providerKey: result.providerKey,
      usage: result.usage,
      attempts: result.attempts,
    });

    await saveArtifact({
      projectId,
      generationRunId: runId,
      kind: "design_analysis",
      payload: {
        ...result.analysis,
        context: result.context,
        model: result.modelKey,
      },
      modelRunId,
    });

    await markStep(
      runId,
      "analyse_design",
      "completed",
      `${result.analysis.sections.length} sections · ${result.analysis.corrections.length} corrections`,
    );

    let applied = 0;
    await markStep(runId, "apply_corrections", "running");

    if (autoApply && result.analysis.corrections.length > 0) {
      const { data } = await supabase.rpc("apply_role_corrections", {
        p_project_id: projectId,
        p_updates: result.analysis.corrections.map((correction) => ({
          nodeId: correction.nodeId,
          role: correction.role,
          confidence: correction.confidence,
        })) as Json,
      });
      applied = typeof data === "number" ? data : 0;
    }

    await markStep(
      runId,
      "apply_corrections",
      "completed",
      autoApply ? `${applied} applied` : `${result.analysis.corrections.length} awaiting review`,
    );

    await supabase.from("projects").update({ status: "review" }).eq("id", projectId);
    await markRun(runId, "completed");

    return {
      ok: true,
      summary: result.analysis.summary,
      sections: result.analysis.sections.length,
      corrections: result.analysis.corrections.length,
      applied,
      costUsd: result.usage.costUsd,
    };
  } catch (error) {
    const code = error instanceof AnalystError ? error.code : "provider_error";
    const message = USER_MESSAGE[code] ?? USER_MESSAGE.provider_error;

    // A failed call still consumed tokens; the ledger has to show it.
    if (error instanceof AnalystError && error.usage.inputTokens > 0) {
      await recordModelRun({
        organizationId,
        projectId,
        generationRunId: runId,
        agent: "design_analyst",
        purpose: "design_analysis",
        modelKey: error instanceof AnalystError ? error.modelKey : "unknown",
        providerKey: error instanceof AnalystError ? error.providerKey : "unknown",
        usage: error.usage,
        status: "failed",
        errorCode: code,
      });
    }

    await markRun(runId, "failed", { code, message });
    return { ok: false, errorCode: code, errorMessage: message };
  }
}
