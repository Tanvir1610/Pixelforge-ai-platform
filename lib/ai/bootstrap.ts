import { AnthropicProvider } from "./providers/anthropic";
import { getProvider, registerProvider, routePurpose } from "./registry";

/**
 * Registers inference providers from the environment.
 *
 * Idempotent, so it is safe to call at the top of any entry point. If no key is
 * configured nothing is registered and `resolveProvider` throws a clear
 * ModelNotConfiguredError — which is the correct behaviour. A provider that
 * fabricated output would make an unconfigured platform look like a working one.
 */
let bootstrapped = false;

export function bootstrapProviders(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && !getProvider("anthropic")) {
    registerProvider(new AnthropicProvider({ apiKey: anthropicKey }));

    // Explicit routing documents the cost policy. Without it the registry still
    // falls through to any provider with the capability.
    routePurpose("design_analysis", "anthropic");
    routePurpose("component_detection", "anthropic");
    routePurpose("architecture_planning", "anthropic");
    routePurpose("code_generation", "anthropic");
    routePurpose("code_repair", "anthropic");
    routePurpose("visual_qa", "anthropic");
    routePurpose("refinement", "anthropic");
  }
}

/** Tests only. */
export function resetBootstrap(): void {
  bootstrapped = false;
}

export function isInferenceConfigured(): boolean {
  bootstrapProviders();
  return Boolean(getProvider("anthropic"));
}
