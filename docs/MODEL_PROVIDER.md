# Model provider abstraction

## Why

The long-term goal is our own models. That only stays possible if nothing above
this layer knows which model answered. Agents ask for a **capability** and a
**purpose**; the registry decides who serves it.

## Interface

`lib/ai/types.ts` defines `ModelProvider`:

```ts
generate(options)            → GenerateResult
stream(options)              → AsyncIterable<string>
structuredGenerate<T>(opts)  → StructuredResult<T>   // schema-constrained
embed(inputs)                → EmbedResult
supports(capability)         → boolean
```

Capabilities: `generate`, `stream`, `embed`, `analyze`, `structured`, `vision`.

Every result carries `usage` (tokens, cost, latency) and the `providerKey` that
produced it, so `model_runs` can be written without the caller knowing who ran.

## Routing

`lib/ai/registry.ts` maps purpose → required capability:

| Purpose | Requires |
| --- | --- |
| `design_analysis`, `component_detection` | `structured` |
| `architecture_planning`, `code_generation`, `code_repair`, `refinement` | `generate` |
| `visual_qa` | `vision` |
| `embedding` | `embed` |

`routePurpose(purpose, providerKey)` pins a specific provider — this is where
cost policy lives (cheap model for mechanical work, stronger for architecture).
A route whose provider lacks the required capability is ignored rather than
obeyed, and the registry falls through to one that can actually do the job.

## Current state

Phase 1 ships the interface, `BaseModelProvider` (capability checks and the
untrusted-content fence), and the registry — with **no inference provider**.

`UnconfiguredProvider` is registered so the registry has a valid shape and
callers get an actionable error. It deliberately never fabricates output: a stub
returning plausible text would be worse than nothing, because the pipeline would
look like it works.

## Adding a provider

1. Extend `BaseModelProvider` in `lib/ai/providers/`.
2. Declare capabilities honestly — the router trusts them.
3. Route untrusted content through `this.fence()`.
4. `registerProvider(new YourProvider())`.
5. Record a `model_runs` row with the returned `usage`.

## Path to our own models

Replace one component at a time, measured against the eval suite (`EVALUATION.md`):
design understanding → visual QA → code repair → code generation. Each swap is a
registry change. `model_providers.kind` already distinguishes
`external` / `local` / `own`, and a `pixelforge` row is seeded.
