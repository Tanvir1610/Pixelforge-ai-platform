import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import type { ComparisonResult, VisualDifference } from "@/lib/visual/types";

/**
 * Visual comparison persistence.
 *
 * Comparison and regions are written by one RPC so the project's headline score
 * can never reference a comparison that was not stored.
 */
export async function recordComparison(params: {
  projectId: string;
  result: ComparisonResult;
  codeVersionId?: string;
  generationRunId?: string;
  figmaFrameId?: string;
  iteration?: number;
  /** Regions found only by pixel diff, with no geometry explanation. */
  pixelRegions?: VisualDifference[];
}): Promise<string | null> {
  const supabase = createServiceClient();

  const regions = [
    ...params.result.differences.map((difference) => ({ ...difference, source: "dom" })),
    ...(params.pixelRegions ?? []).map((difference) => ({ ...difference, source: "pixel" })),
  ];

  const { data, error } = await supabase.rpc("record_visual_comparison", {
    p_project_id: params.projectId,
    p_breakpoint: params.result.breakpoint,
    p_similarity: params.result.similarity,
    p_metrics: params.result.metrics as unknown as Json,
    p_regions: regions as unknown as Json,
    p_code_version_id: params.codeVersionId ?? null,
    p_generation_run_id: params.generationRunId ?? null,
    p_iteration: params.iteration ?? 1,
    p_matched_nodes: params.result.matchedNodes,
    p_unmatched_nodes: params.result.unmatchedNodes,
    p_pixel_delta: params.result.pixelDelta ?? null,
    p_figma_frame_id: params.figmaFrameId ?? null,
  });

  if (error) return null;
  return data as string;
}

export interface ComparisonSummary {
  id: string;
  breakpoint: number;
  similarity: number;
  metrics: { spacing: number; typography: number; color: number; layout: number; components: number };
  matchedNodes: number;
  unmatchedNodes: number;
  createdAt: string;
}

/** Latest comparison per breakpoint, widest first. */
export async function getComparisons(projectId: string): Promise<ComparisonSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("visual_comparisons")
    .select(
      "id, breakpoint, similarity_score, spacing_score, typography_score, color_score, layout_score, component_score, matched_nodes, unmatched_nodes, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);

  const seen = new Set<number>();
  const latest: ComparisonSummary[] = [];

  for (const row of data ?? []) {
    if (seen.has(row.breakpoint)) continue;
    seen.add(row.breakpoint);
    latest.push({
      id: row.id,
      breakpoint: row.breakpoint,
      similarity: Number(row.similarity_score),
      metrics: {
        spacing: Number(row.spacing_score ?? 0),
        typography: Number(row.typography_score ?? 0),
        color: Number(row.color_score ?? 0),
        layout: Number(row.layout_score ?? 0),
        components: Number(row.component_score ?? 0),
      },
      matchedNodes: row.matched_nodes,
      unmatchedNodes: row.unmatched_nodes,
      createdAt: row.created_at,
    });
  }

  return latest.sort((a, b) => b.breakpoint - a.breakpoint);
}

/** Unfixed regions for a comparison, worst first. */
export async function getDifferenceRegions(comparisonId: string, limit = 50) {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("visual_difference_regions")
    .select("id, category, severity, label, detail, expected_value, actual_value, source, magnitude, fixed_at")
    .eq("visual_comparison_id", comparisonId)
    .is("fixed_at", null)
    .order("magnitude", { ascending: false })
    .limit(limit);

  return data ?? [];
}
