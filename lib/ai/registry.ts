import { UnconfiguredProvider } from "./providers/unconfigured";
import {
  ModelNotConfiguredError,
  type ModelCapability,
  type ModelProvider,
  type ModelPurpose,
} from "./types";

/**
 * Provider registry and router.
 *
 * Routing is by purpose, not by caller preference, so cost policy lives in one
 * place: cheap models for mechanical work, stronger ones for architecture,
 * vision-capable ones for visual QA. §41 of the brief.
 */
const REQUIRED_CAPABILITY: Record<ModelPurpose, ModelCapability> = {
  design_analysis: "structured",
  component_detection: "structured",
  architecture_planning: "generate",
  code_generation: "generate",
  code_repair: "generate",
  visual_qa: "vision",
  refinement: "generate",
  embedding: "embed",
};

const providers = new Map<string, ModelProvider>();
const routes = new Map<ModelPurpose, string>();

export function registerProvider(provider: ModelProvider): void {
  providers.set(provider.key, provider);
}

export function routePurpose(purpose: ModelPurpose, providerKey: string): void {
  routes.set(purpose, providerKey);
}

export function listProviders(): ModelProvider[] {
  return [...providers.values()];
}

export function getProvider(key: string): ModelProvider | undefined {
  return providers.get(key);
}

/**
 * Resolves the provider for a purpose. Falls back to any registered provider
 * that has the required capability, so adding a provider is enough to make the
 * platform work — explicit routing is an optimisation, not a requirement.
 */
export function resolveProvider(purpose: ModelPurpose): ModelProvider {
  const required = REQUIRED_CAPABILITY[purpose];

  const routed = routes.get(purpose);
  if (routed) {
    const provider = providers.get(routed);
    if (provider?.supports(required)) return provider;
  }

  for (const provider of providers.values()) {
    if (provider.supports(required)) return provider;
  }

  throw new ModelNotConfiguredError(purpose);
}

/** Clears all registrations. Tests only. */
export function resetRegistry(): void {
  providers.clear();
  routes.clear();
}

// Phase 1 ships no inference provider. This keeps the registry non-empty and
// makes the failure explicit rather than a crash somewhere downstream.
registerProvider(new UnconfiguredProvider());
