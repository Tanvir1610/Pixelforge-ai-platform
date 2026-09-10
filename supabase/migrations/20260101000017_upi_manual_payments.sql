-- =============================================================================
-- 0017 · UPI payments, verified by hand
--
-- UPI collection through a plain VPA has no callback. Nothing tells the
-- application that money arrived, and a static QR encodes only the payee — not
-- the amount, and not which order it belongs to. So the honest model is a claim:
-- the payer says "I sent this reference", and somebody checks.
--
-- The important consequence is in the shape of these tables. A claim NEVER
-- grants anything. Only `verify_upi_payment` does, it is service-role only, and
-- it is the single place that writes a payment row and applies the plan. Were a
-- claim itself to confer entitlement, anyone could upgrade for free by typing
-- twelve digits.
-- =============================================================================

create table public.upi_payment_claims (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  payment_order_id  uuid not null references public.payment_orders(id) on delete cascade,
  plan_key          text not null references public.billing_plans(key),
  amount_minor      int not null check (amount_minor > 0),

  -- The UTR / RRN the payer reads off their UPI app. Unique, because the same
  -- transaction must not be claimed twice, by the same workspace or another.
  reference         text not null,

  status            text not null default 'pending'
                      check (status in ('pending', 'verified', 'rejected')),
  -- Why it was rejected, or any note from the reviewer. Shown to the payer.
  note              text,

  claimed_by        uuid references public.profiles(id) on delete set null,
  claimed_at        timestamptz not null default now(),
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,

  unique (reference)
);

create index on public.upi_payment_claims (organization_id, claimed_at desc);
create index on public.upi_payment_claims (status, claimed_at) where status = 'pending';

alter table public.upi_payment_claims enable row level security;

-- A workspace sees its own claims, so the payer can watch one being reviewed.
create policy "read own upi claims" on public.upi_payment_claims
  for select using (public.is_org_member(organization_id));

-- Only an admin can claim, because only an admin can start the checkout that
-- creates the order it points at.
create policy "admins claim upi payments" on public.upi_payment_claims
  for insert with check (
    public.has_org_role(organization_id, 'admin')
    and claimed_by = auth.uid()
    and status = 'pending'
  );

-- Deliberately no update or delete policy. A claim is a statement of fact from
-- the payer; revising it is not theirs to do, and reviewing it happens through
-- the function below under the service role.

-- ---------------------------------------------------------------------------
-- Review a claim.
--
-- One statement, so a verified claim and the payment it produced cannot come
-- apart: either the plan is applied and the payment recorded, or neither is.
-- ---------------------------------------------------------------------------
create or replace function public.verify_upi_payment(
  p_claim_id uuid,
  p_approve boolean,
  p_reviewer uuid default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $verify_upi$
declare
  v_claim public.upi_payment_claims;
  v_period_end timestamptz;
begin
  select * into v_claim from public.upi_payment_claims where id = p_claim_id for update;

  if v_claim.id is null then
    raise exception 'no such claim %', p_claim_id using errcode = 'no_data_found';
  end if;

  -- Re-reviewing is a no-op rather than an error: a double click on an approve
  -- button must not apply a second month of credits.
  if v_claim.status <> 'pending' then
    return v_claim.status;
  end if;

  if not p_approve then
    update public.upi_payment_claims
    set status = 'rejected', note = p_note, reviewed_by = p_reviewer, reviewed_at = now()
    where id = p_claim_id;
    return 'rejected';
  end if;

  update public.upi_payment_claims
  set status = 'verified', note = p_note, reviewed_by = p_reviewer, reviewed_at = now()
  where id = p_claim_id;

  update public.payment_orders
  set status = 'captured'
  where id = v_claim.payment_order_id;

  -- The reference is the provider payment id: it is what identifies this
  -- transaction in the bank statement, and the unique constraint on
  -- (provider, provider_payment_id) makes a repeat application impossible.
  insert into public.payments (
    organization_id, order_id, provider, provider_payment_id,
    amount_minor, currency, status, method, captured_at
  )
  values (
    v_claim.organization_id, v_claim.payment_order_id, 'upi_manual', v_claim.reference,
    v_claim.amount_minor, 'INR', 'captured', 'upi', now()
  )
  on conflict (provider, provider_payment_id) do nothing;

  v_period_end := now() + interval '1 month';

  perform public.apply_subscription(
    p_organization_id => v_claim.organization_id,
    p_plan_key        => v_claim.plan_key,
    p_status          => 'active',
    p_period_start    => now(),
    p_period_end      => v_period_end
  );

  return 'verified';
end;
$verify_upi$;

-- Service role only. A signed-in user verifying their own payment is the whole
-- attack, so `authenticated` must never hold this.
revoke execute on function public.verify_upi_payment(uuid, boolean, uuid, text) from public, anon, authenticated;

comment on function public.verify_upi_payment is
  'Approves or rejects a UPI claim. The only path from a claim to an entitlement. Service role only.';
