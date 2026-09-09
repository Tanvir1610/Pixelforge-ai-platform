-- =============================================================================
-- Build runs and the repair loop.
--
-- A build must never appear finished while its errors are still being written,
-- and error counts must be derived rather than asserted by a caller.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid; v_stranger uuid;
  v_version uuid; v_build uuid; v_build2 uuid;
  v_count int; v_denied boolean; v_status text;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('build@basalt.studio', '{"full_name":"Build"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org, 'Northwind', 'northwind', v_owner) returning id into v_project;

  perform tests.login_as(v_owner);
  select public.create_code_version(v_project, 'Generation 1') into v_version;

  -- ---- Opening a run ------------------------------------------------------
  select public.start_build_run(v_project, v_version, null, 'local') into v_build;
  perform tests.assert(v_build is not null, 'a build run opens');

  perform tests.assert(
    (select status from public.build_runs where id = v_build) = 'running',
    'a new build run is running, not queued');

  perform tests.assert(
    (select code_version_number from public.build_runs where id = v_build) = 1,
    'the build records which version number it built');

  perform tests.assert(
    (select sandbox_backend from public.build_runs where id = v_build) = 'local',
    'the sandbox backend is recorded, because it determines how much to trust the run');

  -- ---- Closing writes status and errors together --------------------------
  perform tests.as_service();
  perform public.finish_build_run(
    v_build, 'failed', 'typecheck',
    '{"install": 12000, "typecheck": 3000}'::jsonb,
    '[{"severity":"error","phase":"typecheck","filePath":"app/page.tsx","line":12,"column":5,"code":"TS2339","message":"Property does not exist"},
      {"severity":"error","phase":"typecheck","filePath":"components/Hero.tsx","line":3,"code":"TS2307","message":"Cannot find module"},
      {"severity":"warning","phase":"lint","filePath":"app/page.tsx","line":1,"code":"no-unused-vars","message":"Unused"}]'::jsonb,
    false, 1
  );

  select count(*) into v_count from public.build_errors where build_run_id = v_build;
  perform tests.assert(v_count = 3, 'every error is recorded');

  perform tests.assert(
    (select error_count from public.build_runs where id = v_build) = 2,
    'error_count is derived from the rows, not taken from the caller');
  perform tests.assert(
    (select warning_count from public.build_runs where id = v_build) = 1,
    'warnings are counted separately from errors');

  perform tests.assert(
    (select failed_phase from public.build_runs where id = v_build) = 'typecheck',
    'the failing phase is recorded so the repair agent knows where to look');

  perform tests.assert(
    (select typecheck_ms from public.build_runs where id = v_build) = 3000,
    'per-phase timings are stored');

  perform tests.assert(
    (select finished_at is not null from public.build_runs where id = v_build),
    'the run is stamped finished');

  -- ---- Iteration distinguishes repair passes ------------------------------
  perform tests.login_as(v_owner);
  select public.start_build_run(v_project, v_version, null, 'local') into v_build2;

  perform tests.as_service();
  perform public.finish_build_run(
    v_build2, 'completed', null, '{"build": 8000}'::jsonb, '[]'::jsonb, false, 2
  );

  perform tests.assert(
    (select error_count from public.build_runs where id = v_build2) = 0,
    'a clean build records zero errors');
  perform tests.assert(
    (select status from public.build_runs where id = v_build2) = 'completed',
    'a clean build completes');

  -- ---- Timeouts are visible -----------------------------------------------
  perform tests.login_as(v_owner);
  select public.start_build_run(v_project, v_version) into v_build;
  perform tests.as_service();
  perform public.finish_build_run(
    v_build, 'failed', 'install', '{}'::jsonb,
    '[{"severity":"error","phase":"install","code":"TIMEOUT","message":"install exceeded 180s"}]'::jsonb,
    true, 1
  );
  perform tests.assert(
    (select timed_out from public.build_runs where id = v_build),
    'a timed-out build is flagged, not just failed');

  -- ---- Authorization ------------------------------------------------------
  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('stranger@other.co', '{}'::jsonb) returning id into v_stranger;

  perform tests.login_as(v_stranger);
  begin
    perform public.start_build_run(v_project, v_version);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot start a build on another org''s project');

  select count(*) into v_count from public.build_runs;
  perform tests.assert(v_count = 0, 'build runs are not visible across organizations');

  select count(*) into v_count from public.build_errors;
  perform tests.assert(v_count = 0, 'build errors are not visible across organizations');

  begin
    perform public.finish_build_run(v_build2, 'completed');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot close a build run directly');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.build_runs;
  perform tests.assert(v_count = 3, 'the owner sees their own builds');

  raise notice 'all build tests passed';
end $$;

rollback;
