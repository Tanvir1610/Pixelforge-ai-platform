-- =============================================================================
-- 0010 · Code versioning and the tool ledger  (Phase 4)
--
-- Every AI generation produces a version. Versions form a chain, are never
-- mutated after creation, and restoring is additive — a user must never lose
-- working code to an AI mistake (§27).
-- =============================================================================

create type public.change_kind as enum ('added', 'modified', 'deleted', 'unchanged');

alter table public.code_versions
  add column summary text,
  -- Denormalised counts so a version list does not need to aggregate files.
  add column file_count int not null default 0,
  add column added_count int not null default 0,
  add column modified_count int not null default 0,
  add column deleted_count int not null default 0,
  add column generation_run_id uuid references public.generation_runs(id) on delete set null;

alter table public.generated_files
  add column change_kind public.change_kind not null default 'added';

create index on public.generated_files (code_version_id, change_kind);
create index on public.code_versions (generated_project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Version creation.
--
-- version_number is assigned inside the function under a row lock on the
-- parent project, so two concurrent generations cannot claim the same number.
-- Doing this in application code would be a race.
-- ---------------------------------------------------------------------------
create or replace function public.create_code_version(
  p_project_id uuid,
  p_label text default null,
  p_summary text default null,
  p_generation_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_generated_project uuid;
  v_parent uuid;
  v_next int;
  v_version uuid;
begin
  if not public.can_write_project(p_project_id) then
    raise exception 'insufficient privilege for project %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  -- One generated project per project; created on first generation.
  select id into v_generated_project
  from public.generated_projects
  where project_id = p_project_id
  limit 1;

  if v_generated_project is null then
    insert into public.generated_projects (project_id, framework, styling)
    select p.id, p.framework, p.styling from public.projects p where p.id = p_project_id
    returning id into v_generated_project;
  end if;

  -- Serialises concurrent version creation for this project.
  perform 1 from public.generated_projects where id = v_generated_project for update;

  select id, version_number into v_parent, v_next
  from public.code_versions
  where generated_project_id = v_generated_project
  order by version_number desc
  limit 1;

  insert into public.code_versions (
    generated_project_id, version_number, label, summary,
    parent_version_id, generation_run_id, created_by
  )
  values (
    v_generated_project, coalesce(v_next, 0) + 1, p_label, p_summary,
    v_parent, p_generation_run_id, auth.uid()
  )
  returning id into v_version;

  return v_version;
end;
$$;
grant execute on function public.create_code_version(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Finalise: recompute the denormalised counts once a version's files are in.
-- ---------------------------------------------------------------------------
create or replace function public.finalise_code_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.code_versions v
  set file_count = counts.total,
      added_count = counts.added,
      modified_count = counts.modified,
      deleted_count = counts.deleted
  from (
    select
      count(*) filter (where change_kind <> 'deleted') as total,
      count(*) filter (where change_kind = 'added') as added,
      count(*) filter (where change_kind = 'modified') as modified,
      count(*) filter (where change_kind = 'deleted') as deleted
    from public.generated_files
    where code_version_id = p_version_id
  ) counts
  where v.id = p_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Restore.
--
-- Additive: copies the target version's files forward into a NEW version
-- rather than deleting anything. History stays intact, and a restore can
-- itself be undone.
-- ---------------------------------------------------------------------------
create or replace function public.restore_code_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_number int;
  v_new uuid;
begin
  select p.id, cv.version_number into v_project, v_number
  from public.code_versions cv
  join public.generated_projects gp on gp.id = cv.generated_project_id
  join public.projects p on p.id = gp.project_id
  where cv.id = p_version_id;

  if v_project is null then
    raise exception 'version % does not exist', p_version_id;
  end if;

  -- create_code_version performs the authorization check.
  v_new := public.create_code_version(
    v_project,
    'Restore of v' || v_number,
    'Restored the file set from version ' || v_number,
    null
  );

  insert into public.generated_files
    (code_version_id, path, content_hash, storage_path, content, bytes, language, change_kind)
  select v_new, f.path, f.content_hash, f.storage_path, f.content, f.bytes, f.language, 'added'
  from public.generated_files f
  where f.code_version_id = p_version_id
    and f.change_kind <> 'deleted';

  perform public.finalise_code_version(v_new);
  return v_new;
end;
$$;
grant execute on function public.restore_code_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tool ledger. Every tool an agent invokes is recorded with its arguments and
-- outcome, so a generation can be audited after the fact (§16).
-- ---------------------------------------------------------------------------
alter table public.ai_tool_calls
  add column project_id uuid references public.projects(id) on delete cascade,
  add column mode text not null default 'read' check (mode in ('read', 'write')),
  add column error_message text;

create index on public.ai_tool_calls (project_id, created_at desc);

create policy "read project tool calls" on public.ai_tool_calls
  for select using (project_id is not null and public.can_read_project(project_id));

do $$ begin
  alter publication supabase_realtime add table public.code_versions;
exception when undefined_object then null;
end $$;
