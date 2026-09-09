-- =============================================================================
-- 0007 · Figma OAuth connections, usage metering, audit trail  (Phase 2)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Figma OAuth tokens.
--
-- There is deliberately NO client policy on this table. Tokens are readable
-- only by the service role, which is what the ingestion worker runs as. A
-- browser session can see that a connection exists (via the view below) but
-- never the token itself.
-- ---------------------------------------------------------------------------
create table public.figma_connections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  figma_user_id    text not null,
  figma_handle     text,
  access_token     text not null,
  refresh_token    text,
  expires_at       timestamptz,
  scopes           text[] not null default array['file_read'],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  unique (organization_id, user_id)
);
create index on public.figma_connections (organization_id) where revoked_at is null;

alter table public.figma_connections enable row level security;
-- No policies: service role only. Revoking access is a service-role operation.

create trigger touch_figma_connections before update on public.figma_connections
  for each row execute function public.touch_updated_at();

-- Safe projection: does this user have a live Figma connection, and as whom?
create view public.figma_connection_status
with (security_invoker = true) as
  select
    c.organization_id,
    c.user_id,
    c.figma_handle,
    c.expires_at,
    (c.revoked_at is null and (c.expires_at is null or c.expires_at > now())) as is_active
  from public.figma_connections c;

grant select on public.figma_connection_status to authenticated;

-- security_invoker means the view runs with the caller's privileges, so the
-- absence of a policy on the base table still applies. Expose it through a
-- SECURITY DEFINER function instead, returning only non-secret columns.
create or replace function public.my_figma_connection()
returns table (figma_handle text, expires_at timestamptz, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.figma_handle,
    c.expires_at,
    (c.revoked_at is null and (c.expires_at is null or c.expires_at > now()))
  from public.figma_connections c
  where c.user_id = auth.uid()
    and public.is_org_member(c.organization_id)
  limit 1;
$$;
grant execute on function public.my_figma_connection() to authenticated;

-- ---------------------------------------------------------------------------
-- Usage metering.
--
-- Usage is only ever written here, by the service role, through this function.
-- It returns the running total so a caller can enforce a limit without a second
-- round trip. §42: never trust a client-supplied usage figure.
-- ---------------------------------------------------------------------------
create or replace function public.record_usage(
  p_organization_id uuid,
  p_metric text,
  p_quantity numeric,
  p_project_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  period_start timestamptz := date_trunc('month', now());
  total numeric;
begin
  insert into public.usage_records (organization_id, project_id, metric, quantity, metadata)
  values (p_organization_id, p_project_id, p_metric, p_quantity, p_metadata);

  select coalesce(sum(u.quantity), 0) into total
  from public.usage_records u
  where u.organization_id = p_organization_id
    and u.metric = p_metric
    and u.occurred_at >= period_start;

  return total;
end;
$$;

revoke execute on function public.record_usage(uuid, text, numeric, uuid, jsonb) from public, anon, authenticated;

-- Remaining AI credits for the caller's organization, for the current month.
create or replace function public.my_credit_balance(p_organization_id uuid)
returns table (used numeric, "limit" int, remaining numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(u.quantity), 0) as used,
    o.ai_credits_limit as "limit",
    greatest(0, o.ai_credits_limit - coalesce(sum(u.quantity), 0)) as remaining
  from public.organizations o
  left join public.usage_records u
    on u.organization_id = o.id
   and u.metric = 'ai_credits'
   and u.occurred_at >= date_trunc('month', now())
  where o.id = p_organization_id
    and public.is_org_member(o.id)
  group by o.ai_credits_limit;
$$;
grant execute on function public.my_credit_balance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail. Written by trigger so it cannot be forgotten at a call site.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  resource uuid;
begin
  if TG_OP = 'DELETE' then
    org := old.organization_id;
    resource := old.id;
  else
    org := new.organization_id;
    resource := new.id;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, metadata)
  values (
    org,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    resource,
    case when TG_OP = 'UPDATE'
      then jsonb_build_object('status', new.status)
      else '{}'::jsonb
    end
  );

  return coalesce(new, old);
end;
$$;

create trigger audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Import bookkeeping: one call opens a generation run with its steps, so the
-- UI has rows to subscribe to the instant the user clicks Import.
-- ---------------------------------------------------------------------------
create or replace function public.start_generation_run(
  p_project_id uuid,
  p_trigger text,
  p_steps text[][]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
  i int;
begin
  if not public.can_write_project(p_project_id) then
    raise exception 'insufficient privilege for project %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.generation_runs (project_id, trigger, status, created_by)
  values (p_project_id, p_trigger, 'queued', auth.uid())
  returning id into run_id;

  for i in 1 .. coalesce(array_length(p_steps, 1), 0) loop
    insert into public.generation_steps (generation_run_id, key, label, order_index, status)
    values (run_id, p_steps[i][1], p_steps[i][2], i, 'queued');
  end loop;

  return run_id;
end;
$$;
grant execute on function public.start_generation_run(uuid, text, text[][]) to authenticated;

-- Realtime: the workspace subscribes to progress rather than polling (§30).
do $$ begin
  alter publication supabase_realtime add table public.generation_runs;
  alter publication supabase_realtime add table public.generation_steps;
  alter publication supabase_realtime add table public.build_runs;
exception
  when undefined_object then null;  -- publication absent in local verification
end $$;
