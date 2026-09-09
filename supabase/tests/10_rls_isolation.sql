-- =============================================================================
-- RLS isolation tests.
--
-- These assert the security boundary that the whole multi-tenancy model rests
-- on: a member of org A must not be able to see, create or modify anything in
-- org B, no matter what the application layer does. Any failure raises and
-- aborts the run.
-- =============================================================================
begin;

-- Helpers live in 01_test_helpers.sql so they survive this rollback.

do $$
declare
  alice uuid; bob uuid;
  alice_org uuid; bob_org uuid;
  alice_project uuid; bob_project uuid;
  visible int;
  denied boolean;
begin
  -- The sign-up trigger gives each user a profile, an org and an owner role.
  insert into auth.users (email, raw_user_meta_data)
    values ('alice@basalt.studio', '{"full_name":"Alice"}'::jsonb) returning id into alice;
  insert into auth.users (email, raw_user_meta_data)
    values ('bob@rival.co', '{"full_name":"Bob"}'::jsonb) returning id into bob;

  select id into alice_org from public.organizations where created_by = alice;
  select id into bob_org   from public.organizations where created_by = bob;

  perform tests.assert(alice_org is not null, 'sign-up creates a personal organization');
  perform tests.assert(
    (select count(*) from public.organization_members
      where organization_id = alice_org and user_id = alice and role = 'owner') = 1,
    'sign-up creates an owner membership');

  insert into public.projects (organization_id, name, slug, created_by)
    values (alice_org, 'Northwind marketing', 'northwind', alice) returning id into alice_project;
  insert into public.projects (organization_id, name, slug, created_by)
    values (bob_org, 'Rival site', 'rival', bob) returning id into bob_project;

  perform tests.assert(
    (select count(*) from public.project_members
      where project_id = alice_project and user_id = alice and role = 'admin') = 1,
    'project creator is added as a project admin');

  -- ---- Alice's view -------------------------------------------------------
  perform tests.login_as(alice);

  select count(*) into visible from public.projects;
  perform tests.assert(visible = 1, 'alice sees only her own project');

  select count(*) into visible from public.projects where id = bob_project;
  perform tests.assert(visible = 0, 'alice cannot read a project in another org');

  select count(*) into visible from public.organizations;
  perform tests.assert(visible = 1, 'alice sees only her own organization');

  perform tests.assert(public.can_read_project(alice_project), 'can_read_project true for own project');
  perform tests.assert(not public.can_read_project(bob_project), 'can_read_project false for foreign project');
  perform tests.assert(not public.can_write_project(bob_project), 'can_write_project false for foreign project');

  -- Writing into another org must be refused by the INSERT policy.
  begin
    insert into public.projects (organization_id, name, slug, created_by)
      values (bob_org, 'Injected', 'injected', alice);
    denied := false;
  exception when insufficient_privilege then
    denied := true;
  end;
  perform tests.assert(denied, 'alice cannot create a project inside another org');

  -- Updates silently affect zero rows rather than erroring, so count them.
  update public.projects set name = 'Hijacked' where id = bob_project;
  get diagnostics visible = row_count;
  perform tests.assert(visible = 0, 'alice cannot update another org''s project');

  -- Project-scoped child tables inherit the same boundary.
  perform tests.login_as(bob);
  insert into public.design_tokens (project_id, category, name, value)
    values (bob_project, 'color', 'colors.primary', '"#000000"'::jsonb);

  perform tests.login_as(alice);
  select count(*) into visible from public.design_tokens;
  perform tests.assert(visible = 0, 'alice cannot read design tokens from another org');

  select count(*) into visible from public.ai_messages;
  perform tests.assert(visible = 0, 'ai_messages are project-scoped');

  -- ---- Role escalation ----------------------------------------------------
  perform tests.login_as(bob);
  update public.organization_members set role = 'owner'
    where organization_id = alice_org and user_id = alice;
  get diagnostics visible = row_count;
  perform tests.assert(visible = 0, 'bob cannot modify memberships in another org');

  -- ---- Viewer is read-only ------------------------------------------------
  perform tests.as_service();
  insert into public.organization_members (organization_id, user_id, role)
    values (alice_org, bob, 'viewer');
  insert into public.project_members (project_id, user_id, role)
    values (alice_project, bob, 'viewer');

  perform tests.login_as(bob);
  select count(*) into visible from public.projects where id = alice_project;
  perform tests.assert(visible = 1, 'viewer can read a project they were added to');

  perform tests.assert(not public.can_write_project(alice_project), 'viewer has no write access');
  update public.projects set name = 'Viewer edit' where id = alice_project;
  get diagnostics visible = row_count;
  perform tests.assert(visible = 0, 'viewer cannot update the project');

  raise notice 'all RLS isolation tests passed';
end $$;

rollback;
