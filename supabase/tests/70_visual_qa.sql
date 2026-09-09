-- =============================================================================
-- Visual QA.
--
-- The score a user sees drives whether they trust the product, so it must
-- always be backed by a stored comparison, and never be settable by a client.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid; v_stranger uuid;
  v_version uuid; v_desktop uuid; v_mobile uuid;
  v_count int; v_score numeric; v_denied boolean;
  v_region uuid; v_fixed int;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('visual@basalt.studio', '{"full_name":"Vis"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org, 'Northwind', 'northwind', v_owner) returning id into v_project;

  perform tests.login_as(v_owner);
  select public.create_code_version(v_project, 'Generation 1') into v_version;

  -- ---- Recording a comparison ---------------------------------------------
  perform tests.as_service();
  select public.record_visual_comparison(
    v_project, 1440, 97.4,
    '{"spacing":98,"typography":96,"color":100,"layout":97,"components":95}'::jsonb,
    '[{"category":"spacing","severity":"high","label":"Hero padding","detail":"96px vs 88px",
       "expected":"96","actual":"88","magnitude":8,"source":"dom",
       "rect":{"x":0,"y":64,"width":1440,"height":520}},
      {"category":"typography","severity":"medium","label":"Heading size","detail":"64px vs 60px",
       "expected":"64","actual":"60","magnitude":4,"source":"dom"},
      {"category":"image","severity":"medium","label":"Rendered area differs",
       "magnitude":2.1,"source":"pixel","rect":{"x":100,"y":200,"width":64,"height":64}}]'::jsonb,
    v_version, null, 1, 42, 1, 0.021
  ) into v_desktop;

  perform tests.assert(v_desktop is not null, 'a comparison is recorded');

  select count(*) into v_count from public.visual_difference_regions where visual_comparison_id = v_desktop;
  perform tests.assert(v_count = 3, 'every difference region is stored with the comparison');

  perform tests.assert(
    (select count(*) from public.visual_difference_regions
      where visual_comparison_id = v_desktop and source = 'pixel') = 1,
    'pixel-only regions are distinguishable from geometry ones');

  perform tests.assert(
    (select spacing_score from public.visual_comparisons where id = v_desktop) = 98,
    'per-category scores are stored, not just the headline');

  perform tests.assert(
    (select pixel_delta from public.visual_comparisons where id = v_desktop) = 0.021,
    'the pixel delta is recorded when a reference render existed');

  perform tests.assert(
    (select matched_nodes from public.visual_comparisons where id = v_desktop) = 42,
    'match coverage is recorded, so a high score on 3 nodes is not mistaken for a good one');

  -- ---- The headline score follows the widest breakpoint --------------------
  select match_score into v_score from public.projects where id = v_project;
  perform tests.assert(v_score = 97.4, 'the project score is refreshed from the comparison');

  -- A worse mobile result must not be averaged away behind a good desktop one.
  select public.record_visual_comparison(
    v_project, 390, 71.0,
    '{"spacing":70,"typography":80,"color":100,"layout":65,"components":90}'::jsonb,
    '[]'::jsonb, v_version, null, 1, 40, 3, null
  ) into v_mobile;

  select match_score into v_score from public.projects where id = v_project;
  perform tests.assert(v_score = 97.4, 'the widest breakpoint remains the headline score');

  perform tests.assert(
    (select count(*) from public.visual_comparisons where project_id = v_project) = 2,
    'each breakpoint is stored separately');

  -- ---- Constraints ---------------------------------------------------------
  begin
    perform public.record_visual_comparison(
      v_project, 1440, 150, '{}'::jsonb, '[]'::jsonb, v_version, null, 1, 0, 0, null);
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a similarity score above 100 is rejected');

  begin
    perform public.record_visual_comparison(
      v_project, 1440, 90, '{}'::jsonb, '[]'::jsonb, v_version, null, 1, 0, 0, 1.5);
    v_denied := false;
  exception when check_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a pixel delta outside 0..1 is rejected');

  -- ---- Marking regions fixed ----------------------------------------------
  select id into v_region from public.visual_difference_regions
    where visual_comparison_id = v_desktop and label = 'Hero padding';

  perform tests.login_as(v_owner);
  select public.mark_regions_fixed(array[v_region]) into v_fixed;
  perform tests.assert(v_fixed = 1, 'a region can be marked fixed by a project member');
  perform tests.assert(
    (select fixed_at is not null from public.visual_difference_regions where id = v_region),
    'the fix is timestamped so a later pass can tell new problems from old ones');

  -- ---- Authorization -------------------------------------------------------
  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('rival@other.co', '{}'::jsonb) returning id into v_stranger;

  perform tests.login_as(v_stranger);

  select count(*) into v_count from public.visual_comparisons;
  perform tests.assert(v_count = 0, 'comparisons are not visible across organizations');

  select count(*) into v_count from public.visual_difference_regions;
  perform tests.assert(v_count = 0, 'difference regions are not visible across organizations');

  -- A stranger naming a region id directly must still change nothing.
  select public.mark_regions_fixed(array[v_region]) into v_fixed;
  perform tests.assert(v_fixed = 0, 'a stranger cannot mark another org''s regions fixed');

  begin
    perform public.record_visual_comparison(
      v_project, 1440, 100, '{}'::jsonb, '[]'::jsonb, null, null, 1, 0, 0, null);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot record a comparison, so scores cannot be forged');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.visual_comparisons;
  perform tests.assert(v_count = 2, 'the owner sees their own comparisons');

  raise notice 'all visual QA tests passed';
end $$;

rollback;
