-- =============================================================================
-- Deployment.
--
-- The rule this protects: never publish output that did not build. It lives in
-- the database so it holds even when a caller forgets to check.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid; v_stranger uuid;
  v_good uuid; v_bad uuid; v_unbuilt uuid;
  v_build uuid; v_deployment uuid;
  v_count int; v_denied boolean; v_status text; v_url text;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('deploy@basalt.studio', '{"full_name":"Dep"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by, host_provider)
    values (v_org, 'Northwind', 'northwind', v_owner, 'vercel') returning id into v_project;

  perform tests.login_as(v_owner);
  select public.create_code_version(v_project, 'Good build') into v_good;
  select public.create_code_version(v_project, 'Broken build') into v_bad;
  select public.create_code_version(v_project, 'Never built') into v_unbuilt;

  perform tests.as_service();
  insert into public.generated_files (code_version_id, path, content_hash, content, bytes, change_kind)
  values
    (v_good, 'index.html', 'h1', '<h1>hi</h1>', 11, 'added'),
    (v_good, 'app.css', 'h2', 'body{}', 6, 'added'),
    (v_good, 'old.css', 'h3', null, 0, 'deleted');

  -- ---- The gate -----------------------------------------------------------
  perform tests.login_as(v_owner);

  -- A version that was never built cannot be deployed.
  begin
    perform public.start_deployment(v_project, v_unbuilt, 'vercel');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a version that was never built cannot be deployed');

  -- A version whose build failed cannot be deployed either.
  select public.start_build_run(v_project, v_bad) into v_build;
  perform tests.as_service();
  perform public.finish_build_run(v_build, 'failed', 'typecheck', '{}'::jsonb, '[]'::jsonb, false, 1);

  perform tests.login_as(v_owner);
  begin
    perform public.start_deployment(v_project, v_bad, 'vercel');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a version whose build failed cannot be deployed');

  -- A passing build can.
  select public.start_build_run(v_project, v_good) into v_build;
  perform tests.as_service();
  perform public.finish_build_run(v_build, 'completed', null, '{"build": 9000}'::jsonb, '[]'::jsonb, false, 1);

  perform tests.login_as(v_owner);
  select public.start_deployment(v_project, v_good, 'vercel', 'production') into v_deployment;
  perform tests.assert(v_deployment is not null, 'a version with a passing build deploys');

  perform tests.assert(
    (select phase from public.deployment_records where id = v_deployment) = 'queued',
    'a new deployment starts queued');

  -- Deleted files are excluded from the count, matching what gets uploaded.
  perform tests.assert(
    (select file_count from public.deployment_records where id = v_deployment) = 2,
    'the deployment records how many files it will publish, excluding deletions');

  perform tests.assert(
    (select build_run_id from public.deployment_records where id = v_deployment) = v_build,
    'the deployment is linked to the build that justified it');

  -- "none" is a valid project setting but not a deployable target.
  begin
    perform public.start_deployment(v_project, v_good, 'none');
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'deploying to "none" is refused');

  -- ---- Progress and completion --------------------------------------------
  perform tests.as_service();
  perform public.update_deployment_phase(v_deployment, 'uploading');
  perform public.update_deployment_phase(v_deployment, 'building', 'dpl_abc', 'https://preview.vercel.app');

  perform tests.assert(
    (select provider_deployment_id from public.deployment_records where id = v_deployment) = 'dpl_abc',
    'the host deployment id is recorded, so a poll can resume after a restart');

  -- A later update without a URL must not erase the one already known.
  perform public.update_deployment_phase(v_deployment, 'deploying');
  select url into v_url from public.deployment_records where id = v_deployment;
  perform tests.assert(v_url = 'https://preview.vercel.app', 'a phase update does not clear a known URL');

  perform public.finish_deployment(v_deployment, 'completed', 'https://northwind.com');

  perform tests.assert(
    (select phase from public.deployment_records where id = v_deployment) = 'live',
    'a completed deployment is live');
  perform tests.assert(
    (select url from public.deployment_records where id = v_deployment) = 'https://northwind.com',
    'the production URL replaces the preview one');

  -- A project is live only once something is actually serving.
  perform tests.assert(
    (select status from public.projects where id = v_project) = 'live',
    'the project becomes live when a deployment completes');

  perform tests.assert(
    (select coalesce(sum(quantity), 0) from public.usage_records
      where organization_id = v_org and metric = 'deployments') = 1,
    'a completed deployment is metered');

  -- ---- Failure path --------------------------------------------------------
  perform tests.login_as(v_owner);
  select public.start_deployment(v_project, v_good, 'vercel') into v_deployment;
  perform tests.as_service();
  perform public.finish_deployment(v_deployment, 'failed', null, 'quota_exceeded', 'Account hit its limit');

  perform tests.assert(
    (select phase from public.deployment_records where id = v_deployment) = 'failed',
    'a failed deployment is marked failed');
  perform tests.assert(
    (select coalesce(sum(quantity), 0) from public.usage_records
      where organization_id = v_org and metric = 'deployments') = 1,
    'a failed deployment is not metered');

  -- ---- Credentials are unreachable from a session --------------------------
  perform tests.as_service();
  insert into public.deployment_credentials (organization_id, provider, access_token, account_label)
    values (v_org, 'vercel', 'secret-deploy-token', 'basalt-studio');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.deployment_credentials;
  perform tests.assert(v_count = 0, 'even the owner cannot read a deploy token');

  perform tests.assert(
    (select count(*) from public.my_deployment_connections()) = 1,
    'the owner can see that a host is connected');
  perform tests.assert(
    (select account_label from public.my_deployment_connections() limit 1) = 'basalt-studio',
    'the connection projection exposes the label, never the token');

  -- ---- Authorization -------------------------------------------------------
  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('rival@other.co', '{}'::jsonb) returning id into v_stranger;

  perform tests.login_as(v_stranger);
  begin
    perform public.start_deployment(v_project, v_good, 'vercel');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot deploy another org''s project');

  select count(*) into v_count from public.deployment_records;
  perform tests.assert(v_count = 0, 'deployments are not visible across organizations');

  perform tests.assert(
    (select count(*) from public.my_deployment_connections()) = 0,
    'a stranger sees no host connections');

  begin
    perform public.finish_deployment(v_deployment, 'completed', 'https://hijacked.test');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot mark a deployment live');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.deployment_records;
  perform tests.assert(v_count = 2, 'the owner sees their own deployments');

  raise notice 'all deployment tests passed';
end $$;

rollback;
