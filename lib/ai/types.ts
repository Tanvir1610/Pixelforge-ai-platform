/**
 * Model abstraction.
 *
 * Nothing above this layer names a vendor. Agents ask for a *capability* and a
 * *purpose*; the registry decides which provider serves it. Swapping an external
 * model for our own is then a registry change, not a rewrite.
 *
 * Status: interface and registry implemented (Phase 1). Concrete inference
 * providers arrive in Phase 3 — see docs/MODEL_PROVIDER.md.
 */

export type ModelCapability = "generate" | "stream" | "embed" | "analyze" | "structured" | "vision";

/** What the platform is asking for, independent of which model answers. */
export type ModelPurpose =
  | "design_analysis"
  | "component_detection"
  | "architecture_planning"
  | "code_generation"
  | "code_repair"
  | "visual_qa"
  | "refinement"
  | "embedding";

/**
 * Message roles are separated so that untrusted content can never be presented
 * to the model as an instruction. See docs/SECURITY.md — prompt injection.
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 payload, or a signed URL the provider is allowed to fetch. */
  data: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ModelMessage {
  role: MessageRole;
  content: ContentPart[];
  /**
   * Marks content that originated outside our trust boundary (Figma text
   * layers, README files, fetched pages). Providers must wrap it as data.
   */
  untrusted?: boolean;
}

export interface GenerateOptions {
  purpose: ModelPurpose;
  messages: ModelMessage[];
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** JSON Schema the response must conform to, for structuredGenerate. */
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface GenerateResult {
  text: string;
  usage: ModelUsage;
  modelKey: string;
  providerKey: string;
  finishReason: "stop" | "length" | "refusal" | "error";
}

export interface StructuredResult<T> extends Omit<GenerateResult, "text"> {
  value: T;
}

export interface EmbedResult {
  vectors: number[][];
  dimensions: number;
  usage: ModelUsage;
  modelKey: string;
  providerKey: string;
}

/**
 * Every provider implements this. `capabilities` is honest: a provider that
 * cannot do vision reports so, and the router will not send it vision work.
 */
export interface ModelProvider {
  readonly key: string;
  readonly displayName: string;
  readonly kind: "external" | "local" | "own";
  readonly capabilities: ReadonlySet<ModelCapability>;

  supports(capability: ModelCapability): boolean;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<string>;
  structuredGenerate<T>(options: GenerateOptions & { schema: Record<string, unknown> }): Promise<StructuredResult<T>>;
  embed(inputs: string[]): Promise<EmbedResult>;
}

export class ModelCapabilityError extends Error {
  constructor(providerKey: string, capability: ModelCapability) {
    super(`Provider "${providerKey}" does not support "${capability}".`);
    this.name = "ModelCapabilityError";
  }
}

export class ModelNotConfiguredError extends Error {
  constructor(purpose: ModelPurpose) {
    super(`No model provider is configured for "${purpose}".`);
    this.name = "ModelNotConfiguredError";
  }
}
