-- =============================================================================
-- 0014 · Custom domains, rollback and host OAuth  (Phase 7, part 2)
-- =============================================================================

create type public.domain_status as enum ('pending', 'verifying', 'verified', 'failed', 'removed');

-- ---------------------------------------------------------------------------
-- Custom domains.
--
-- Verification records are kept relationally rather than as a blob because the
-- UI has to show the user exactly which DNS record to create, and support has
-- to be able to see what we asked for.
-- ---------------------------------------------------------------------------
create table public.project_domains (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  domain           text not null check (
                     domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                     and length(domain) <= 253
                   ),
  provider         public.host_provider not null,
  status           public.domain_status not null default 'pending',
  is_primary       boolean not null default false,
  -- What the user must add at their registrar, verbatim.
  verification_type text check (verification_type in ('TXT', 'CNAME', 'A')),
  verification_name text,
  verification_value text,
  last_checked_at  timestamptz,
  verified_at      timestamptz,
  error_message    text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, domain)
);

create index on public.project_domains (project_id, status);
-- At most one primary domain per project; the partial index makes it impossible
-- rather than merely discouraged.
create unique index on public.project_domains (project_id) where is_primary;

alter table public.project_domains enable row level security;

create policy "read project domains" on public.project_domains
  for select using (public.can_read_project(project_id));
create policy "write project domains" on public.project_domains
  for all using (public.can_write_project(project_id))
  with check (public.can_write_project(project_id));

grant select, insert, update, delete on public.project_domains to authenticated;

create trigger touch_project_domains before update on public.project_domains
  for each row execute function public.touch_updated_at();

/**
 * Records what the host told us to verify. Service role only: the values come
 * from the host API, never from a client, or a user could claim any domain.
 */
create or replace function public.set_domain_verification(
  p_domain_id uuid,
  p_status public.domain_status,
  p_type text default null,
  p_name text default null,
  p_value text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.project_domains
  set status = p_status,
      verification_type = coalesce(p_type, verification_type),
      verification_name = coalesce(p_name, verification_name),
      verification_value = coalesce(p_value, verification_value),
      error_message = p_error,
      last_checked_at = now(),
      verified_at = case when p_status = 'verified' then now() else verified_at end
  where id = p_domain_id;
end;
$$;

revoke execute on function public.set_domain_verification(uuid, public.domain_status, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rollback.
--
-- Redeploys the version an earlier deployment used. Additive, like the code
-- version restore: nothing is rewound, a new deployment is created that happens
-- to publish older files, and the rollback itself can be rolled back.
-- ---------------------------------------------------------------------------
alter table public.deployment_records
  add column rolled_back_from uuid references public.deployment_records(id) on delete set null;

create or replace function public.rollback_deployment(p_deployment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_version uuid;
  v_provider public.host_provider;
  v_environment text;
  v_status public.run_status;
  v_new uuid;
begin
  select d.project_id, d.code_version_id, d.provider, d.environment, d.status
  into v_project, v_version, v_provider, v_environment, v_status
  from public.deployment_records d
  where d.id = p_deployment_id;

  if v_project is null then
    raise exception 'deployment % does not exist', p_deployment_id;
  end if;

  -- Rolling back to something that never went live would publish output no one
  -- has ever seen working, which is the opposite of what a rollback is for.
  if v_status <> 'completed' then
    raise exception 'can only roll back to a deployment that went live'
      using errcode = 'check_violation';
  end if;

  -- start_deployment re-checks authorization and the build gate.
  v_new := public.start_deployment(v_project, v_version, v_provider, v_environment, null);

  update public.deployment_records
  set rolled_back_from = p_deployment_id
  where id = v_new;

  return v_new;
end;
$$;
grant execute on function public.rollback_deployment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- OAuth connect flows.
--
-- The state token is stored server-side and consumed once. Without it, an
-- attacker can complete a callback against a victim's session and attach their
-- own host account to the victim's organization.
-- ---------------------------------------------------------------------------
create table public.oauth_states (
  state            text primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  provider         text not null,
  redirect_path    text not null default '/dashboard/deployments',
  -- Short-lived: a state that outlives the flow is an attack window.
  expires_at       timestamptz not null default now() + interval '10 minutes',
  consumed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index on public.oauth_states (organization_id, created_at desc);

alter table public.oauth_states enable row level security;
-- No policies: created and consumed by the service role only.

/** Consumes a state token exactly once and returns its context. */
create or replace function public.consume_oauth_state(p_state text)
returns table (organization_id uuid, user_id uuid, provider text, redirect_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.oauth_states s
  set consumed_at = now()
  where s.state = p_state
    and s.consumed_at is null
    and s.expires_at > now()
  returning s.organization_id, s.user_id, s.provider, s.redirect_path;
end;
$$;

revoke execute on function public.consume_oauth_state(text) from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.project_domains;
exception when undefined_object then null;
end $$;
