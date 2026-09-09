import type { ComparisonResult, DifferenceCategory, MetricScores, VisualDifference } from "./types";

/**
 * Scoring.
 *
 * The product shows "97% visual match" and five sub-scores. Those numbers drive
 * whether a user trusts the output, so how they are computed matters:
 *
 * - Sub-scores are per category, so "typography 96%" means something specific.
 * - Severity is weighted, because one missing section is not equivalent to
 *   twenty half-pixel nudges.
 * - The score is capped below 100 whenever any difference exists. Showing 100%
 *   next to a list of problems destroys trust in every other number.
 */
const CATEGORY_METRIC: Record<DifferenceCategory, keyof MetricScores> = {
  spacing: "spacing",
  typography: "typography",
  color: "color",
  layout: "layout",
  position: "layout",
  alignment: "layout",
  size: "layout",
  image: "components",
  border: "components",
  shadow: "components",
};

const SEVERITY_WEIGHT = { high: 6, medium: 2.5, low: 1 } as const;

/** Diminishing returns: the tenth spacing nudge matters less than the first. */
function penalty(weightedCount: number): number {
  return 100 * (1 - Math.exp(-weightedCount / 12));
}

export function scoreMetrics(differences: VisualDifference[], matchedNodes: number): MetricScores {
  const weights: Record<keyof MetricScores, number> = {
    spacing: 0, typography: 0, color: 0, layout: 0, components: 0,
  };

  for (const difference of differences) {
    const metric = CATEGORY_METRIC[difference.category];
    weights[metric] += SEVERITY_WEIGHT[difference.severity];
  }

  // Normalised by page size: ten differences across a 400-node page is a much
  // better result than ten across a 12-node one.
  const scale = Math.max(1, Math.sqrt(Math.max(matchedNodes, 1)) / 4);

  const score = (weight: number) => {
    if (weight === 0) return 100;
    const raw = 100 - penalty(weight / scale);
    // Any difference at all caps the score below 100.
    return Math.max(0, Math.min(99, Math.round(raw * 10) / 10));
  };

  return {
    spacing: score(weights.spacing),
    typography: score(weights.typography),
    color: score(weights.color),
    layout: score(weights.layout),
    components: score(weights.components),
  };
}

/**
 * Overall similarity.
 *
 * Layout is weighted highest because a page with the right structure and
 * slightly wrong colours is far closer to correct than the reverse. When a
 * pixel diff ran, it is blended in — it catches what geometry cannot see.
 */
export function overallSimilarity(metrics: MetricScores, pixelDelta?: number): number {
  const geometric =
    metrics.layout * 0.32 +
    metrics.spacing * 0.24 +
    metrics.typography * 0.2 +
    metrics.color * 0.14 +
    metrics.components * 0.1;

  if (pixelDelta === undefined) return Math.round(geometric * 10) / 10;

  const pixelScore = Math.max(0, 100 - pixelDelta * 100 * 2.5);
  return Math.round((geometric * 0.7 + pixelScore * 0.3) * 10) / 10;
}

export function buildComparison(params: {
  breakpoint: number;
  differences: VisualDifference[];
  matchedNodes: number;
  unmatchedNodes: number;
  pixelDelta?: number;
}): ComparisonResult {
  const metrics = scoreMetrics(params.differences, params.matchedNodes);

  return {
    breakpoint: params.breakpoint,
    similarity: overallSimilarity(metrics, params.pixelDelta),
    metrics,
    differences: params.differences,
    pixelDelta: params.pixelDelta,
    matchedNodes: params.matchedNodes,
    unmatchedNodes: params.unmatchedNodes,
  };
}

/**
 * What to fix first.
 *
 * Ordered by severity then magnitude, and capped, because a repair prompt with
 * eighty differences in it produces worse fixes than one with the ten that
 * matter. Grouping by file keeps a single edit addressing several at once.
 */
export function prioritiseDifferences(differences: VisualDifference[], limit = 15): VisualDifference[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...differences]
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.magnitude - a.magnitude)
    .slice(0, limit);
}
