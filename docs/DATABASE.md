# Database

Postgres 16 on Supabase. 33 tables across five domains. Every migration in
`supabase/migrations/` is applied in filename order and is verified in CI by
`npm run db:verify`, which applies them to a scratch database and runs the RLS
suite.

## Domains

**Identity** — `profiles`, `organizations`, `organization_members`, `projects`,
`project_members`, `notifications`, `audit_logs`.

**Design** — `figma_files`, `figma_pages`, `figma_frames`, `design_nodes`
(the IR), `design_tokens`, `design_components`, `design_component_variants`,
`design_assets`.

**Generation** — `generated_projects`, `code_versions`, `generated_files`,
`generation_runs`, `generation_steps`, `ai_messages`, `ai_tool_calls`.

**Delivery** — `build_runs`, `build_errors`, `visual_comparisons`,
`visual_difference_regions`, `deployment_records`.

**Platform** — `model_providers`, `model_runs`, `usage_records`,
`subscriptions`, `api_keys`, `figma_connections`.

## Functions

`record_usage` writes a usage row and returns the month-to-date total, so a
caller can enforce a limit without a second round trip. It is revoked from
`authenticated` — only the service role may meter usage.

`my_credit_balance` and `my_figma_connection` are SECURITY DEFINER projections
that return non-secret columns only. `figma_connections` itself has no client
policy at all, so an OAuth token is never reachable from a browser session.

`start_generation_run` opens a run and its steps in one call after checking
`can_write_project`, so the UI has rows to subscribe to immediately.

## Design decisions

**Relational, not JSON blobs.** `design_nodes` has real columns for position,
layout, typography and style, because those are queried and filtered. JSONB is
used only for genuinely open-ended data: `effects`, `constraints`,
`responsive_hints`, `interactions`.

**Adjacency list for the IR tree.** One row per node with `parent_id` and
`depth`. Indexed on `(project_id, figma_frame_id)` and `parent_id`.

**Soft deletion where recovery matters** — organizations, projects, memberships
carry `deleted_at`. Every RLS policy and index filters on it.

**Raw payloads live in storage.** `figma_files.raw_payload_path` points at the
private bucket; the JSON is never inlined into a row.

**Usage is derived, never asserted.** `usage_records` is append-only and written
only by the service role. `getProjectStats` sums it server-side. A client figure
is never trusted (§42).

## Authorization helpers

`is_org_member`, `org_role_of`, `has_org_role`, `can_read_project`,
`can_write_project`. All `SECURITY DEFINER` with a pinned `search_path`, so RLS
policies can call them without recursing through the policies on the tables they
read. All `STABLE`, so Postgres caches them per statement instead of once per row.

They are defined in migration `0002`, after the tables they query: SQL-language
functions are parsed at `CREATE` time, so defining them earlier fails.

## Migrations

```bash
supabase migration new <name>     # create
supabase db push                  # apply to the linked project
npm run db:verify                 # apply to scratch Postgres + run RLS tests
npx supabase gen types typescript --linked > lib/db/database.types.ts
```

Never edit an applied migration; add a new one.
