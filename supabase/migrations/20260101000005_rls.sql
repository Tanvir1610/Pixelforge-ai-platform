-- =============================================================================
-- 0005 · Row Level Security
--
-- RLS is enabled on every table in `public`. There is no table a signed-in user
-- can read by default. Server code uses the anon key with the user's JWT, so
-- these policies are the real authorization boundary — the Next.js layer adds
-- defence in depth, not the primary check.
--
-- The service role bypasses RLS by design and is used only by trusted workers.
-- =============================================================================

alter table public.profiles                  enable row level security;
alter table public.organizations             enable row level security;
alter table public.organization_members      enable row level security;
alter table public.projects                  enable row level security;
alter table public.project_members           enable row level security;
alter table public.notifications             enable row level security;
alter table public.audit_logs                enable row level security;
alter table public.figma_files               enable row level security;
alter table public.figma_pages               enable row level security;
alter table public.figma_frames              enable row level security;
alter table public.design_nodes              enable row level security;
alter table public.design_tokens             enable row level security;
alter table public.design_components         enable row level security;
alter table public.design_component_variants enable row level security;
alter table public.design_assets             enable row level security;
alter table public.model_providers           enable row level security;
alter table public.generated_projects        enable row level security;
alter table public.code_versions             enable row level security;
alter table public.generated_files           enable row level security;
alter table public.generation_runs           enable row level security;
alter table public.generation_steps          enable row level security;
alter table public.ai_messages               enable row level security;
alter table public.ai_tool_calls             enable row level security;
alter table public.model_runs                enable row level security;
alter table public.build_runs                enable row level security;
alter table public.build_errors              enable row level security;
alter table public.visual_comparisons        enable row level security;
alter table public.visual_difference_regions enable row level security;
alter table public.deployment_records        enable row level security;
alter table public.usage_records             enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.api_keys                  enable row level security;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "read profiles of org co-members" on public.profiles
  for select using (
    exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and mine.deleted_at is null
        and theirs.user_id = profiles.id
        and theirs.deleted_at is null
    )
  );
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "read own organizations" on public.organizations
  for select using (public.is_org_member(id) and deleted_at is null);
create policy "create organizations" on public.organizations
  for insert with check (created_by = auth.uid());
create policy "admins update organization" on public.organizations
  for update using (public.has_org_role(id, 'admin')) with check (public.has_org_role(id, 'admin'));

create policy "read org members" on public.organization_members
  for select using (public.is_org_member(organization_id));
create policy "admins manage members" on public.organization_members
  for all using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Projects. Read requires membership; write requires developer or above.
-- ---------------------------------------------------------------------------
create policy "read projects" on public.projects
  for select using (
    deleted_at is null
    and (
      public.is_org_member(organization_id)
      or exists (
        select 1 from public.project_members pm
        where pm.project_id = projects.id and pm.user_id = auth.uid() and pm.deleted_at is null
      )
    )
  );
create policy "create projects" on public.projects
  for insert with check (
    public.has_org_role(organization_id, 'developer') and created_by = auth.uid()
  );
create policy "update projects" on public.projects
  for update using (public.can_write_project(id)) with check (public.can_write_project(id));
create policy "delete projects" on public.projects
  for delete using (public.has_org_role(organization_id, 'admin'));

create policy "read project members" on public.project_members
  for select using (public.can_read_project(project_id));
create policy "manage project members" on public.project_members
  for all using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));

create policy "read own notifications" on public.notifications
  for select using (user_id = auth.uid());
create policy "update own notifications" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit logs are readable by org admins and are never client-writable.
create policy "admins read audit logs" on public.audit_logs
  for select using (organization_id is not null and public.has_org_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Project-scoped resources. Same shape everywhere: read = can_read_project,
-- write = can_write_project, resolved through the owning project.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  direct_tables text[] := array[
    'figma_files','figma_frames','design_nodes','design_tokens','design_components',
    'design_assets','generated_projects','generation_runs','ai_messages',
    'build_runs','visual_comparisons','deployment_records'
  ];
begin
  foreach t in array direct_tables loop
    execute format(
      'create policy "read %1$s" on public.%1$I for select using (public.can_read_project(project_id));', t);
    execute format(
      'create policy "write %1$s" on public.%1$I for all using (public.can_write_project(project_id))
         with check (public.can_write_project(project_id));', t);
  end loop;
end $$;

-- Tables that reach their project through a parent row.
create policy "read figma pages" on public.figma_pages
  for select using (exists (
    select 1 from public.figma_files f
    where f.id = figma_pages.figma_file_id and public.can_read_project(f.project_id)));

create policy "read component variants" on public.design_component_variants
  for select using (exists (
    select 1 from public.design_components c
    where c.id = design_component_variants.design_component_id and public.can_read_project(c.project_id)));

create policy "read code versions" on public.code_versions
  for select using (exists (
    select 1 from public.generated_projects gp
    where gp.id = code_versions.generated_project_id and public.can_read_project(gp.project_id)));

create policy "read generated files" on public.generated_files
  for select using (exists (
    select 1 from public.code_versions cv
    join public.generated_projects gp on gp.id = cv.generated_project_id
    where cv.id = generated_files.code_version_id and public.can_read_project(gp.project_id)));

create policy "read generation steps" on public.generation_steps
  for select using (exists (
    select 1 from public.generation_runs r
    where r.id = generation_steps.generation_run_id and public.can_read_project(r.project_id)));

create policy "read tool calls" on public.ai_tool_calls
  for select using (exists (
    select 1 from public.generation_runs r
    where r.id = ai_tool_calls.generation_run_id and public.can_read_project(r.project_id)));

create policy "read build errors" on public.build_errors
  for select using (exists (
    select 1 from public.build_runs b
    where b.id = build_errors.build_run_id and public.can_read_project(b.project_id)));

create policy "read difference regions" on public.visual_difference_regions
  for select using (exists (
    select 1 from public.visual_comparisons vc
    where vc.id = visual_difference_regions.visual_comparison_id and public.can_read_project(vc.project_id)));

-- ---------------------------------------------------------------------------
-- Billing and telemetry: org-scoped, read-only from the client.
-- ---------------------------------------------------------------------------
create policy "read model runs" on public.model_runs
  for select using (public.is_org_member(organization_id));
create policy "read usage" on public.usage_records
  for select using (public.is_org_member(organization_id));
create policy "read subscription" on public.subscriptions
  for select using (public.is_org_member(organization_id));
create policy "admins read api keys" on public.api_keys
  for select using (public.has_org_role(organization_id, 'admin'));
create policy "admins manage api keys" on public.api_keys
  for all using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));

create policy "anyone reads enabled providers" on public.model_providers
  for select using (enabled);

-- No INSERT/UPDATE policy exists for audit_logs, model_runs, usage_records or
-- build_errors: they are written exclusively by the service role.

-- ---------------------------------------------------------------------------
-- Table privileges.
--
-- RLS restricts *which rows* a role may touch; GRANT decides whether the role
-- may touch the table at all. Both are required. `anon` is granted nothing:
-- an unauthenticated request should never reach application data, and the
-- marketing pages read no database at all.
--
-- Append-only and system-owned tables are deliberately omitted from the write
-- grants below, so even a bug in a policy cannot let a client write them.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

do $$
declare
  t text;
  -- Written only by the service role (workers, triggers, billing).
  service_only text[] := array[
    'audit_logs','model_runs','usage_records','build_errors','model_providers',
    'generation_steps','ai_tool_calls','generated_files','code_versions',
    'visual_difference_regions','figma_pages','design_component_variants','subscriptions'
  ];
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    if t = any(service_only) then
      execute format('grant select on public.%I to authenticated;', t);
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    end if;
  end loop;
end $$;

grant execute on function
  public.is_org_member(uuid),
  public.org_role_of(uuid),
  public.has_org_role(uuid, public.org_role),
  public.can_read_project(uuid),
  public.can_write_project(uuid)
to authenticated;

-- New tables added by later migrations inherit the same default.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
