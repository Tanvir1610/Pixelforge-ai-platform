-- =============================================================================
-- 0008 · Analysis provenance and model-run accounting  (Phase 3)
--
-- The heuristic detector and the model both assign semantic roles. Which one
-- decided is a fact the product needs: the review UI shows it, and the training
-- pipeline needs to know which labels came from a model versus a human.
-- =============================================================================

create type public.analysis_source as enum ('heuristic', 'model', 'manual');

alter table public.design_nodes
  add column role_source public.analysis_source not null default 'heuristic',
  -- Free-text justification, shown in the review UI. Never a chain of thought:
  -- a one-line reason the user can check against their own file.
  add column role_reason text;

alter table public.design_components
  add column source public.analysis_source not null default 'heuristic',
  add column description text;

create index on public.design_nodes (project_id, role_source);

-- ---------------------------------------------------------------------------
-- Model run accounting.
--
-- Records the call and meters the credits in one transaction, so a run can
-- never be billed without being logged or logged without being billed.
-- Service role only: an inference call is never initiated by a client.
-- ---------------------------------------------------------------------------
create or replace function public.record_model_run(
  p_organization_id uuid,
  p_model_key text,
  p_purpose text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost_usd numeric,
  p_latency_ms int,
  p_status public.run_status default 'completed',
  p_project_id uuid default null,
  p_generation_run_id uuid default null,
  p_provider_key text default null,
  p_credits numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
  provider_id uuid;
begin
  select id into provider_id from public.model_providers where key = p_provider_key;

  insert into public.model_runs (
    organization_id, project_id, generation_run_id, model_provider_id,
    model_key, purpose, input_tokens, output_tokens, cost_usd, latency_ms, status
  )
  values (
    p_organization_id, p_project_id, p_generation_run_id, provider_id,
    p_model_key, p_purpose, p_input_tokens, p_output_tokens, p_cost_usd, p_latency_ms, p_status
  )
  returning id into run_id;

  -- Failed calls are logged but not charged.
  if p_status = 'completed' and p_credits > 0 then
    perform public.record_usage(p_organization_id, 'ai_credits', p_credits, p_project_id,
      jsonb_build_object('model_run_id', run_id, 'purpose', p_purpose));
  end if;

  return run_id;
end;
$$;

revoke execute on function public.record_model_run(
  uuid, text, text, int, int, numeric, int, public.run_status, uuid, uuid, text, numeric
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Credit gate. Checked before an expensive call rather than after, so a user
-- over their limit gets a clear message instead of a partial run.
-- ---------------------------------------------------------------------------
create or replace function public.has_credits(p_organization_id uuid, p_needed numeric default 1)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select o.ai_credits_limit - coalesce(sum(u.quantity), 0) >= p_needed
      from public.organizations o
      left join public.usage_records u
        on u.organization_id = o.id
       and u.metric = 'ai_credits'
       and u.occurred_at >= date_trunc('month', now())
      where o.id = p_organization_id
      group by o.ai_credits_limit
    ),
    false
  );
$$;
grant execute on function public.has_credits(uuid, numeric) to authenticated;
