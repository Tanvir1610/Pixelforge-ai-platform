-- =============================================================================
-- 0012 · Visual QA  (Phase 6)
-- =============================================================================

alter table public.visual_comparisons
  add column generation_run_id uuid references public.generation_runs(id) on delete set null,
  add column build_run_id_fk uuid,
  add column code_version_id uuid references public.code_versions(id) on delete set null,
  add column matched_nodes int not null default 0,
  add column unmatched_nodes int not null default 0,
  -- Fraction of pixels that differ. Null when only geometry was compared.
  add column pixel_delta numeric(6,5) check (pixel_delta between 0 and 1),
  add column dom_snapshot_path text;

alter table public.visual_difference_regions
  -- Which signal found this. Geometry differences are fixable with a number;
  -- pixel-only ones tell the agent where to look, not what to change.
  add column source text not null default 'dom' check (source in ('dom', 'pixel', 'both')),
  add column magnitude numeric(10,3) not null default 0,
  add column breakpoint int;

create index on public.visual_difference_regions (visual_comparison_id, severity, magnitude desc);
create index on public.visual_comparisons (project_id, breakpoint, created_at desc);

-- ---------------------------------------------------------------------------
-- Records a comparison and its regions together, then refreshes the project's
-- headline score. Split across statements the project could show a score that
-- no stored comparison supports.
-- ---------------------------------------------------------------------------
create or replace function public.record_visual_comparison(
  p_project_id uuid,
  p_breakpoint int,
  p_similarity numeric,
  p_metrics jsonb,
  p_regions jsonb default '[]'::jsonb,
  p_code_version_id uuid default null,
  p_generation_run_id uuid default null,
  p_iteration int default 1,
  p_matched_nodes int default 0,
  p_unmatched_nodes int default 0,
  p_pixel_delta numeric default null,
  p_figma_frame_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comparison uuid;
begin
  insert into public.visual_comparisons (
    project_id, figma_frame_id, code_version_id, generation_run_id,
    iteration, breakpoint, similarity_score,
    spacing_score, typography_score, color_score, layout_score, component_score,
    matched_nodes, unmatched_nodes, pixel_delta
  )
  values (
    p_project_id, p_figma_frame_id, p_code_version_id, p_generation_run_id,
    p_iteration, p_breakpoint, p_similarity,
    (p_metrics ->> 'spacing')::numeric,
    (p_metrics ->> 'typography')::numeric,
    (p_metrics ->> 'color')::numeric,
    (p_metrics ->> 'layout')::numeric,
    (p_metrics ->> 'components')::numeric,
    p_matched_nodes, p_unmatched_nodes, p_pixel_delta
  )
  returning id into v_comparison;

  insert into public.visual_difference_regions (
    visual_comparison_id, category, severity, label, detail,
    expected_value, actual_value, x, y, width, height,
    source, magnitude, breakpoint
  )
  select
    v_comparison,
    coalesce(r ->> 'category', 'layout'),
    coalesce(r ->> 'severity', 'medium'),
    coalesce(r ->> 'label', 'Difference'),
    r ->> 'detail',
    r ->> 'expected',
    r ->> 'actual',
    (r -> 'rect' ->> 'x')::numeric,
    (r -> 'rect' ->> 'y')::numeric,
    (r -> 'rect' ->> 'width')::numeric,
    (r -> 'rect' ->> 'height')::numeric,
    coalesce(r ->> 'source', 'dom'),
    coalesce((r ->> 'magnitude')::numeric, 0),
    p_breakpoint
  from jsonb_array_elements(p_regions) r;

  -- The project's headline score is the widest breakpoint's latest result:
  -- that is the design the user drew, and averaging breakpoints would hide a
  -- broken mobile layout behind a good desktop one.
  update public.projects p
  set match_score = (
    select vc.similarity_score
    from public.visual_comparisons vc
    where vc.project_id = p_project_id
    order by vc.breakpoint desc, vc.created_at desc
    limit 1
  )
  where p.id = p_project_id;

  return v_comparison;
end;
$$;

revoke execute on function public.record_visual_comparison(
  uuid, int, numeric, jsonb, jsonb, uuid, uuid, int, int, int, numeric, uuid
) from public, anon, authenticated;

-- Marks the regions a fix pass addressed, so the next comparison can tell a
-- new difference from one that was already attempted and did not improve.
create or replace function public.mark_regions_fixed(p_region_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.visual_difference_regions r
  set fixed_at = now()
  from public.visual_comparisons vc
  where r.visual_comparison_id = vc.id
    and r.id = any(p_region_ids)
    and public.can_write_project(vc.project_id);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
grant execute on function public.mark_regions_fixed(uuid[]) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.visual_comparisons;
exception when undefined_object then null;
end $$;
