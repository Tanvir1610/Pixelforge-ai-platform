# AI orchestration (Phase 3)

Registers an inference provider behind the model abstraction and runs the
Design Analyst over a persisted `DesignDocument`.

## The pipeline

```
load IR → budget context → structured call → validate → artifact → corrections
```

Every stage writes a `generation_steps` row, and the whole run is one
`generation_runs` row the analysis screen subscribes to over Realtime.

## Context budgeting

The analyst never sees the whole IR. `lib/ai/context/compact.ts` selects the
nodes that carry signal — sections, repeated structures, text with real content,
low-confidence nodes needing a second opinion — and reports what it dropped.
Dumping a whole project into every call is the failure mode this exists to
prevent (§20): it costs more, and accuracy falls as the useful signal is buried.

The result records `includedNodes`, `totalNodes` and `truncated`, so a poor
analysis can be traced to a truncated context rather than guessed at.

## Model output is never trusted

`structuredCall` validates every response against a Zod schema. On a validation
failure it feeds the specific issues back and retries, up to a bound. A
transport failure is not retried that way — a reworded prompt does not fix a
502, so it fails immediately rather than burning the repair budget.

Node ids the model invents are dropped: corrections are intersected with ids
that actually exist in the IR.

## Corrections are proposals

The analyst does not rewrite the IR. Corrections are stored on the artifact and
shown for review; `autoApply` is opt-in and off by default. An agent silently
rewriting a user's design model is the behaviour that makes these systems
untrustworthy.

Applied corrections go through `apply_role_corrections`, which checks
`can_write_project`, applies in a single statement so a partial review can never
leave the IR half-classified, ignores ids belonging to another project, and
records `role_source` so heuristic, model and human labels stay distinguishable
— which the training pipeline depends on.

## Prompt injection

Figma text layers are user content from outside the trust boundary. They are
passed with `untrusted: true`, and the provider wraps them in a fence that tells
the model to treat them as data. An attempt to close the fence early is escaped.
System instructions, design data and tool output stay in separate turns.

## Accounting

`record_model_run` logs the call and meters credits in one transaction, so a run
can never be logged without being charged or charged without being logged. A
failed call is logged with its tokens but not charged.

Credits are checked *before* the call via `has_credits`, computed in Postgres
from `usage_records`. A user over quota gets a clear message instead of a
half-finished run they were billed for.

## Two bugs found in review

**Provider attribution was hardcoded to `"anthropic"`.** Every run was
attributed to whichever provider was registered first — invisible with one
provider, and wrong the moment a second exists, which is the entire point of the
abstraction. Attribution now flows from the provider that served the call,
including through both failure paths.

**The credit gate was defined but never called.** `has_credits` existed in the
schema and nothing invoked it, so a user over their limit could still trigger
inference. Now checked before the model call.

Both have regression tests.

## Status

Implemented: provider interface, Anthropic provider, registry routing, context
budgeting, structured calls with schema repair, the Design Analyst, artifacts,
corrections, accounting and gating.

Not implemented: the tool system (§16), the remaining agents (architecture,
component, responsive planners), and streaming progress from the model itself.
