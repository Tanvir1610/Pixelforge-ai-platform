# Architecture

## Layers

```
Product UI (Next.js App Router, RSC by default)
        │
Server actions + repositories        ← authorization, validation, presentation
        │
Supabase (Postgres · Auth · Storage · Realtime · RLS · pgvector)
        │
AI orchestration ── model abstraction ── providers (external → local → own)
        │
Sandbox execution (isolated build + browser)
```

Nothing above the model abstraction names a vendor. Nothing below the
repository layer is reachable from a client component.

## What exists today

| Layer | Status |
| --- | --- |
| Product UI | **Implemented** — 16 routes |
| Database schema | **Implemented** — 33 tables, verified against Postgres 16 |
| RLS + multi-tenancy | **Implemented** — 25 database assertions passing |
| Auth (email, OAuth, reset) | **Implemented** |
| Project system | **Implemented** — create, list, read |
| Model abstraction | **Interface + registry implemented**; no inference provider yet |
| Design IR | **Implemented** — types, normaliser, persistence |
| Figma ingestion | **Implemented** — URL → IR → Postgres |
| Realtime progress | **Implemented** |
| AI orchestration | Not started (Phase 3) |
| Code generation | Not started (Phase 4) |
| Sandbox / build | Not started (Phase 5) |
| Visual comparison | Not started (Phase 6) |

Screens for phases 2–7 exist in the UI and currently render fixed sample data.
They are the target the pipelines are being built against, not evidence the
pipelines work.

## Request path

A dashboard request goes: middleware refreshes the session → the page calls
`requireSession()` → a repository queries Supabase with the user's JWT → RLS
filters the rows → a presenter maps rows to view models → the component renders.

`getSession()` is wrapped in React `cache`, so a layout and its nested server
components share one round trip.

## Why the Design IR exists

Sending raw Figma JSON to a model would couple the platform to one vendor's API
shape, waste most of the context window on data the model cannot use, and give
the model no semantics to reason about. The IR is normalised, typed, stored
relationally, and is what every later stage reads. A second importer — Sketch,
screenshots, an existing codebase — targets the same IR and everything
downstream keeps working. See `DESIGN_IR.md`.

## Directory map

```
app/                    routes; interactive leaves are small client components
  auth/callback         OAuth + magic-link code exchange
  dashboard/            authenticated app
  project/[id]/         workspace: preview · code · compare · responsive
components/             ui · layout · sections · preview · ai
lib/
  supabase/             browser, server and service-role clients
  auth/                 session resolution, role guards, auth actions
  repositories/         data access; the only place queries live
  presenters/           database rows → view models
  validation/           Zod schemas; every action input passes through one
  ai/                   model abstraction, provider base, registry
  design-ir/            the IR types and traversal
  figma/                client, normaliser, semantics, tokens, responsive, ingest
  storage/              signed URLs for private buckets
supabase/
  migrations/           ordered, version-controlled schema
  tests/                RLS isolation suite
scripts/verify-db.sh    applies migrations + runs RLS tests against Postgres
```

## Conventions

- Server components by default; `"use client"` only where state or handlers are needed.
- No `any`. Database types are checked in and regenerated from migrations.
- Every server action validates through Zod before touching a repository.
- Repositories never trust a caller-supplied organization id; they read it from the session.
