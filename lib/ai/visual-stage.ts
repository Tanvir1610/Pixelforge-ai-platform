import "server-only";

import { markRun, markStep } from "@/lib/repositories/generation";
import { loadDesignDocument } from "@/lib/repositories/design-read";
import { recordComparison } from "@/lib/repositories/visual";
import { getSignedUrl } from "@/lib/storage/signed-urls";
import { compareDom } from "@/lib/visual/dom-compare";
import { buildComparison, prioritiseDifferences } from "@/lib/visual/score";
import { clusterRegions, decodePng, diffImages, encodePng, renderDiffImage } from "@/lib/visual/pixel-diff";
import type { Screenshotter } from "@/lib/visual/screenshotter";
import type { ComparisonResult, VisualDifference } from "@/lib/visual/types";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * The visual QA stage.
 *
 * For each breakpoint: capture the rendered page, compare its geometry against
 * the Design IR, optionally pixel-diff it against the Figma reference, then
 * store a scored result with fixable regions.
 *
 * Geometry is compared always; pixels only when a reference render exists.
 * A pixel diff without geometry would say "these areas differ" and leave the
 * repair agent guessing, which is the failure this stage exists to avoid.
 */
export interface VisualStageInput {
  projectId: string;
  runId: string;
  previewUrl: string;
  screenshotter: Screenshotter;
  breakpoints?: number[];
  codeVersionId?: string;
  /** Storage paths of Figma reference renders, keyed by breakpoint. */
  referencePaths?: Record<number, string>;
  iteration?: number;
}

export interface VisualStageOutcome {
  ok: boolean;
  results: ComparisonResult[];
  /** Widest breakpoint's score: the design the user actually drew. */
  headlineSimilarity?: number;
  fixable: VisualDifference[];
  errorMessage?: string;
}

const DEFAULT_BREAKPOINTS = [1440, 768, 390];

export async function runVisualStage(input: VisualStageInput): Promise<VisualStageOutcome> {
  const breakpoints = input.breakpoints ?? DEFAULT_BREAKPOINTS;
  const iteration = input.iteration ?? 1;

  await markRun(input.runId, "running");

  try {
    await markStep(input.runId, "capture", "running");

    const document = await loadDesignDocument(input.projectId);
    if (!document) throw new Error("There's no imported design to compare against.");

    const captures = await input.screenshotter.capture({
      url: input.previewUrl,
      breakpoints,
    });

    await markStep(input.runId, "capture", "completed", `${captures.length} breakpoints`);
    await markStep(input.runId, "compare", "running");

    const supabase = createServiceClient();
    const results: ComparisonResult[] = [];
    const allDifferences: VisualDifference[] = [];

    for (const capture of captures) {
      const dom = compareDom(document, capture.snapshot);

      // Pixel comparison is optional: it needs a Figma reference render, which
      // only exists once assets have been exported for this breakpoint.
      let pixelDelta: number | undefined;
      let pixelRegions: VisualDifference[] = [];

      const referencePath = input.referencePaths?.[capture.breakpoint];
      if (referencePath) {
        const referenceBytes = await downloadReference(referencePath);
        if (referenceBytes) {
          const diff = diffImages(decodePng(referenceBytes), decodePng(capture.screenshot));
          pixelDelta = diff.delta;

          // Pixel regions are reported only where geometry found nothing —
          // otherwise the same problem appears twice, once actionable and once
          // not, and the actionable one gets lost.
          pixelRegions = clusterRegions(diff).map((rect) => ({
            category: "image" as const,
            severity: rect.width * rect.height > diff.totalPixels * 0.05 ? ("high" as const) : ("medium" as const),
            label: "Rendered area differs",
            detail: `${rect.width}×${rect.height}px region does not match the reference`,
            expected: "reference render",
            actual: "generated page",
            magnitude: (rect.width * rect.height) / Math.max(1, diff.totalPixels) * 100,
            rect,
          }));

          const diffImage = renderDiffImage(decodePng(capture.screenshot), diff);
          await uploadArtifact(
            supabase,
            `${input.projectId}/screenshots/${capture.breakpoint}-diff.png`,
            encodePng(diffImage),
          );
        }
      }

      await uploadArtifact(
        supabase,
        `${input.projectId}/screenshots/${capture.breakpoint}-actual.png`,
        capture.screenshot,
      );

      const result = buildComparison({
        breakpoint: capture.breakpoint,
        differences: dom.differences,
        matchedNodes: dom.matchedNodes,
        unmatchedNodes: dom.unmatchedNodes,
        pixelDelta,
      });

      await recordComparison({
        projectId: input.projectId,
        result,
        codeVersionId: input.codeVersionId,
        generationRunId: input.runId,
        iteration,
        pixelRegions,
      });

      results.push(result);
      allDifferences.push(...dom.differences);
    }

    const widest = [...results].sort((a, b) => b.breakpoint - a.breakpoint)[0];

    await markStep(
      input.runId, "compare", "completed",
      widest ? `${widest.similarity}% match` : "no breakpoints captured",
    );

    await markRun(input.runId, "completed");

    return {
      ok: true,
      results,
      headlineSimilarity: widest?.similarity,
      fixable: prioritiseDifferences(allDifferences),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Visual comparison failed.";
    await markRun(input.runId, "failed", { code: "visual_failed", message });
    return { ok: false, results: [], fixable: [], errorMessage: message };
  } finally {
    await input.screenshotter.dispose();
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function uploadArtifact(supabase: ServiceClient, path: string, bytes: Buffer): Promise<void> {
  await supabase.storage.from("screenshots").upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
}

async function downloadReference(path: string): Promise<Buffer | null> {
  const url = await getSignedUrl("screenshots", path, 120);
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

export const VISUAL_STEPS: [string, string][] = [
  ["capture", "Capturing the rendered page"],
  ["compare", "Comparing against the design"],
];
