-- =============================================================================
-- Custom domains, rollback and OAuth state.
--
-- The OAuth state token is the control that stops an attacker attaching their
-- own host account to someone else's organization, so it is tested as
-- carefully as the tenancy boundary itself.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid; v_stranger uuid; v_other_org uuid;
  v_version uuid; v_build uuid; v_live uuid; v_failed uuid; v_rollback uuid;
  v_domain uuid; v_second uuid;
  v_count int; v_denied boolean;
  v_ctx record;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('dom@basalt.studio', '{"full_name":"Dom"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by, host_provider)
    values (v_org, 'Northwind', 'northwind', v_owner, 'vercel') returning id into v_project;

  -- ---- Domains -------------------------------------------------------------
  perform tests.login_as(v_owner);
  insert into public.project_domains (project_id, domain, provider, is_primary)
    values (v_project, 'northwind.com', 'vercel', true) returning id into v_domain;

  perform tests.assert(
    (select status from public.project_domains where id = v_domain) = 'pending',
    'a new domain starts pending');

  -- Only one primary per project, enforced by a partial unique index.
  begin
    insert into public.project_domains (project_id, domain, provider, is_primary)
      values (v_project, 'www.northwind.com', 'vercel', true);
    v_denied := false;
  exception when unique_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a project cannot have two primary domains');

  insert into public.project_domains (project_id, domain, provider)
    values (v_project, 'www.northwind.com', 'vercel') returning id into v_second;
  perform tests.assert(v_second is not null, 'a project can have several non-primary domains');

  -- Garbage in the domain column would be sent straight to a host API.
  begin
    insert into public.project_domains (project_id, domain, provider)
      values (v_project, 'not a domain', 'vercel');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a malformed domain is rejected');

  begin
    insert into public.project_domains (project_id, domain, provider)
      values (v_project, 'northwind.com', 'vercel');
    v_denied := false;
  exception when unique_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'the same domain cannot be added twice to one project');

  -- Verification details come from the host, never from a client.
  perform tests.as_service();
  perform public.set_domain_verification(
    v_domain, 'pending', 'TXT', '_vercel.northwind.com', 'vc-domain-verify=abc123');

  perform tests.assert(
    (select verification_value from public.project_domains where id = v_domain) = 'vc-domain-verify=abc123',
    'the verification record is stored verbatim for the user to copy');

  perform public.set_domain_verification(v_domain, 'verified');
  perform tests.assert(
    (select verified_at is not null from public.project_domains where id = v_domain),
    'verification is timestamped');
  perform tests.assert(
    (select verification_value from public.project_domains where id = v_domain) = 'vc-domain-verify=abc123',
    'verifying does not erase the record that was used');

  perform tests.login_as(v_owner);
  begin
    perform public.set_domain_verification(v_second, 'verified');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot mark its own domain verified');

  -- ---- Rollback ------------------------------------------------------------
  select public.create_code_version(v_project, 'v1') into v_version;
  select public.start_build_run(v_project, v_version) into v_build;
  perform tests.as_service();
  perform public.finish_build_run(v_build, 'completed', null, '{}'::jsonb, '[]'::jsonb, false, 1);

  perform tests.login_as(v_owner);
  select public.start_deployment(v_project, v_version, 'vercel') into v_live;
  perform tests.as_service();
  perform public.finish_deployment(v_live, 'completed', 'https://northwind.com');

  perform tests.login_as(v_owner);
  select public.rollback_deployment(v_live) into v_rollback;

  perform tests.assert(v_rollback is not null, 'a live deployment can be rolled back to');
  perform tests.assert(
    (select rolled_back_from from public.deployment_records where id = v_rollback) = v_live,
    'the rollback records what it came from');
  perform tests.assert(
    (select code_version_id from public.deployment_records where id = v_rollback) = v_version,
    'the rollback publishes the same version the original did');
  perform tests.assert(
    (select status from public.deployment_records where id = v_live) = 'completed',
    'rollback is additive: the original deployment is untouched');

  -- Rolling back to something that never went live would publish output nobody
  -- has seen working.
  select public.start_deployment(v_project, v_version, 'vercel') into v_failed;
  perform tests.as_service();
  perform public.finish_deployment(v_failed, 'failed', null, 'upstream', 'host error');

  perform tests.login_as(v_owner);
  begin
    perform public.rollback_deployment(v_failed);
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'cannot roll back to a deployment that never went live');

  -- ---- OAuth state ---------------------------------------------------------
  perform tests.as_service();
  insert into public.oauth_states (state, organization_id, user_id, provider)
    values ('state-token-aaa', v_org, v_owner, 'vercel');

  select * into v_ctx from public.consume_oauth_state('state-token-aaa');
  perform tests.assert(v_ctx.organization_id = v_org, 'a valid state returns its organization');

  -- Replay must find nothing, or a captured callback can be reused.
  select count(*) into v_count from public.consume_oauth_state('state-token-aaa');
  perform tests.assert(v_count = 0, 'a state token can only be consumed once');

  select count(*) into v_count from public.consume_oauth_state('never-issued');
  perform tests.assert(v_count = 0, 'an unknown state is rejected');

  insert into public.oauth_states (state, organization_id, user_id, provider, expires_at)
    values ('state-expired', v_org, v_owner, 'vercel', now() - interval '1 minute');
  select count(*) into v_count from public.consume_oauth_state('state-expired');
  perform tests.assert(v_count = 0, 'an expired state is rejected');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.oauth_states;
  perform tests.assert(v_count = 0, 'oauth states are invisible to any session');

  begin
    perform public.consume_oauth_state('state-token-aaa');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot consume a state token');

  -- ---- Cross-tenant --------------------------------------------------------
  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('rival@other.co', '{}'::jsonb) returning id into v_stranger;
  select id into v_other_org from public.organizations where created_by = v_stranger;

  perform tests.login_as(v_stranger);
  select count(*) into v_count from public.project_domains;
  perform tests.assert(v_count = 0, 'domains are not visible across organizations');

  begin
    insert into public.project_domains (project_id, domain, provider)
      values (v_project, 'stolen.com', 'vercel');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot attach a domain to another org''s project');

  begin
    perform public.rollback_deployment(v_live);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot roll back another org''s deployment');

  raise notice 'all domain and connect tests passed';
end $$;

rollback;
