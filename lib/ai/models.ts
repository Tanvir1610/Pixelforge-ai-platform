import type { ModelCapability, ModelPurpose } from "./types";

/**
 * Model catalogue.
 *
 * Pricing is per million tokens and is the platform's own record, not something
 * read from a provider at runtime: cost has to be attributable after the fact
 * even if a price changes, so `model_runs.cost_usd` is computed from whatever
 * this table said at the time.
 *
 * Verify prices against the provider's page before relying on billing figures.
 */
export interface ModelSpec {
  key: string;
  providerKey: string;
  displayName: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  /** Rough capability tier, used for routing rather than a hard ranking. */
  tier: "fast" | "balanced" | "frontier";
  /**
   * Whether the model still accepts `temperature` and the other sampling
   * parameters.
   *
   * They were removed from the current generation and are rejected with a 400,
   * not ignored — so sending one unconditionally makes every call to a current
   * model fail. Recorded per model rather than assumed, because the older
   * models still take them.
   */
  acceptsSampling: boolean;
  /** Whether `output_config.effort` is accepted. Haiku 4.5 rejects it. */
  acceptsEffort: boolean;
  /**
   * Whether requests opt into server-side refusal fallbacks.
   *
   * Opus 5's safety classifiers can decline a request with a normal HTTP 200
   * and `stop_reason: "refusal"`. Benign work occasionally trips them — a
   * generated login form is close enough to "security" to be at risk — and
   * without a fallback that step simply fails. `fallbacks: "default"` re-runs a
   * declined request on the model Anthropic recommends for that refusal
   * category, server-side, in the same round trip.
   */
  serverFallback: boolean;
}

export const MODELS: ModelSpec[] = [
  {
    // Never a date-suffixed id: the current ids are complete as they stand, and
    // an invented suffix is rejected as an unknown model.
    key: "claude-haiku-4-5",
    providerKey: "anthropic",
    displayName: "Claude Haiku 4.5",
    capabilities: ["generate", "stream", "structured", "vision", "analyze"],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputCostPerMTok: 1,
    outputCostPerMTok: 5,
    tier: "fast",
    // The last generation that still accepts temperature. Everything above it
    // rejects sampling parameters outright.
    acceptsSampling: true,
    acceptsEffort: false,
    serverFallback: false,
  },
  {
    key: "claude-sonnet-5",
    providerKey: "anthropic",
    displayName: "Claude Sonnet 5",
    capabilities: ["generate", "stream", "structured", "vision", "analyze"],
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputCostPerMTok: 2,
    outputCostPerMTok: 10,
    tier: "balanced",
    acceptsSampling: false,
    acceptsEffort: true,
    serverFallback: false,
  },
  {
    key: "claude-opus-5",
    providerKey: "anthropic",
    displayName: "Claude Opus 5",
    capabilities: ["generate", "stream", "structured", "vision", "analyze"],
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputCostPerMTok: 5,
    outputCostPerMTok: 25,
    tier: "frontier",
    acceptsSampling: false,
    acceptsEffort: true,
    serverFallback: true,
  },
];

/**
 * Which tier each purpose deserves.
 *
 * Mechanical, well-specified work goes to the cheap model; work where a wrong
 * decision propagates through every later stage goes to a stronger one. §41.
 */
export const PURPOSE_TIER: Record<ModelPurpose, ModelSpec["tier"]> = {
  design_analysis: "balanced",
  component_detection: "balanced",
  architecture_planning: "frontier",
  // Opus. The generated code is the product: a weaker step here is paid for
  // again in every repair pass and every file a user has to fix by hand, which
  // costs more than the price difference per step.
  code_generation: "frontier",
  code_repair: "balanced",
  visual_qa: "balanced",
  refinement: "fast",
  embedding: "fast",
};

export function getModel(key: string): ModelSpec | undefined {
  return MODELS.find((model) => model.key === key);
}

/** Cheapest model of the required tier that has the capability. */
export function selectModel(purpose: ModelPurpose, capability: ModelCapability): ModelSpec | undefined {
  const wanted = PURPOSE_TIER[purpose];
  const candidates = MODELS.filter((model) => model.capabilities.includes(capability));

  const inTier = candidates.filter((model) => model.tier === wanted);
  const pool = inTier.length ? inTier : candidates;

  return [...pool].sort((a, b) => a.inputCostPerMTok - b.inputCostPerMTok)[0];
}

export function computeCost(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * spec.inputCostPerMTok +
    (outputTokens / 1_000_000) * spec.outputCostPerMTok;
  // Six decimal places matches numeric(12,6) in model_runs.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Rough token estimate for budgeting *before* a call.
 *
 * Deliberately approximate and deliberately pessimistic: it decides how much
 * context to include, and under-estimating means an API error, while
 * over-estimating only means slightly less context.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
