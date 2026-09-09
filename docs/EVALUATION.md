# Evaluation

Every model swap has to be justified by numbers, otherwise "replace it with our
own model" is a wish rather than a plan.

## Metrics

**Correctness** — build success rate, TypeScript error rate, runtime error rate,
lint clean rate.

**Fidelity** — visual similarity overall, plus spacing, typography, colour,
layout and component sub-scores at each breakpoint. Already modelled in
`visual_comparisons`.

**Quality** — component reuse ratio, design-token adherence (magic numbers per
file), accessibility violations, Lighthouse performance.

**Economics** — generation latency, token cost per page, refinement iterations
to reach threshold.

**Human signal** — acceptance rate of proposed changes, edits made after
generation, rollbacks.

## AI generation score

A weighted roll-up shown per project: code quality, visual fidelity, responsive
quality, accessibility, build stability. It is a product metric as much as an
engineering one.

## Method

A frozen corpus of Figma files with known-good implementations. Every run
records `model_runs.model_key` and the provider, so results are attributable.
A candidate model ships only if it wins on fidelity and correctness without
regressing cost past an agreed bound.

## Status

The tables that hold these numbers exist. The harness that produces them is
Phase 8.
