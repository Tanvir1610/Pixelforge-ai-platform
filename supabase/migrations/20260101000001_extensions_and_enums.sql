-- =============================================================================
-- 0001 · Extensions, enums and shared triggers
-- =============================================================================
create extension if not exists "pgcrypto";
create extension if not exists "vector";       -- pgvector, used from Phase 3 (RAG)
create extension if not exists "pg_trgm";      -- trigram search over code/design names

-- Roles are ordered by privilege. Comparisons use org_role_rank() below.
create type public.org_role as enum ('owner', 'admin', 'developer', 'designer', 'viewer');
create type public.project_role as enum ('admin', 'developer', 'designer', 'viewer');

create type public.project_status as enum ('draft', 'importing', 'analysing', 'generating', 'review', 'live', 'failed');
create type public.framework as enum ('nextjs', 'react', 'vue', 'html');
create type public.styling as enum ('tailwind', 'css_modules', 'vanilla_css');
create type public.host_provider as enum ('none', 'vercel', 'netlify', 'cloudflare');
create type public.run_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Timestamps
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authorization helpers.
--
-- Every one of these is SECURITY DEFINER with a pinned search_path. They are
-- called from RLS policies, so they must not themselves be subject to RLS or
-- the policy would recurse. STABLE lets Postgres cache them per statement,
-- which matters because they run once per row otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.org_role_rank(role public.org_role)
returns int
language sql
immutable
as $$
  select case role
    when 'owner' then 50
    when 'admin' then 40
    when 'developer' then 30
    when 'designer' then 20
    when 'viewer' then 10
  end;
$$;
