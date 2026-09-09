# Figma ingestion

Phase 2. Turns a Figma file into a Design IR document stored in Postgres.

## Pipeline

```
URL → parse → fetch → normalise → detect → extract → infer → persist
```

Each stage writes a `generation_steps` row before and after, so the analysis
screen reflects work actually finishing rather than an animation on a timer.

| Module | Responsibility |
| --- | --- |
| `lib/figma/url.ts` | Parse and validate a file URL |
| `lib/figma/client.ts` | Typed REST client with retries and error classification |
| `lib/figma/normalize.ts` | Figma JSON → Design IR (pure) |
| `lib/figma/semantics.ts` | Semantic role + confidence |
| `lib/figma/tokens.ts` | Colour, type, spacing, radius, shadow tokens |
| `lib/figma/responsive.ts` | Breakpoint rules |
| `lib/figma/ingest.ts` | Orchestration and step reporting |
| `lib/repositories/design.ts` | Persistence |

## The normaliser is pure

`normalizeFigmaFile(file, options)` has no network, database or clock. That is
what makes the hardest part of the platform unit-testable — 29 tests cover it
against a fixture that mirrors real API output. Fetching lives in `client.ts`
so the transform never needs mocking to be exercised.

What it does:

- **Relative coordinates.** Figma reports absolute page positions; the IR stores
  positions relative to the parent, which is what a layout engine needs and what
  survives a frame being moved on the canvas.
- **Drops hidden layers** and their subtrees, and negligible zero-area
  artifacts. A full-width 1px rule is a divider and is deliberately kept.
- **Auto layout → layout model**, including hug/fill sizing and wrap-as-grid.
- **Image fills make an image node**, not a box with a colour.
- **Gradients return null** rather than a flat approximation, which would put a
  wrong value into the extracted tokens.

## Semantic detection

Two independent signals: layer name and structural shape. Name is stronger when
present, shape carries it when names are absent or wrong. When both agree,
confidence is raised — independent signals agreeing is real evidence.

Every classification carries a confidence and a recorded reason. Below 85 the
node is surfaced for review before generation, because correcting a mapping
there costs far less than a refinement pass afterwards.

A bug worth remembering: `feature_grid`'s pattern originally had an optional
suffix, so "Feature card" matched the grid rule, and the grid rule was tested
first. Rule order and specificity both matter.

## Token extraction

Only values used at least twice become tokens. A value used once is incidental;
a value repeated is a decision. Colours rank by frequency, the type scale is
ordered by size so names stay stable across re-imports, and everything is
marked `source: "inferred"` — never mislabelled as a Figma variable.

## Credentials

Tokens live in `figma_connections`, which has **no client policy at all**. Only
the service role reads it. A browser session can learn that a connection exists,
via `my_figma_connection()`, but never the token. Local development can use
`FIGMA_PERSONAL_ACCESS_TOKEN` instead.

## Errors

`FigmaApiError` carries a stable code — `unauthorised`, `forbidden`,
`not_found`, `rate_limited`, `upstream` — and the UI copy is keyed off that.
Figma's own error text is never shown: it leaks internals and changes without
notice. Only idempotent GETs retry, and only on 429 or 5xx, honouring
`Retry-After`.

## Persistence

Nodes are written parent-before-child so the self-referencing foreign key always
resolves, in chunks of 500 because a real page is thousands of rows. Source ids
are not database ids, so the mapping is built during insert.

Re-importing replaces the design rows for that project rather than accumulating
duplicates.

## Not yet built

Asset download and upload to storage, Figma OAuth callback, variables and
component-set import, and moving ingestion to a queue worker. Ingestion is
currently awaited inside the server action, which is fine for a single page and
is the one function that changes when the queue lands.
