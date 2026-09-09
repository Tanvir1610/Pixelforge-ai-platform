-- =============================================================================
-- 0015 · Payments  (Razorpay)
--
-- Money is the one area where "roughly right" is never acceptable. Three rules
-- shape this schema:
--
--   1. The webhook is the source of truth, not the browser. A client telling us
--      it paid is a claim; a signed webhook is evidence.
--   2. Every provider event is recorded exactly once. Gateways retry, and a
--      retried event must not grant a second month of credits.
--   3. Entitlements are derived from a paid subscription, never set directly.
-- =============================================================================

create type public.payment_status as enum (
  'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'
);

create type public.billing_interval as enum ('monthly', 'yearly');

-- ---------------------------------------------------------------------------
-- Plan catalogue. In the database so pricing is auditable and a plan change is
-- a migration rather than a redeploy.
-- ---------------------------------------------------------------------------
create table public.billing_plans (
  key              text primary key check (key in ('free', 'pro', 'team')),
  display_name     text not null,
  -- Minor units (paise). Never floats: 0.1 + 0.2 must not decide a charge.
  amount_minor     int not null check (amount_minor >= 0),
  currency         text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  interval         public.billing_interval not null default 'monthly',
  ai_credits       int not null check (ai_credits >= 0),
  max_projects     int,
  provider_plan_id text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

insert into public.billing_plans (key, display_name, amount_minor, ai_credits, max_projects) values
  ('free', 'Free', 0, 50, 3),
  ('pro', 'Pro', 249900, 2000, null),
  ('team', 'Team', 829900, 10000, null)
on conflict (key) do nothing;

alter table public.billing_plans enable row level security;
create policy "anyone reads active plans" on public.billing_plans
  for select using (active);
grant select on public.billing_plans to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Customers. One per organization; the gateway id is what webhooks reference.
-- ---------------------------------------------------------------------------
create table public.payment_customers (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null unique references public.organizations(id) on delete cascade,
  provider             text not null default 'razorpay',
  provider_customer_id text not null,
  email                text,
  created_at           timestamptz not null default now(),
  unique (provider, provider_customer_id)
);

alter table public.payment_customers enable row level security;
create policy "read own customer" on public.payment_customers
  for select using (public.is_org_member(organization_id));
grant select on public.payment_customers to authenticated;

-- ---------------------------------------------------------------------------
-- Orders and payments.
--
-- An order is what we asked for; a payment is what the gateway did. Keeping
-- them separate is what lets an unmatched payment be detected rather than
-- silently accepted.
-- ---------------------------------------------------------------------------
create table public.payment_orders (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  plan_key          text not null references public.billing_plans(key),
  provider          text not null default 'razorpay',
  provider_order_id text not null,
  amount_minor      int not null check (amount_minor > 0),
  currency          text not null default 'INR',
  status            public.payment_status not null default 'created',
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (provider, provider_order_id)
);
create index on public.payment_orders (organization_id, created_at desc);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  order_id            uuid references public.payment_orders(id) on delete set null,
  provider            text not null default 'razorpay',
  provider_payment_id text not null,
  amount_minor        int not null check (amount_minor >= 0),
  amount_refunded_minor int not null default 0 check (amount_refunded_minor >= 0),
  currency            text not null default 'INR',
  status              public.payment_status not null,
  method              text,
  -- Failure reason from the gateway, for support. Never card data.
  failure_reason      text,
  captured_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (provider, provider_payment_id),
  check (amount_refunded_minor <= amount_minor)
);
create index on public.payments (organization_id, created_at desc);

alter table public.payment_orders enable row level security;
alter table public.payments enable row level security;

create policy "read own orders" on public.payment_orders
  for select using (public.is_org_member(organization_id));
create policy "read own payments" on public.payments
  for select using (public.is_org_member(organization_id));

-- Read-only from a session: everything here is written by the webhook worker.
grant select on public.payment_orders, public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Webhook ledger.
--
-- The primary key is the gateway's event id, which is what makes replay
-- impossible: a retried delivery collides and is rejected by the database
-- rather than by application logic that might be wrong.
-- ---------------------------------------------------------------------------
create table public.payment_webhook_events (
  provider_event_id text primary key,
  provider          text not null default 'razorpay',
  event_type        text not null,
  organization_id   uuid references public.organizations(id) on delete set null,
  payload           jsonb not null,
  processed_at      timestamptz,
  error_message     text,
  received_at       timestamptz not null default now()
);
create index on public.payment_webhook_events (event_type, received_at desc);

alter table public.payment_webhook_events enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------------------
-- Subscription entitlements.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column provider text not null default 'razorpay',
  add column provider_subscription_id text,
  add column plan_key text references public.billing_plans(key),
  add column current_period_start timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column latest_payment_id uuid references public.payments(id) on delete set null;

create unique index on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

/**
 * Applies a paid plan.
 *
 * Entitlements are derived here and nowhere else: the credit limit follows the
 * plan catalogue, so a plan change updates every organization on it and no
 * caller can invent a limit. Service role only.
 */
create or replace function public.apply_subscription(
  p_organization_id uuid,
  p_plan_key text,
  p_status text,
  p_provider_subscription_id text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_payment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits int;
begin
  select ai_credits into v_credits from public.billing_plans where key = p_plan_key;
  if v_credits is null then
    raise exception 'unknown plan %', p_plan_key using errcode = 'check_violation';
  end if;

  insert into public.subscriptions (
    organization_id, plan, plan_key, status, provider_subscription_id,
    current_period_start, current_period_end, latest_payment_id
  )
  values (
    p_organization_id, p_plan_key, p_plan_key, p_status, p_provider_subscription_id,
    p_period_start, p_period_end, p_payment_id
  )
  on conflict (organization_id) do update set
    plan = excluded.plan,
    plan_key = excluded.plan_key,
    status = excluded.status,
    provider_subscription_id = coalesce(excluded.provider_subscription_id,
                                        public.subscriptions.provider_subscription_id),
    current_period_start = coalesce(excluded.current_period_start,
                                    public.subscriptions.current_period_start),
    current_period_end = coalesce(excluded.current_period_end,
                                  public.subscriptions.current_period_end),
    latest_payment_id = coalesce(excluded.latest_payment_id, public.subscriptions.latest_payment_id),
    updated_at = now();

  -- Only an active subscription grants its plan's entitlements. A past_due or
  -- cancelled one keeps the row for history but drops the org to free limits.
  update public.organizations o
  set plan = case when p_status = 'active' then p_plan_key else 'free' end,
      ai_credits_limit = case
        when p_status = 'active' then v_credits
        else (select ai_credits from public.billing_plans where key = 'free')
      end
  where o.id = p_organization_id;
end;
$$;

revoke execute on function public.apply_subscription(uuid, text, text, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

/** Records an event exactly once. Returns false if it was already seen. */
create or replace function public.claim_webhook_event(
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_organization_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_webhook_events (provider_event_id, event_type, payload, organization_id)
  values (p_provider_event_id, p_event_type, p_payload, p_organization_id);
  return true;
exception when unique_violation then
  -- Already delivered. Gateways retry aggressively; this is expected, not an error.
  return false;
end;
$$;

revoke execute on function public.claim_webhook_event(text, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.complete_webhook_event(
  p_provider_event_id text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_webhook_events
  set processed_at = now(), error_message = p_error
  where provider_event_id = p_provider_event_id;
$$;

revoke execute on function public.complete_webhook_event(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Billing columns are not client-writable.
--
-- The "admins update organization" policy legitimately lets an admin rename
-- their workspace — but RLS is row-level, so the same policy also allowed
-- UPDATE organizations SET ai_credits_limit = 999999, i.e. a free user granting
-- themselves an unlimited plan.
--
-- Postgres has no column-level RLS, but GRANT is column-aware. Narrowing the
-- UPDATE grant to the columns a human may edit closes it: `plan` and
-- `ai_credits_limit` become writable only by the service role, through
-- apply_subscription.
-- ---------------------------------------------------------------------------
revoke update on public.organizations from authenticated;
grant update (name, slug) on public.organizations to authenticated;
