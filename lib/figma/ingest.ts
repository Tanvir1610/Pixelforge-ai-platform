import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { markRun, markStep } from "@/lib/repositories/generation";
import { persistDesignDocument } from "@/lib/repositories/design";
import { FigmaApiError, FigmaClient, FIGMA_ERROR_COPY } from "./client";
import { normalizeFigmaFile } from "./normalize";
import type { FigmaFileRef } from "./types";

/**
 * The ingestion pipeline: fetch → normalise → persist.
 *
 * Every stage marks its step before and after, so the analysis screen reflects
 * work actually finishing rather than an animation. A failure marks the step
 * and the run, then stops — partial progress stays visible and inspectable
 * instead of vanishing.
 */
export interface IngestInput {
  projectId: string;
  runId: string;
  ref: FigmaFileRef;
  sourceUrl: string;
  accessToken: string;
  tokenKind?: "oauth" | "personal";
}

export interface IngestOutcome {
  ok: boolean;
  nodes?: number;
  tokens?: number;
  frames?: number;
  errorCode?: string;
  errorMessage?: string;
}

export async function ingestFigmaFile(input: IngestInput): Promise<IngestOutcome> {
  const { projectId, runId, ref, sourceUrl, accessToken, tokenKind } = input;
  const client = new FigmaClient({ accessToken, tokenKind });

  await markRun(runId, "running");

  try {
    await markStep(runId, "fetch_file", "running");
    // depth 12 is well past any realistic nesting for a page, and stops a
    // pathological file from returning tens of megabytes.
    const file = await client.getFile(ref.fileKey, { nodeId: ref.nodeId, depth: 12 });
    await markStep(runId, "fetch_file", "completed", `${file.name} · v${file.version}`);

    await markStep(runId, "analyse_layout", "running");
    const { document, stats } = normalizeFigmaFile(file, {
      projectId,
      fileKey: ref.fileKey,
      frameIds: ref.nodeId ? [ref.nodeId] : undefined,
    });

    if (stats.framesConverted === 0) {
      throw new FigmaApiError(200, "not_found", "That file has no visible top-level frames to convert.");
    }

    await markStep(runId, "analyse_layout", "completed", `${stats.framesConverted} frames`);

    const classified = Object.values(document.nodes).filter((node) => node.semanticRole);
    await markStep(runId, "detect_components", "completed", `${classified.length} identified`);

    const typography = document.tokens.filter((token) => token.category === "typography");
    await markStep(runId, "extract_typography", "completed", `${typography.length} styles`);

    const colours = document.tokens.filter((token) => token.category === "color");
    await markStep(runId, "extract_colours", "completed", `${colours.length} tokens`);

    const images = Object.values(document.nodes).filter((node) => node.type === "image");
    await markStep(runId, "map_assets", "completed", `${images.length} images`);

    const responsive = Object.values(document.nodes).filter((node) => node.responsiveHints);
    await markStep(runId, "infer_responsive", "completed", `${responsive.length} rules`);

    await markStep(runId, "persist", "running");
    const persisted = await persistDesignDocument(document, { sourceUrl });
    await markStep(runId, "persist", "completed", `${persisted.nodesWritten} nodes`);

    // The project moves out of "importing" only once the data is durable.
    const supabase = createServiceClient();
    await supabase.from("projects").update({ status: "review" }).eq("id", projectId);

    await markRun(runId, "completed");

    return {
      ok: true,
      nodes: persisted.nodesWritten,
      tokens: persisted.tokensWritten,
      frames: stats.framesConverted,
    };
  } catch (error) {
    const isFigma = error instanceof FigmaApiError;
    const code = isFigma ? error.code : "internal";
    // Never surface an upstream stack trace or Figma's own wording.
    const message = isFigma ? error.message : FIGMA_ERROR_COPY.upstream;

    await markRun(runId, "failed", { code, message });

    const supabase = createServiceClient();
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);

    return { ok: false, errorCode: code, errorMessage: message };
  }
}
