-- =============================================================================
-- Code versioning.
--
-- The invariant this protects: a user never loses working code to an AI
-- mistake. Versions are immutable, numbered without gaps or collisions, and
-- restore is additive.
-- =============================================================================
begin;

do $$
declare
  v_owner uuid; v_org uuid; v_project uuid; v_other_owner uuid; v_other_project uuid;
  v_v1 uuid; v_v2 uuid; v_restored uuid;
  v_number int; v_count int; v_denied boolean;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('code@basalt.studio', '{"full_name":"Code"}'::jsonb) returning id into v_owner;
  select id into v_org from public.organizations where created_by = v_owner;

  insert into public.projects (organization_id, name, slug, created_by)
    values (v_org, 'Northwind', 'northwind', v_owner) returning id into v_project;

  perform tests.login_as(v_owner);

  -- ---- Version numbering --------------------------------------------------
  select public.create_code_version(v_project, 'First generation', 'Initial build') into v_v1;
  perform tests.assert(v_v1 is not null, 'a version is created for a project with no generated project yet');

  perform tests.assert(
    (select count(*) from public.generated_projects where project_id = v_project) = 1,
    'the generated project is created once, on demand');

  select version_number into v_number from public.code_versions where id = v_v1;
  perform tests.assert(v_number = 1, 'the first version is numbered 1');

  select public.create_code_version(v_project, 'Second generation') into v_v2;
  select version_number into v_number from public.code_versions where id = v_v2;
  perform tests.assert(v_number = 2, 'the next version increments');

  perform tests.assert(
    (select parent_version_id from public.code_versions where id = v_v2) = v_v1,
    'versions form a chain through parent_version_id');

  -- ---- Files and counts ---------------------------------------------------
  -- Files are written by the generation worker, never by a browser session.
  perform tests.as_service();
  insert into public.generated_files (code_version_id, path, content_hash, content, bytes, language, change_kind)
  values
    (v_v1, 'app/page.tsx', 'hash-a', 'export default function Page() {}', 33, 'typescript', 'added'),
    (v_v1, 'app/globals.css', 'hash-b', ':root {}', 8, 'css', 'added'),
    (v_v1, 'components/Hero.tsx', 'hash-c', 'export function Hero() {}', 25, 'typescript', 'added');

  perform public.finalise_code_version(v_v1);

  perform tests.assert(
    (select file_count from public.code_versions where id = v_v1) = 3,
    'file_count is derived from the files actually written');
  perform tests.assert(
    (select added_count from public.code_versions where id = v_v1) = 3,
    'added_count counts new files');

  -- A version is a full snapshot: unchanged files are carried forward.
  insert into public.generated_files (code_version_id, path, content_hash, content, bytes, language, change_kind)
  values
    (v_v2, 'app/page.tsx', 'hash-a2', 'export default function Page() { return null }', 45, 'typescript', 'modified'),
    (v_v2, 'components/Hero.tsx', 'hash-c', 'export function Hero() {}', 25, 'typescript', 'unchanged'),
    (v_v2, 'app/globals.css', '', null, 0, 'css', 'deleted');

  perform public.finalise_code_version(v_v2);

  perform tests.assert(
    (select file_count from public.code_versions where id = v_v2) = 2,
    'deleted files are excluded from file_count');
  perform tests.assert(
    (select modified_count from public.code_versions where id = v_v2) = 1,
    'modified_count counts changed files');
  perform tests.assert(
    (select deleted_count from public.code_versions where id = v_v2) = 1,
    'deleted_count counts removals');

  -- A path appears at most once per version.
  begin
    insert into public.generated_files (code_version_id, path, content_hash)
      values (v_v2, 'app/page.tsx', 'dupe');
    v_denied := false;
  exception when unique_violation then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a path is unique within a version');

  -- ---- Restore is additive ------------------------------------------------
  perform tests.login_as(v_owner);
  select public.restore_code_version(v_v1) into v_restored;

  perform tests.assert(
    (select version_number from public.code_versions where id = v_restored) = 3,
    'restoring creates a new version rather than rewinding');

  perform tests.assert(
    (select count(*) from public.code_versions
      where generated_project_id = (select generated_project_id from public.code_versions where id = v_v1)) = 3,
    'the earlier versions still exist after a restore');

  select count(*) into v_count from public.generated_files where code_version_id = v_restored;
  perform tests.assert(v_count = 3, 'the restored version carries the original file set');

  perform tests.assert(
    (select content from public.generated_files where code_version_id = v_restored and path = 'app/globals.css')
      = ':root {}',
    'a file deleted in v2 comes back when v1 is restored');

  -- ---- Authorization ------------------------------------------------------
  perform tests.login_as(v_owner);
  begin
    insert into public.generated_files (code_version_id, path, content_hash)
      values (v_v1, 'app/injected.tsx', 'x');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a client cannot write generated files directly');

  perform tests.as_service();
  insert into auth.users (email, raw_user_meta_data)
    values ('rival@other.co', '{"full_name":"Rival"}'::jsonb) returning id into v_other_owner;

  perform tests.login_as(v_other_owner);

  begin
    perform public.create_code_version(v_project, 'Injected');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot create a version in another org''s project');

  begin
    perform public.restore_code_version(v_v1);
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform tests.assert(v_denied, 'a stranger cannot restore another org''s version');

  select count(*) into v_count from public.code_versions;
  perform tests.assert(v_count = 0, 'a stranger cannot even see the versions');

  -- ---- Tool ledger is project-scoped --------------------------------------
  perform tests.as_service();
  insert into public.ai_tool_calls (project_id, tool_name, mode, arguments, status)
    values (v_project, 'read_file', 'read', '{"path":"app/page.tsx"}'::jsonb, 'completed');

  perform tests.login_as(v_other_owner);
  select count(*) into v_count from public.ai_tool_calls;
  perform tests.assert(v_count = 0, 'tool calls are not visible across organizations');

  perform tests.login_as(v_owner);
  select count(*) into v_count from public.ai_tool_calls;
  perform tests.assert(v_count = 1, 'a project member can audit their own tool calls');

  raise notice 'all code versioning tests passed';
end $$;

rollback;
