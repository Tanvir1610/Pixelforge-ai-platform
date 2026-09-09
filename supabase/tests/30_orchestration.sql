-- =============================================================================
-- Orchestration tests: artifacts, role corrections and usage metering.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_intruder uuid;
  v_org uuid; v_other_org uuid;
  v_project uuid; v_frame uuid; v_page uuid; v_file uuid;
  v_hero uuid; v_grid uuid;
  v_updated int;
  v_total numeric;
  v_denied boolean;
  v_visible int;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('orc@basalt.studio', '{"full_name":"Orc"}'::jsonb) returning id into v_owner;
  insert into auth.users (email, raw_user_meta_data)
    values ('intruder@rival.co', '{"full_name":"In"}'::jsonb) returning id into v_intruder;

  select id into v_org from public.organizations where created_by = v_owner;
  select id into v_other_org from public.organizations where created_by = v_intruder;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org, 'Northwind', 'northwind', v_owner) returning id into v_project;
  insert into public.figma_files (project_id, figma_file_key, name)
    values (v_project, '8kQ2', 'Northwind') returning id into v_file;
  insert into public.figma_pages (figma_file_id, figma_node_id, name)
    values (v_file, 'canvas', 'Imported') returning id into v_page;
  insert into public.figma_frames (figma_page_id, project_id, figma_node_id, name, width, height)
    values (v_page, v_project, '1:2', 'Home', 1440, 1000) returning id into v_frame;

  insert into public.design_nodes
    (project_id, figma_frame_id, source_node_id, ir_type, semantic_role, name, depth, confidence)
    values (v_project, v_frame, '1:7', 'frame', 'card', 'Hero', 1, 62) returning id into v_hero;
  insert into public.design_nodes
    (project_id, figma_frame_id, source_node_id, ir_type, semantic_role, name, depth, confidence)
    values (v_project, v_frame, '1:12', 'frame', 'card', 'Grid', 1, 58) returning id into v_grid;

  -- ---- Role corrections --------------------------------------------------
  perform tests.login_as(v_owner);

  select public.apply_role_corrections(
    v_project,
    jsonb_build_array(
      jsonb_build_object('nodeId', v_hero::text, 'role', 'hero', 'confidence', 97),
      jsonb_build_object('nodeId', v_grid::text, 'role', 'feature_grid', 'confidence', 94)
    )
  ) into v_updated;

  perform tests.assert(v_updated = 2, 'both role corrections applied');
  perform tests.assert(
    (select semantic_role from public.design_nodes where id = v_hero) = 'hero',
    'the corrected role is stored');
  perform tests.assert(
    (select confidence from public.design_nodes where id = v_hero) = 97,
    'the corrected confidence is stored');

  -- A correction naming a node in another project must be ignored, not applied.
  perform tests.as_service();
  insert into public.projects (organization_id, name, slug, created_by)
    values (v_other_org, 'Rival', 'rival', v_intruder);

  perform tests.login_as(v_owner);
  select public.apply_role_corrections(
    v_project,
    jsonb_build_array(jsonb_build_object('nodeId', gen_random_uuid()::text, 'role', 'hero', 'confidence', 90))
  ) into v_updated;
  perform tests.assert(v_updated = 0, 'a correction for an unknown node changes nothing');

  -- ---- Authorisation -----------------------------------------------------
  perform tests.login_as(v_intruder);
  begin
    perform public.apply_role_corrections(
      v_project,
      jsonb_build_array(jsonb_build_object('nodeId', v_hero::text, 'role', 'footer', 'confidence', 10))
    );
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot rewrite another org''s roles');

  -- Read back as the owner: as the intruder, RLS would return no row and the
  -- assertion would pass for the wrong reason.
  perform tests.login_as(v_owner);
  perform tests.assert(
    (select semantic_role from public.design_nodes where id = v_hero) = 'hero',
    'the role survived the rejected attempt');

  -- ---- Artifacts ---------------------------------------------------------
  perform tests.as_service();
  insert into public.generation_artifacts (project_id, kind, payload)
    values (v_project, 'design_analysis', '{"summary":"A marketing page","sections":[]}'::jsonb);

  perform tests.login_as(v_owner);
  select count(*) into v_visible from public.generation_artifacts;
  perform tests.assert(v_visible = 1, 'the owner can read their analysis artifact');

  perform tests.login_as(v_intruder);
  select count(*) into v_visible from public.generation_artifacts;
  perform tests.assert(v_visible = 0, 'artifacts are not visible across organizations');

  -- Artifacts record what a model produced, so a client must not forge one.
  begin
    insert into public.generation_artifacts (project_id, kind, payload)
      values (v_project, 'design_analysis', '{"forged":true}'::jsonb);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'clients cannot write generation artifacts');

  -- ---- Usage metering ----------------------------------------------------
  perform tests.as_service();
  select public.record_usage(v_org, 'ai_credits', 3, v_project, '{"agent":"design_analyst"}'::jsonb) into v_total;
  perform tests.assert(v_total = 3, 'record_usage returns the running month total');

  select public.record_usage(v_org, 'ai_credits', 5, v_project) into v_total;
  perform tests.assert(v_total = 8, 'usage accumulates within the period');

  perform tests.login_as(v_owner);
  perform tests.assert(
    (select remaining from public.my_credit_balance(v_org)) = 42,
    'credit balance is the limit minus metered usage');

  -- Usage must not be writable by a client, or metering can be under-reported.
  begin
    insert into public.usage_records (organization_id, metric, quantity)
      values (v_org, 'ai_credits', -1000);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'clients cannot write usage records directly');

  raise notice 'all orchestration tests passed';
end $$;

rollback;
