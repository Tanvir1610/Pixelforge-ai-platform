-- =============================================================================
-- 0011 · Build runs and the repair loop  (Phase 5)
-- =============================================================================

alter table public.build_runs
  add column code_version_number int,
  add column failed_phase text check (failed_phase in ('install','typecheck','lint','build','runtime')),
  add column error_count int not null default 0,
  add column warning_count int not null default 0,
  -- Which sandbox served the run. Local process isolation is weaker than a
  -- container, so a build's trustworthiness depends on knowing what ran it.
  add column sandbox_backend text not null default 'local'
    check (sandbox_backend in ('local', 'container', 'microvm')),
  add column timed_out boolean not null default false,
  add column generation_run_id uuid references public.generation_runs(id) on delete set null;

create index on public.build_runs (project_id, status, created_at desc);

alter table public.build_errors
  -- How many repair attempts had happened when this error was seen. Lets the
  -- loop tell a new error from one it has already failed to fix.
  add column iteration int not null default 1,
  add column fix_attempted boolean not null default false;

create index on public.build_errors (build_run_id, severity);

-- ---------------------------------------------------------------------------
-- Opens a build run. Authorization lives here rather than at the call site so
-- a worker cannot start a build against a project it may not touch.
-- ---------------------------------------------------------------------------
create or replace function public.start_build_run(
  p_project_id uuid,
  p_code_version_id uuid default null,
  p_generation_run_id uuid default null,
  p_sandbox_backend text default 'local'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build uuid;
  v_number int;
begin
  if not public.can_write_project(p_project_id) then
    raise exception 'insufficient privilege for project %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  select version_number into v_number
  from public.code_versions where id = p_code_version_id;

  insert into public.build_runs (
    project_id, code_version_id, code_version_number,
    generation_run_id, sandbox_backend, status
  )
  values (
    p_project_id, p_code_version_id, v_number,
    p_generation_run_id, p_sandbox_backend, 'running'
  )
  returning id into v_build;

  return v_build;
end;
$$;
grant execute on function public.start_build_run(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Closes a build run and records its errors in one transaction, so a build is
-- never marked finished while its errors are still being written.
-- ---------------------------------------------------------------------------
create or replace function public.finish_build_run(
  p_build_run_id uuid,
  p_status public.run_status,
  p_failed_phase text default null,
  p_timings jsonb default '{}'::jsonb,
  p_errors jsonb default '[]'::jsonb,
  p_timed_out boolean default false,
  p_iteration int default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_errors int;
  v_warnings int;
begin
  insert into public.build_errors (
    build_run_id, severity, phase, file_path, line, column_number, code, message, iteration
  )
  select
    p_build_run_id,
    coalesce(e ->> 'severity', 'error'),
    coalesce(e ->> 'phase', 'build'),
    e ->> 'filePath',
    (e ->> 'line')::int,
    (e ->> 'column')::int,
    e ->> 'code',
    coalesce(e ->> 'message', 'Unknown error'),
    p_iteration
  from jsonb_array_elements(p_errors) e;

  select
    count(*) filter (where severity = 'error'),
    count(*) filter (where severity = 'warning')
  into v_errors, v_warnings
  from public.build_errors where build_run_id = p_build_run_id;

  update public.build_runs
  set status = p_status,
      failed_phase = p_failed_phase,
      timed_out = p_timed_out,
      error_count = v_errors,
      warning_count = v_warnings,
      install_ms = coalesce((p_timings ->> 'install')::int, install_ms),
      typecheck_ms = coalesce((p_timings ->> 'typecheck')::int, typecheck_ms),
      lint_ms = coalesce((p_timings ->> 'lint')::int, lint_ms),
      build_ms = coalesce((p_timings ->> 'build')::int, build_ms),
      finished_at = now()
  where id = p_build_run_id;
end;
$$;

revoke execute on function public.finish_build_run(uuid, public.run_status, text, jsonb, jsonb, boolean, int)
  from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.build_errors;
exception when undefined_object then null;
end $$;
