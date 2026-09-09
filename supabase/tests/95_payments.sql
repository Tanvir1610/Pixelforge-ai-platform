-- =============================================================================
-- Payments.
--
-- Two invariants: a retried webhook must never grant a second entitlement, and
-- no client may set its own plan or credit limit.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_stranger uuid; v_other_org uuid;
  v_payment uuid;
  v_claimed boolean; v_limit int; v_plan text; v_count int; v_denied boolean;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('pay@basalt.studio', '{"full_name":"Pay"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  -- ---- Starting position ---------------------------------------------------
  perform tests.assert(
    (select plan from public.organizations where id = v_org) = 'free',
    'a new organization starts on the free plan');
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = 50,
    'and on the free credit limit');

  -- ---- Webhook idempotency -------------------------------------------------
  perform tests.as_service();

  select public.claim_webhook_event('evt_001', 'payment.captured', '{"x":1}'::jsonb, v_org) into v_claimed;
  perform tests.assert(v_claimed, 'a new event is claimed');

  -- Gateways retry aggressively; the second delivery must be refused by the
  -- database, not by application logic that might be wrong.
  select public.claim_webhook_event('evt_001', 'payment.captured', '{"x":1}'::jsonb, v_org) into v_claimed;
  perform tests.assert(not v_claimed, 'a replayed event is refused');

  select count(*) into v_count from public.payment_webhook_events where provider_event_id = 'evt_001';
  perform tests.assert(v_count = 1, 'the event is stored exactly once');

  perform public.complete_webhook_event('evt_001');
  perform tests.assert(
    (select processed_at is not null from public.payment_webhook_events where provider_event_id = 'evt_001'),
    'a processed event is stamped');

  -- ---- Entitlements are derived, not asserted ------------------------------
  perform public.apply_subscription(v_org, 'pro', 'active');

  select plan, ai_credits_limit into v_plan, v_limit from public.organizations where id = v_org;
  perform tests.assert(v_plan = 'pro', 'an active subscription upgrades the plan');
  perform tests.assert(
    v_limit = (select ai_credits from public.billing_plans where key = 'pro'),
    'the credit limit follows the plan catalogue, not the caller');

  perform tests.assert(
    (select status from public.subscriptions where organization_id = v_org) = 'active',
    'the subscription row records the active status');

  -- Applying twice must not compound anything.
  perform public.apply_subscription(v_org, 'pro', 'active');
  perform tests.assert(
    (select count(*) from public.subscriptions where organization_id = v_org) = 1,
    'applying a plan twice does not create a second subscription');
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = v_limit,
    'and does not compound the credit limit');

  -- ---- Losing entitlement ---------------------------------------------------
  perform public.apply_subscription(v_org, 'pro', 'past_due');
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = 50,
    'a past_due subscription drops the org to free limits');
  perform tests.assert(
    (select plan from public.organizations where id = v_org) = 'free',
    'and to the free plan');
  perform tests.assert(
    (select status from public.subscriptions where organization_id = v_org) = 'past_due',
    'while the subscription row keeps the real status for history');

  -- A refund must remove what it paid for.
  perform public.apply_subscription(v_org, 'team', 'active');
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = 10000,
    'team grants the team credit limit');
  perform public.apply_subscription(v_org, 'free', 'canceled');
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = 50,
    'cancelling returns the org to free limits');

  -- An unknown plan must not silently grant nothing-or-everything.
  begin
    perform public.apply_subscription(v_org, 'enterprise_unlimited', 'active');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'an unknown plan key is rejected');

  -- ---- Money constraints ----------------------------------------------------
  insert into public.payments (organization_id, provider_payment_id, amount_minor, status)
    values (v_org, 'pay_1', 249900, 'captured') returning id into v_payment;

  begin
    update public.payments set amount_refunded_minor = 300000 where id = v_payment;
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a refund cannot exceed the amount paid');

  begin
    insert into public.payments (organization_id, provider_payment_id, amount_minor, status)
      values (v_org, 'pay_2', -100, 'captured');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a negative payment amount is rejected');

  begin
    insert into public.payments (organization_id, provider_payment_id, amount_minor, status)
      values (v_org, 'pay_1', 100, 'captured');
    v_denied := false;
  exception when unique_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'the same gateway payment cannot be recorded twice');

  -- ---- What a session may do -----------------------------------------------
  perform tests.login_as(v_owner);

  select count(*) into v_count from public.payments;
  perform tests.assert(v_count = 1, 'an org member can see their own payments');

  perform tests.assert(
    (select count(*) from public.billing_plans where active) = 3,
    'the plan catalogue is readable');

  -- The whole point: a user cannot grant themselves a paid plan.
  begin
    perform public.apply_subscription(v_org, 'team', 'active');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot apply a subscription');

  begin
    perform public.claim_webhook_event('evt_forged', 'payment.captured', '{}'::jsonb, v_org);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot forge a webhook event');

  -- RLS is row-level, so the "admins update organization" policy would
  -- otherwise let an admin grant themselves any credit limit. Column-level
  -- GRANTs are what actually close this.
  begin
    update public.organizations set ai_credits_limit = 999999 where id = v_org;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'an org admin cannot raise their own credit limit');

  begin
    update public.organizations set plan = 'team' where id = v_org;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'an org admin cannot promote their own plan');

  -- The legitimate case still works.
  update public.organizations set name = 'Renamed Studio' where id = v_org;
  perform tests.assert(
    (select name from public.organizations where id = v_org) = 'Renamed Studio',
    'an admin can still rename their workspace');

  begin
    insert into public.payments (organization_id, provider_payment_id, amount_minor, status)
      values (v_org, 'pay_forged', 999999, 'captured');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot insert a payment record');

  -- ---- Cross-tenant ---------------------------------------------------------
  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('rival@other.co', '{}'::jsonb) returning id into v_stranger;

  perform tests.login_as(v_stranger);
  select count(*) into v_count from public.payments;
  perform tests.assert(v_count = 0, 'payments are not visible across organizations');

  select count(*) into v_count from public.payment_webhook_events;
  perform tests.assert(v_count = 0, 'webhook events are invisible to every session');

  raise notice 'all payment tests passed';
end $$;

rollback;
