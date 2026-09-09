-- =============================================================================
-- 0013 · Deployment  (Phase 7)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Host credentials.
--
-- Same posture as figma_connections: NO client policy at all. A deploy token
-- can create and destroy infrastructure on the user's account, so only the
-- service role — the deployment worker — may read it. A browser session can
-- learn that a connection exists, never the token.
-- ---------------------------------------------------------------------------
create table public.deployment_credentials (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  provider         public.host_provider not null,
  access_token     text not null,
  refresh_token    text,
  expires_at       timestamptz,
  -- Vercel team id, Netlify account slug, Cloudflare account id.
  account_id       text,
  account_label    text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  unique (organization_id, provider)
);

alter table public.deployment_credentials enable row level security;
-- Intentionally no policies.

create trigger touch_deployment_credentials before update on public.deployment_credentials
  for each row execute function public.touch_updated_at();

/** Non-secret projection, so the UI can show "Connected as …". */
create or replace function public.my_deployment_connections()
returns table (provider public.host_provider, account_label text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.provider,
    c.account_label,
    (c.revoked_at is null and (c.expires_at is null or c.expires_at > now()))
  from public.deployment_credentials c
  where public.is_org_member(c.organization_id);
$$;
grant execute on function public.my_deployment_connections() to authenticated;

-- ---------------------------------------------------------------------------
-- Deployment records
-- ---------------------------------------------------------------------------
alter table public.deployment_records
  add column provider_deployment_id text,
  add column environment text not null default 'production'
    check (environment in ('preview', 'production')),
  add column build_run_id uuid references public.build_runs(id) on delete set null,
  add column generation_run_id uuid references public.generation_runs(id) on delete set null,
  add column error_code text,
  add column error_message text,
  add column file_count int not null default 0,
  -- Which of our phases the deployment reached, for the progress UI.
  add column phase text not null default 'queued'
    check (phase in ('queued', 'uploading', 'building', 'deploying', 'live', 'failed', 'cancelled'));

create index on public.deployment_records (project_id, environment, created_at desc);
create unique index on public.deployment_records (provider, provider_deployment_id)
  where provider_deployment_id is not null;

-- ---------------------------------------------------------------------------
-- Opening a deployment.
--
-- Refuses to deploy a version whose build did not pass. Enforced here rather
-- than in application code because "never publish broken output" is the kind of
-- rule that must hold even when a caller forgets to check.
-- ---------------------------------------------------------------------------
create or replace function public.start_deployment(
  p_project_id uuid,
  p_code_version_id uuid,
  p_provider public.host_provider,
  p_environment text default 'production',
  p_generation_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deployment uuid;
  v_build uuid;
  v_build_status public.run_status;
  v_files int;
begin
  if not public.can_write_project(p_project_id) then
    raise exception 'insufficient privilege for project %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_provider = 'none' then
    raise exception 'no host is configured for this project'
      using errcode = 'check_violation';
  end if;

  select b.id, b.status into v_build, v_build_status
  from public.build_runs b
  where b.code_version_id = p_code_version_id
  order by b.created_at desc
  limit 1;

  if v_build is null then
    raise exception 'version has not been built yet'
      using errcode = 'check_violation';
  end if;

  if v_build_status <> 'completed' then
    raise exception 'refusing to deploy a version whose build did not pass'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_files
  from public.generated_files f
  where f.code_version_id = p_code_version_id and f.change_kind <> 'deleted';

  insert into public.deployment_records (
    project_id, code_version_id, build_run_id, generation_run_id,
    provider, environment, status, phase, file_count, created_by
  )
  values (
    p_project_id, p_code_version_id, v_build, p_generation_run_id,
    p_provider, p_environment, 'running', 'queued', v_files, auth.uid()
  )
  returning id into v_deployment;

  return v_deployment;
end;
$$;
grant execute on function public.start_deployment(uuid, uuid, public.host_provider, text, uuid) to authenticated;

/** Progress updates during a deployment. Service role only. */
create or replace function public.update_deployment_phase(
  p_deployment_id uuid,
  p_phase text,
  p_provider_deployment_id text default null,
  p_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deployment_records
  set phase = p_phase,
      provider_deployment_id = coalesce(p_provider_deployment_id, provider_deployment_id),
      url = coalesce(p_url, url)
  where id = p_deployment_id;
end;
$$;

create or replace function public.finish_deployment(
  p_deployment_id uuid,
  p_status public.run_status,
  p_url text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_commit_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  update public.deployment_records
  set status = p_status,
      phase = case when p_status = 'completed' then 'live'
                   when p_status = 'cancelled' then 'cancelled'
                   else 'failed' end,
      url = coalesce(p_url, url),
      error_code = p_error_code,
      error_message = p_error_message,
      commit_hash = coalesce(p_commit_hash, commit_hash),
      finished_at = now()
  where id = p_deployment_id
  returning project_id into v_project;

  -- A project is "live" only once something is actually serving.
  if p_status = 'completed' and v_project is not null then
    update public.projects set status = 'live' where id = v_project;
    perform public.record_usage(
      (select organization_id from public.projects where id = v_project),
      'deployments', 1, v_project, jsonb_build_object('deployment_id', p_deployment_id)
    );
  end if;
end;
$$;

revoke execute on function public.update_deployment_phase(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.finish_deployment(uuid, public.run_status, text, text, text, text)
  from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.deployment_records;
exception when undefined_object then null;
end $$;
