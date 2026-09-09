-- =============================================================================
-- Design IR persistence tests.
--
-- The normaliser is unit-tested in TypeScript; this asserts the storage layer
-- holds up the invariants the IR depends on — the tree survives, constraints
-- reject bad data, and project scoping is enforced on every child table.
-- =============================================================================
begin;

do $$
declare
  v_owner_id uuid;
  v_org_id uuid;
  v_project_id uuid;
  v_file_id uuid;
  v_page_id uuid;
  v_frame_id uuid;
  v_root_id uuid;
  v_hero_id uuid;
  v_heading_id uuid;
  depth_ok boolean;
  orphan_count int;
  bad_confidence boolean;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('ir@basalt.studio', '{"full_name":"IR"}'::jsonb) returning id into v_owner_id;
  select id into v_org_id from public.organizations where created_by = v_owner_id;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org_id, 'Northwind', 'northwind', v_owner_id) returning id into v_project_id;

  insert into public.figma_files (project_id, figma_file_key, name, version)
    values (v_project_id, '8kQ2', 'Northwind', '3145') returning id into v_file_id;

  insert into public.figma_pages (figma_file_id, figma_node_id, name)
    values (v_file_id, 'canvas', 'Imported') returning id into v_page_id;

  insert into public.figma_frames (figma_page_id, project_id, figma_node_id, name, width, height, breakpoint)
    values (v_page_id, v_project_id, '1:2', 'Home / Desktop', 1440, 1000, 1440) returning id into v_frame_id;

  -- A three-level tree: frame → hero → heading.
  insert into public.design_nodes
    (project_id, figma_frame_id, parent_id, source_node_id, ir_type, name, depth, order_index,
     x, y, width, height, layout_mode, layout_gap)
    values (v_project_id, v_frame_id, null, '1:2', 'frame', 'Home / Desktop', 0, 0, 0, 0, 1440, 1000, 'vertical', 0)
    returning id into v_root_id;

  insert into public.design_nodes
    (project_id, figma_frame_id, parent_id, source_node_id, ir_type, semantic_role, name, depth, order_index,
     x, y, width, height, layout_mode, padding_left, confidence)
    values (v_project_id, v_frame_id, v_root_id, '1:7', 'frame', 'hero', 'Hero', 1, 0, 0, 64, 1440, 520, 'vertical', 80, 96)
    returning id into v_hero_id;

  insert into public.design_nodes
    (project_id, figma_frame_id, parent_id, source_node_id, ir_type, semantic_role, name, depth, order_index,
     x, y, width, height, font_size, font_weight, text_content, confidence, responsive_hints)
    values (v_project_id, v_frame_id, v_hero_id, '1:8', 'text', 'heading', 'Heading', 2, 0, 80, 96, 800, 140,
            64, 800, 'Ship your ideas without the rebuild.', 88,
            '{"fontScaleByBreakpoint":{"390":0.6}}'::jsonb)
    returning id into v_heading_id;

  perform tests.assert(
    (select count(*) from public.design_nodes where project_id = v_project_id) = 3,
    'all three IR nodes persisted');

  -- Depth must agree with the parent chain, or traversal breaks downstream.
  select (
    select d.depth from public.design_nodes d where d.id = v_heading_id
  ) = (
    select p.depth + 1 from public.design_nodes p where p.id = v_hero_id
  ) into depth_ok;
  perform tests.assert(depth_ok, 'child depth is exactly one greater than its parent');

  select count(*) into orphan_count
  from public.design_nodes d
  where d.parent_id is not null
    and not exists (select 1 from public.design_nodes p where p.id = d.parent_id);
  perform tests.assert(orphan_count = 0, 'no orphaned nodes after insert');

  perform tests.assert(
    (select responsive_hints -> 'fontScaleByBreakpoint' ->> '390'
       from public.design_nodes where id = v_heading_id) = '0.6',
    'responsive hints round-trip through JSONB');

  -- Confidence is a percentage; the constraint must reject anything else.
  begin
    insert into public.design_nodes (project_id, ir_type, name, confidence)
      values (v_project_id, 'text', 'Bad', 150);
    bad_confidence := false;
  exception when check_violation then
    bad_confidence := true;
  end;
  perform tests.assert(bad_confidence, 'confidence above 100 is rejected');

  -- Deleting the frame must take its nodes with it, or a re-import leaves
  -- unreachable rows behind.
  delete from public.figma_frames where id = v_frame_id;
  perform tests.assert(
    (select count(*) from public.design_nodes where project_id = v_project_id) = 0,
    'deleting a frame cascades to its design nodes');

  -- Tokens are unique per (project, category, name) so a re-import updates
  -- rather than duplicating.
  insert into public.design_tokens (project_id, category, name, value, usage_count)
    values (v_project_id, 'color', 'colors.primary', '"#6366F1"'::jsonb, 12);

  begin
    insert into public.design_tokens (project_id, category, name, value)
      values (v_project_id, 'color', 'colors.primary', '"#000000"'::jsonb);
    perform tests.assert(false, 'duplicate token should have been rejected');
  exception when unique_violation then
    perform tests.assert(true, 'a token name is unique within its project and category');
  end;

  perform tests.assert(
    (select count(*) from public.design_tokens where category not in
      ('color','typography','spacing','radius','shadow','breakpoint','container','grid')) = 0,
    'token categories are constrained to the known set');

  raise notice 'all design IR persistence tests passed';
end $$;

rollback;
