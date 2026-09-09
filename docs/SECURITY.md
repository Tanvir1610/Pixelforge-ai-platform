# Security

## The authorization boundary is the database

RLS is enabled on every table in `public`. There is no table a signed-in user
can read by default. Server code holds the user's JWT and queries as the
`authenticated` role, so policies apply to every query the application makes.

The Next.js checks (`requireSession`, `requireOrgRole`, middleware redirects)
are defence in depth and exist to fail fast with a clear message. If all of them
were removed, a user would still see nothing outside their organization.

Both RLS **and** table `GRANT`s are required: RLS restricts which rows a role may
touch, `GRANT` decides whether it may touch the table at all. `anon` is granted
nothing — an unauthenticated request never reaches application data, and the
marketing pages read no database.

### Verified, not assumed

`supabase/tests/10_rls_isolation.sql` runs against real Postgres and asserts:

- a user sees only their own organization and projects
- reading, creating or updating another org's project is refused
- project-scoped child tables (`design_tokens`, `ai_messages`, …) inherit the boundary
- a member of another org cannot alter memberships
- a `viewer` can read but not write

18 assertions, run by `npm run db:verify` in CI.

## Service role

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is read only through
`getServiceRoleKey()`, only in `createServiceClient()`, and only from
`server-only` modules. It is used for trusted background work that has already
done its own authorization: worker pipelines, usage metering, audit writes. It
is never used in response to unvalidated user input.

Four tables have no client write policy at all — `audit_logs`, `model_runs`,
`usage_records`, `build_errors` — so even a policy bug cannot let a client forge
an audit entry or under-report usage.

## Storage

Every bucket is private. Object paths are `{project_id}/…` so the policy
resolves the owning project from the first path segment and reuses
`can_read_project` / `can_write_project`. Access is by short-lived signed URL;
objects are never public. A malformed path resolves to `null` and is denied.

## Prompt injection

Imported content is data, never instruction. Figma text layers, README files,
code comments and fetched pages can all contain text that looks like a command.

The message model separates trust levels explicitly: `ModelMessage.untrusted`
marks content from outside the boundary, and `BaseModelProvider.fence()` wraps
it in a delimiter block that tells the model to treat it as data. An attempt to
close the fence early is escaped, which `tests/model-registry.test.ts` asserts.

System instructions, user instructions, project data, external data and tool
output stay in distinct turns. Project content can never escalate into the
system turn.

## User enumeration

Sign-in maps every failure to one message: "that email and password combination
doesn't match an account." Password reset always reports success. Whether an
account exists is not observable.

## Open redirect

`/auth/callback` honours `next` only when it is a same-origin relative path;
`//evil.test` and absolute URLs fall back to `/dashboard`.

## Sandbox (Phase 5, not yet built)

Generated code will never execute on the application server. Planned isolation:
separate filesystem, CPU and memory limits, no network by default, process
timeout, no access to secrets, the production database, or internal APIs.

## Not yet implemented

Rate limiting, API key issuance and verification, audit-log write triggers,
and the sandbox. Tracked as Phase 8 and Phase 5 respectively.
