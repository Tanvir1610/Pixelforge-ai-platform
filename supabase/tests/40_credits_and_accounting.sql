-- =============================================================================
-- Credit gating and model-run accounting.
--
-- Usage is the one number a client must never be able to influence, and a run
-- must never be logged without being charged or charged without being logged.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid;
  v_run_a uuid; v_run_b uuid;
  v_total numeric; v_runs int; v_credits numeric;
  v_denied boolean;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('credits@basalt.studio', '{"full_name":"Cred"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org, 'Northwind', 'northwind', v_owner) returning id into v_project;

  -- Free plan default.
  perform tests.assert(
    (select ai_credits_limit from public.organizations where id = v_org) = 50,
    'a new organization starts on the free credit limit');

  perform tests.login_as(v_owner);
  perform tests.assert(public.has_credits(v_org, 1), 'a fresh organization has credits');

  -- ---- Accounting is atomic ----------------------------------------------
  perform tests.as_service();
  select public.record_model_run(
    v_org, 'claude-sonnet-4-6', 'design_analysis',
    5000, 800, 0.027, 900, 'completed', v_project, null, 'anthropic', 3
  ) into v_run_a;

  perform tests.assert(v_run_a is not null, 'a completed model run is recorded');

  perform tests.assert(
    (select cost_usd from public.model_runs where id = v_run_a) = 0.027,
    'cost is stored to six decimal places');

  perform tests.assert(
    (select model_provider_id from public.model_runs where id = v_run_a)
      = (select id from public.model_providers where key = 'anthropic'),
    'the run is attributed to the provider that served it');

  select coalesce(sum(quantity), 0) into v_credits
  from public.usage_records
  where organization_id = v_org and metric = 'ai_credits';
  perform tests.assert(v_credits = 3, 'a completed run charges credits in the same transaction');

  -- ---- A failed call is logged but not charged ---------------------------
  select public.record_model_run(
    v_org, 'claude-sonnet-4-6', 'design_analysis',
    4000, 0, 0.012, 400, 'failed', v_project, null, 'anthropic', 0
  ) into v_run_b;

  select count(*) into v_runs from public.model_runs where organization_id = v_org;
  perform tests.assert(v_runs = 2, 'the failed run is still logged');

  select coalesce(sum(quantity), 0) into v_credits
  from public.usage_records
  where organization_id = v_org and metric = 'ai_credits';
  perform tests.assert(v_credits = 3, 'a failed run is not charged');

  -- ---- The gate closes at the limit --------------------------------------
  perform public.record_usage(v_org, 'ai_credits', 47, v_project);

  perform tests.login_as(v_owner);
  perform tests.assert(not public.has_credits(v_org, 1), 'the gate closes once the limit is reached');
  perform tests.assert(
    (select remaining from public.my_credit_balance(v_org)) = 0,
    'the reported balance reaches zero, never negative');

  -- ---- A client cannot forge usage ---------------------------------------
  begin
    insert into public.usage_records (organization_id, metric, quantity)
      values (v_org, 'ai_credits', -1000);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot write usage records directly');

  begin
    perform public.record_usage(v_org, 'ai_credits', -1000, v_project);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot call record_usage');

  begin
    perform public.record_model_run(v_org, 'x', 'design_analysis', 1, 1, 0, 1);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot call record_model_run');

  -- ---- Raising the limit reopens the gate --------------------------------
  perform tests.as_service();
  update public.organizations set ai_credits_limit = 2000 where id = v_org;
  perform tests.login_as(v_owner);
  perform tests.assert(public.has_credits(v_org, 1), 'upgrading the plan reopens the gate');

  raise notice 'all credit and accounting tests passed';
end $$;

rollback;
