# PixelForge AI

Turn designs into production-ready code.

An AI development platform that converts Figma designs into working websites.
The intelligence — design representation, orchestration, validation, project
memory — belongs to the platform. Foundation models are replaceable inference
providers behind an abstraction.

## Status

Phases 1–7 of 10 are complete: repository, Supabase, authentication,
database, multi-tenancy, project system, dashboard, Figma ingestion producing a
real Design IR, AI orchestration behind a provider abstraction, and the
planning, tool and versioning layers, code generation with a sandboxed build,
visual comparison producing scored, fixable differences, and deployment to
three hosts behind one interface.

| Subsystem | State |
| --- | --- |
| Product UI (16 routes) | Implemented |
| Database (32 tables) | Implemented, verified against Postgres 16 |
| RLS multi-tenancy | Implemented, 18 isolation tests passing |
| Auth: email, OAuth, reset | Implemented |
| Project system | Implemented |
| Figma ingestion | Implemented — URL → IR → Postgres, 45 tests |
| Design IR | Implemented — types, normaliser, persistence |
| Token extraction | Implemented — colour, type, spacing, radius, shadow |
| Semantic detection | Implemented — name + shape signals with confidence |
| Realtime run progress | Implemented |
| Model abstraction | Implemented — interface, registry, Anthropic provider |
| AI orchestration | Implemented — Design Analyst, artifacts, corrections |
| Cost control + quotas | Implemented — gated before the call, metered atomically |
| Architecture + component planners | Implemented — settings enforced over the model |
| AI tool system | Implemented — mode-gated, schema-validated, fully audited |
| Code versioning | Implemented — immutable snapshots, additive restore |
| Code generator | Implemented — stepwise, one version per generation |
| Sandbox + build pipeline | Implemented — env-scrubbed, tested with real processes |
| Build error parsing + repair loop | Implemented — bounded, phase-ordered |
| Visual comparison | Implemented — geometry + pixel, scored and fixable |
| Browser capture | Written, **untested** — no browser available here |
| Deployment | Implemented — Vercel, Netlify, Cloudflare behind one interface |
| Domains, rollback, host OAuth | Implemented — verification, additive rollback, single-use state |
| Host clients | Written and unit-tested; **not run against live APIs** |
| Payments (Razorpay) | Implemented — signed webhooks, idempotent, derived entitlements |
| Evaluation, training data, own models | Not started (Phases 8–10) |

Screens for the unbuilt phases exist and render fixed sample data. They are the
target the pipelines are built against, not a claim that the pipelines work.
Anything backed by seeded data says so on screen.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — omit to run in demo mode
npm run dev
```

With no Supabase credentials the app runs on seeded data and shows a demo
banner. To connect a real workspace:

```bash
supabase link --project-ref <ref>
supabase db push
# lib/db/database.types.ts is hand-written, not generated - see its header.
npm run typecheck
```

## Scripts

```bash
npm run dev         npm run build      npm start
npm run typecheck   npm run lint       npm test
npm run db:verify   # migrations + RLS and IR suites against Postgres
npm run check:supabase  # preflight against a live project
```

## Stack

Next.js 16 (App Router, RSC) · React 19 · TypeScript strict · Tailwind ·
Supabase (Postgres, Auth, Storage, RLS, pgvector) · Zod · Vitest

## Documentation

| Document | Covers |
| --- | --- |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, request path, directory map |
| [DATABASE](docs/DATABASE.md) | Schema, design decisions, migrations |
| [SECURITY](docs/SECURITY.md) | RLS boundary, service role, prompt injection |
| [DESIGN_IR](docs/DESIGN_IR.md) | The internal design representation |
| [FIGMA_INGESTION](docs/FIGMA_INGESTION.md) | Phase 2 pipeline, in detail |
| [PHASE3_ORCHESTRATION](docs/PHASE3_ORCHESTRATION.md) | Agents, context budgeting, accounting |
| [PHASE4_CODEGEN](docs/PHASE4_CODEGEN.md) | Planners, tool system, versioning |
| [PHASE5_SANDBOX](docs/PHASE5_SANDBOX.md) | Generation, sandbox isolation, repair loop |
| [PHASE6_VISUAL_QA](docs/PHASE6_VISUAL_QA.md) | Geometry vs pixel comparison, scoring |
| [PHASE7_DEPLOYMENT](docs/PHASE7_DEPLOYMENT.md) | Host providers, the build gate, polling |
| [PAYMENTS](docs/PAYMENTS.md) | Razorpay, webhook trust model, money handling |
| [AI_ARCHITECTURE](docs/AI_ARCHITECTURE.md) | Pipeline, agents, persistence |
| [MODEL_PROVIDER](docs/MODEL_PROVIDER.md) | Abstraction and path to own models |
| [EVALUATION](docs/EVALUATION.md) | Metrics and method |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Environments and CI gates |

Each document states what is implemented and what is planned. None describes a
feature that does not exist.

## Connecting a Supabase project

```bash
supabase link --project-ref dggzgtwwzbzvepejpchq
npm run db:push          # applies all 16 migrations
npm run typecheck        # database.types.ts is hand-written — see its header
npm run check:supabase   # verifies schema, RLS and buckets
```

Put the URL and anon key in `.env.local`. The service-role key is a secret:
keep it out of source control and out of chat.

## Next milestone

Phase 8: evaluation and observability — a frozen corpus, scored runs attributed
to model and provider, and the cost/quality dashboard that decides whether a
model swap is an improvement.
