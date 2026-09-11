-- =============================================================================
-- 0020 · Credit reservations and rate limiting
--
-- Credits were checked and then charged, with nothing in between.
--
--   has_credits(org, n)   -- a STABLE read, no lock
--   ... model call ...
--   record_model_run(...) -- charges, but only when the call succeeded
--
-- Three faults follow from that shape:
--
-- 1. Time-of-check to time-of-use. Two requests arriving together both read a
--    sufficient balance and both proceed. The limit is advisory, not enforced,
--    and the more expensive the operation the more likely the race — code
--    generation issues one call per build-order step.
--
-- 2. A failed call is free to the user and not free to us. The tokens were
--    spent at the provider either way; charging zero on failure turns a failing
--    prompt into an unmetered way to spend the platform's money.
--
-- 3. Nothing stops the balance going negative. A generation that needs twenty
--    credits and has three left runs to completion and lands at minus
--    seventeen, with the overspend discovered afterwards.
--
-- The fix is the shape the product already documents: reserve, then settle or
-- release. A reservation is an outstanding claim on the balance — held against
-- it while the work runs, converted to a charge when the work succeeds, and
-- given back when it does not.
--
-- Safe to run more than once: every object is guarded, so a partial apply can
-- simply be re-run rather than unpicked.
-- =============================================================================

create table if not exists public.credit_reservations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,

  -- What was claimed, and what it actually cost. They differ: the caller
  -- reserves an estimate up front and settles the true figure afterwards.
  reserved        numeric not null check (reserved > 0),
  settled         numeric check (settled >= 0),

  purpose         text not null,
  status          text not null default 'held'
                    check (status in ('held', 'settled', 'released')),
  -- Why it was given back. Read by anyone asking where their credits went.
  release_reason  text,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- A held reservation that outlives this is treated as abandoned, so a crashed
  -- worker cannot strand a balance permanently.
  expires_at      timestamptz not null default now() + interval '30 minutes',
  resolved_at     timestamptz
);

create index if not exists credit_reservations_org_status_idx
  on public.credit_reservations (organization_id, status);
create index if not exists credit_reservations_held_idx
  on public.credit_reservations (status, expires_at) where status = 'held';

alter table public.credit_reservations enable row level security;

-- Readable by the workspace, so a user can see what is held against them.
-- Never client-writable: a reservation a browser could forge is not a limit.
drop policy if exists "read own credit reservations" on public.credit_reservations;
create policy "read own credit reservations" on public.credit_reservations
  for select using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- What is currently claimed but not yet charged.
-- ---------------------------------------------------------------------------
create or replace function public.held_credits(p_organization_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $held$
  select coalesce(sum(r.reserved), 0)
  from public.credit_reservations r
  where r.organization_id = p_organization_id
    and r.status = 'held'
    and r.expires_at > now();
$held$;

-- ---------------------------------------------------------------------------
-- Reserve, atomically.
--
-- The row lock on the organization is the whole point: it serialises every
-- concurrent reservation for one workspace, so two requests cannot both read a
-- sufficient balance. Returns null when there is not enough, rather than
-- raising — the caller has a message to show, not an exception to handle.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_organization_id uuid,
  p_needed numeric,
  p_purpose text,
  p_project_id uuid default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $reserve$
declare
  v_limit numeric;
  v_used numeric;
  v_held numeric;
  v_id uuid;
begin
  if p_needed <= 0 then
    raise exception 'a reservation must be for a positive number of credits'
      using errcode = 'check_violation';
  end if;

  -- Serialises concurrent reservations for this workspace.
  select o.ai_credits_limit into v_limit
  from public.organizations o
  where o.id = p_organization_id
  for update;

  if v_limit is null then
    return null;
  end if;

  select coalesce(sum(u.quantity), 0) into v_used
  from public.usage_records u
  where u.organization_id = p_organization_id
    and u.metric = 'ai_credits'
    and u.occurred_at >= date_trunc('month', now());

  v_held := public.held_credits(p_organization_id);

  -- Held credits count against the balance, or two reservations could each fit
  -- the remainder and together exceed it.
  if v_used + v_held + p_needed > v_limit then
    return null;
  end if;

  insert into public.credit_reservations (
    organization_id, project_id, reserved, purpose, created_by
  )
  values (p_organization_id, p_project_id, p_needed, p_purpose, p_actor)
  returning id into v_id;

  return v_id;
end;
$reserve$;

-- ---------------------------------------------------------------------------
-- Settle: the work succeeded, charge what it actually cost.
--
-- The actual figure may be under or over the estimate. Charging the actual is
-- the honest choice; the reservation only ever existed to stop the balance
-- being oversold while the work ran.
-- ---------------------------------------------------------------------------
create or replace function public.settle_credit_reservation(
  p_reservation_id uuid,
  p_actual numeric default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $settle$
declare
  v_reservation public.credit_reservations;
  v_charge numeric;
begin
  select * into v_reservation
  from public.credit_reservations
  where id = p_reservation_id
  for update;

  if v_reservation.id is null then
    raise exception 'no such reservation %', p_reservation_id using errcode = 'no_data_found';
  end if;

  -- Settling twice must not charge twice: a retried request is expected.
  if v_reservation.status <> 'held' then
    return coalesce(v_reservation.settled, 0);
  end if;

  v_charge := greatest(coalesce(p_actual, v_reservation.reserved), 0);

  update public.credit_reservations
  set status = 'settled', settled = v_charge, resolved_at = now()
  where id = p_reservation_id;

  -- The charge itself still goes through usage_records, which remains the one
  -- place a balance is computed from.
  if v_charge > 0 then
    insert into public.usage_records (organization_id, project_id, metric, quantity, metadata)
    values (
      v_reservation.organization_id,
      v_reservation.project_id,
      'ai_credits',
      v_charge,
      jsonb_build_object('reservation_id', p_reservation_id, 'purpose', v_reservation.purpose)
    );
  end if;

  return v_charge;
end;
$settle$;

-- ---------------------------------------------------------------------------
-- Release: the work failed, give the claim back.
--
-- Nothing is written to usage_records, so the credits were never charged — the
-- reservation simply stops counting against the balance.
-- ---------------------------------------------------------------------------
create or replace function public.release_credit_reservation(
  p_reservation_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $release$
declare
  v_status text;
begin
  select status into v_status
  from public.credit_reservations
  where id = p_reservation_id
  for update;

  if v_status is null or v_status <> 'held' then
    return false;
  end if;

  update public.credit_reservations
  set status = 'released', release_reason = p_reason, resolved_at = now()
  where id = p_reservation_id;

  return true;
end;
$release$;

-- ---------------------------------------------------------------------------
-- Expire abandoned reservations.
--
-- A worker that dies mid-generation leaves its claim held. Without this the
-- balance stays reduced forever, which looks to the user exactly like being
-- charged for work that never happened.
-- ---------------------------------------------------------------------------
create or replace function public.expire_credit_reservations()
returns integer
language sql
security definer
set search_path = public
as $expire$
  with expired as (
    update public.credit_reservations
    set status = 'released', release_reason = 'expired', resolved_at = now()
    where status = 'held' and expires_at <= now()
    returning 1
  )
  select count(*)::integer from expired;
$expire$;

-- ---------------------------------------------------------------------------
-- The balance a user sees now accounts for what is held.
--
-- The return shape is deliberately unchanged — (used, "limit", remaining) as
-- 0007 defined it. Changing it would need a DROP, which takes the grants with
-- it and breaks every caller for the sake of one extra column:
--   ERROR: cannot change return type of existing function
--
-- `remaining` is the number that was wrong: it ignored outstanding
-- reservations, so a user could be shown credits that were already claimed by
-- work in flight and be refused the moment they tried to spend them.
-- ---------------------------------------------------------------------------
create or replace function public.my_credit_balance(p_organization_id uuid)
returns table (used numeric, "limit" int, remaining numeric)
language sql
stable
security definer
set search_path = public
as $balance$
  select
    coalesce(sum(u.quantity), 0) as used,
    o.ai_credits_limit as "limit",
    greatest(
      0,
      o.ai_credits_limit - coalesce(sum(u.quantity), 0) - public.held_credits(o.id)
    ) as remaining
  from public.organizations o
  left join public.usage_records u
    on u.organization_id = o.id
   and u.metric = 'ai_credits'
   and u.occurred_at >= date_trunc('month', now())
  where o.id = p_organization_id
    and public.is_org_member(o.id)
  group by o.ai_credits_limit;
$balance$;

-- Service role only. A client that could reserve, settle or release its own
-- credits has no limit at all.
revoke execute on function public.reserve_credits(uuid, numeric, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.settle_credit_reservation(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.release_credit_reservation(uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_credit_reservations() from public, anon, authenticated;
grant execute on function public.my_credit_balance(uuid) to authenticated;
grant execute on function public.held_credits(uuid) to authenticated;

-- =============================================================================
-- Rate limiting
--
-- There was none. Every AI entry point is a server action that spends real
-- money at a provider, reachable by any signed-in user as fast as they can
-- issue requests. Credits bound the monthly total; nothing bounded the rate,
-- so a loop could exhaust a month's allowance in seconds and hold the
-- provider's rate limit against every other tenant while doing it.
--
-- Counted in the database rather than in memory because the application is
-- serverless: an in-process counter is per-instance, and the instance count is
-- not something the application controls.
-- =============================================================================
create table if not exists public.rate_limit_hits (
  id          bigserial primary key,
  -- Who and what, e.g. "generate:<organization id>".
  bucket      text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_idx
  on public.rate_limit_hits (bucket, occurred_at desc);

alter table public.rate_limit_hits enable row level security;
-- No policy at all: only the service role touches this.

/**
 * Records a hit and says whether it was within the limit.
 *
 * Writes first and counts afterwards, so a caller that ignores the answer is
 * still counted — a limiter that only counts the requests it lets through can
 * be defeated by ignoring it.
 */
create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $rate$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  insert into public.rate_limit_hits (bucket) values (p_bucket);

  select count(*), min(occurred_at) into v_count, v_oldest
  from public.rate_limit_hits
  where bucket = p_bucket and occurred_at > v_window_start;

  -- Opportunistic cleanup: this table is write-heavy and read-narrow, and a
  -- separate scheduled job for it would be one more thing to forget.
  delete from public.rate_limit_hits
  where occurred_at < now() - interval '1 day';

  return query select
    v_count <= p_limit,
    v_count,
    greatest(0, p_window_seconds - extract(epoch from (now() - coalesce(v_oldest, now())))::integer);
end;
$rate$;

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;

comment on function public.check_rate_limit is
  'Records a hit and reports whether the bucket is within its limit. Service role only.';
