# Deployment

## Environments

Development, staging, production — each with its own Supabase project. Secrets
come from environment variables only; nothing is committed. See `.env.example`.

## Setup

```bash
npm install
supabase link --project-ref <ref>
supabase db push                # applies supabase/migrations in order
npx supabase gen types typescript --linked > lib/db/database.types.ts
npm run dev
```

Without Supabase configured the app runs in demo mode on seeded data and shows a
banner saying so.

## Configuration

**Auth** — enable email/password; add Google and GitHub providers; set the
redirect URL to `{origin}/auth/callback`.

**Storage** — the six buckets are created by migration `0006`. All private.

## CI gates

```bash
npm run typecheck    # tsc --noEmit, strict
npm run lint         # eslint
npm test             # vitest
npm run db:verify    # migrations + RLS isolation suite against Postgres
npm run build        # next build
```

`db:verify` needs a Postgres instance; it applies every migration to a scratch
database and runs the RLS tests, so a broken policy fails the build rather than
production.

## Hosting

The frontend deploys to any Node host. The Python AI services and the sandbox
runners (Phases 3 and 5) deploy separately — heavy inference must not run in
Edge Functions, and generated code must never execute on the application server.
