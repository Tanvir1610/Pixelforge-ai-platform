# PixelForge AI

Turn designs into production-ready code.

An AI development platform that converts Figma designs into working websites.
The intelligence — design representation, orchestration, validation, project
memory — belongs to the platform. Foundation models are replaceable inference
providers behind an abstraction.

## Status

Phases 1–4 of 10 are complete: repository, Supabase, authentication,
database, multi-tenancy, project system, dashboard, Figma ingestion producing a
real Design IR, AI orchestration behind a provider abstraction, and the
planning, tool and versioning layers code generation will run on.

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
| Code generator + sandbox → deployment | Not started (Phases 5–7) |

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
npx supabase gen types typescript --linked > lib/db/database.types.ts
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
| [AI_ARCHITECTURE](docs/AI_ARCHITECTURE.md) | Pipeline, agents, persistence |
| [MODEL_PROVIDER](docs/MODEL_PROVIDER.md) | Abstraction and path to own models |
| [EVALUATION](docs/EVALUATION.md) | Metrics and method |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Environments and CI gates |

Each document states what is implemented and what is planned. None describes a
feature that does not exist.

## Connecting a Supabase project

```bash
supabase link --project-ref dggzgtwwzbzvepejpchq
npm run db:push          # applies all 7 migrations
npm run db:types         # regenerates lib/db/database.types.ts
npm run check:supabase   # verifies schema, RLS and buckets
```

Put the URL and anon key in `.env.local`. The service-role key is a secret:
keep it out of source control and out of chat.

## Next milestone

Phase 5: the Code Generator agent loop plus the sandbox — write files per
build-order step through the tool system, then install, typecheck and build the
result in an isolated environment.
