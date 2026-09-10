-- =============================================================================
-- 0018 · verify_upi_payment, again
--
-- 0017 applied only in part against the live project: `upi_payment_claims` and
-- its policies exist, the function does not. A dollar-quoted body pasted into a
-- SQL editor is the usual way that happens — the editor splits on `$$` and runs
-- half a statement.
--
-- The effect is worse than it looks. Claims can be submitted and nothing can
-- ever approve them, so every UPI payment strands: the money arrives and the
-- plan never activates, with no error anywhere to say why.
--
-- Everything here is `create or replace`, so this file is safe to run as often
-- as needed. Migrations are append-only, so 0017 is left as it was.
-- =============================================================================

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

  -- Named arguments, not positional. apply_subscription takes four optional
  -- trailing parameters, and a bare positional `null` among them is both
  -- unreadable and a resolution hazard if the signature ever grows.
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
