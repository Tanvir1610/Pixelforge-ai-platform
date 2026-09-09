-- =============================================================================
-- 0002 · Identity, organizations, projects  (Phase 1 — implemented)
-- =============================================================================

-- Supabase Auth owns credentials. We store only application profile data.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  plan        text not null default 'free' check (plan in ('free', 'pro', 'team')),
  ai_credits_limit int not null default 50 check (ai_credits_limit >= 0),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            public.org_role not null default 'developer',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, user_id)
);
create index on public.organization_members (user_id) where deleted_at is null;
create index on public.organization_members (organization_id) where deleted_at is null;

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  description     text,
  status          public.project_status not null default 'draft',
  framework       public.framework not null default 'nextjs',
  styling         public.styling not null default 'tailwind',
  typescript      boolean not null default true,
  responsive      boolean not null default true,
  host_provider   public.host_provider not null default 'none',
  -- Denormalised for list views; recomputed when a comparison run completes.
  match_score     numeric(5,2) check (match_score between 0 and 100),
  thumbnail_path  text,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, slug)
);
create index on public.projects (organization_id, updated_at desc) where deleted_at is null;
create index on public.projects using gin (name gin_trgm_ops);

create table public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.project_role not null default 'developer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (project_id, user_id)
);
create index on public.project_members (user_id) where deleted_at is null;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc) where read_at is null;

-- Append-only. Written by triggers and by the service role; never updated.
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id        uuid references public.profiles(id) on delete set null,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- New sign-up: create the profile, a personal organization, and the owner
-- membership in one transaction so a user is never left without a workspace.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  base_slug  text;
  final_slug text;
  suffix     int := 0;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if length(base_slug) < 3 then
    base_slug := 'workspace-' || base_slug;
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)) || '''s workspace',
          final_slug, new.id)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_organizations before update on public.organizations
  for each row execute function public.touch_updated_at();
create trigger touch_organization_members before update on public.organization_members
  for each row execute function public.touch_updated_at();
create trigger touch_projects before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger touch_project_members before update on public.project_members
  for each row execute function public.touch_updated_at();

-- The creator always gets explicit project membership, so project-level access
-- does not depend on their org role staying admin.
create or replace function public.add_project_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.add_project_creator_as_member();


-- ---------------------------------------------------------------------------
-- Authorization helpers.
--
-- Defined here rather than in 0001 because SQL-language functions are parsed
-- at CREATE time and these read the membership tables above. Each is SECURITY
-- DEFINER with a pinned search_path so RLS policies can call them without
-- recursing through the policies on the tables they read.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
  );
$$;

create or replace function public.org_role_of(org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = org_id
    and m.user_id = auth.uid()
    and m.deleted_at is null
  limit 1;
$$;

create or replace function public.has_org_role(org_id uuid, minimum public.org_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role_rank(public.org_role_of(org_id)) >= public.org_role_rank(minimum);
$$;

-- Project access = explicit project membership OR org-level admin/owner.
create or replace function public.can_read_project(project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.project_members pm
      on pm.project_id = p.id
     and pm.user_id = auth.uid()
     and pm.deleted_at is null
    where p.id = project
      and p.deleted_at is null
      and (
        pm.user_id is not null
        or public.has_org_role(p.organization_id, 'admin')
      )
  );
$$;

create or replace function public.can_write_project(project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.project_members pm
      on pm.project_id = p.id
     and pm.user_id = auth.uid()
     and pm.deleted_at is null
    where p.id = project
      and p.deleted_at is null
      and (
        pm.role in ('admin', 'developer', 'designer')
        or public.has_org_role(p.organization_id, 'admin')
      )
  );
$$;

comment on function public.can_read_project is
  'RLS predicate for every project-scoped table. Never bypass by querying projects directly from a policy.';
