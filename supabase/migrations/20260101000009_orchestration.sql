-- =============================================================================
-- 0009 · AI orchestration: structured stage output and model accounting
--        (Phase 3)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Every pipeline stage produces structured output, not just a log line. This
-- is what makes a run resumable (stage 7 failing does not discard stages 1-6),
-- inspectable, and usable as training data later (§35).
--
-- One table rather than one per stage: the stages share a lifecycle and are
-- always queried by run, and `kind` keeps them apart.
-- ---------------------------------------------------------------------------
create type public.artifact_kind as enum (
  'design_analysis',
  'component_plan',
  'architecture_plan',
  'responsive_plan',
  'code_plan',
  'visual_report',
  'refinement_plan'
);

create table public.generation_artifacts (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete cascade,
  kind              public.artifact_kind not null,
  -- Bumped when the producing agent's output shape changes, so old artifacts
  -- can be read or discarded knowingly rather than crashing a parser.
  schema_version    int not null default 1,
  payload           jsonb not null,
  model_run_id      uuid references public.model_runs(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.generation_artifacts (project_id, kind, created_at desc);
create index on public.generation_artifacts (generation_run_id);

alter table public.generation_artifacts enable row level security;

create policy "read generation artifacts" on public.generation_artifacts
  for select using (public.can_read_project(project_id));
-- Written by the orchestrator (service role) only: an artifact is a record of
-- what a model produced, and a client must not be able to forge one.

grant select on public.generation_artifacts to authenticated;

-- ---------------------------------------------------------------------------
-- Model accounting. model_runs already exists; these columns let a run be
-- attributed to an agent and replayed, which the evaluation harness needs.
-- ---------------------------------------------------------------------------
alter table public.model_runs
  add column if not exists agent text,
  add column if not exists attempt int not null default 1,
  add column if not exists error_code text;

create index if not exists model_runs_purpose_idx
  on public.model_runs (organization_id, purpose, created_at desc);

-- ---------------------------------------------------------------------------
-- Applies an agent's corrections to detected roles.
--
-- Runs as one statement so a partially-applied review can never leave the IR
-- half-classified. `p_updates` is [[node_id, role, confidence], ...].
-- ---------------------------------------------------------------------------
create or replace function public.apply_role_corrections(
  p_project_id uuid,
  p_updates jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  if not public.can_write_project(p_project_id) then
    raise exception 'insufficient privilege for project %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  with corrections as (
    select
      (value ->> 'nodeId')::uuid as node_id,
      value ->> 'role'           as role,
      (value ->> 'confidence')::numeric as confidence,
      coalesce(value ->> 'source', 'manual') as source,
      value ->> 'reason' as reason
    from jsonb_array_elements(p_updates)
  )
  update public.design_nodes d
  set semantic_role = c.role,
      confidence = c.confidence,
      role_source = coalesce(nullif(c.source, ''), 'manual')::public.analysis_source,
      role_reason = c.reason
  from corrections c
  where d.id = c.node_id
    and d.project_id = p_project_id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

grant execute on function public.apply_role_corrections(uuid, jsonb) to authenticated;
