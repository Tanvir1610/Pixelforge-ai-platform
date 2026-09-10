-- =============================================================================
-- 0016 · Actor-scoped authorisation for worker paths
--
-- `can_read_project` / `can_write_project` answer "may the *current JWT* touch
-- this project?". That is the right question for RLS, and the wrong one for a
-- worker: a background stage holds the service role, `auth.uid()` is null, and
-- every one of these predicates is therefore false.
--
-- `create_code_version` gated on `can_write_project()` but is only ever called
-- from the generation stage, which runs under the service role. It could never
-- succeed: every generation would have died with insufficient_privilege at the
-- moment it tried to save its first version.
--
-- The fix is not to drop the check — that would make the service role a way to
-- write into any tenant's project — but to make the actor explicit. The `_as`
-- variants take the user the work is being done on behalf of; the original
-- predicates stay exactly as they were, defined in terms of them, so RLS is
-- unchanged.
-- =============================================================================

create or replace function public.can_read_project_as(p_user uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1
    from public.projects p
    left join public.project_members pm
      on pm.project_id = p.id
     and pm.user_id = p_user
     and pm.deleted_at is null
    left join public.organization_members om
      on om.organization_id = p.organization_id
     and om.user_id = p_user
     and om.deleted_at is null
    where p.id = p_project
      and p.deleted_at is null
      and (
        pm.user_id is not null
        or public.org_role_rank(om.role) >= public.org_role_rank('admin')
      )
  );
$$;

comment on function public.can_read_project_as is
  'can_read_project for an explicit actor. For worker paths holding the service role, where auth.uid() is null.';

create or replace function public.can_write_project_as(p_user uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1
    from public.projects p
    left join public.project_members pm
      on pm.project_id = p.id
     and pm.user_id = p_user
     and pm.deleted_at is null
    left join public.organization_members om
      on om.organization_id = p.organization_id
     and om.user_id = p_user
     and om.deleted_at is null
    where p.id = p_project
      and p.deleted_at is null
      and (
        pm.role in ('admin', 'developer', 'designer')
        or public.org_role_rank(om.role) >= public.org_role_rank('admin')
      )
  );
$$;

comment on function public.can_write_project_as is
  'can_write_project for an explicit actor. For worker paths holding the service role, where auth.uid() is null.';

-- The RLS predicates are now thin wrappers. Behaviour is identical; there is
-- one implementation of the rule rather than two that can drift apart.
create or replace function public.can_read_project(project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_project_as(auth.uid(), project);
$$;

create or replace function public.can_write_project(project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_write_project_as(auth.uid(), project);
$$;

-- ---------------------------------------------------------------------------
-- Version creation, with the actor passed in.
--
-- Dropped and recreated rather than overloaded: two candidate signatures would
-- make the PostgREST call ambiguous, and an ambiguous authorisation check is
-- worse than no fix at all.
-- ---------------------------------------------------------------------------
drop function if exists public.create_code_version(uuid, text, text, uuid);

create function public.create_code_version(
  p_project_id uuid,
  p_label text default null,
  p_summary text default null,
  p_generation_run_id uuid default null,
  -- The user this work is on behalf of. Null means "use the caller's JWT",
  -- which is what an interactive request wants.
  p_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_generated_project uuid;
  v_parent uuid;
  v_next int;
  v_version uuid;
begin
  -- An anonymous caller with no actor is refused rather than defaulted: the
  -- service role reaching here without naming a user is a bug, not a licence.
  if v_actor is null then
    raise exception 'create_code_version requires an authenticated caller or an explicit actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.can_write_project_as(v_actor, p_project_id) then
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
    v_parent, p_generation_run_id, v_actor
  )
  returning id into v_version;

  return v_version;
end;
$$;

grant execute on function public.create_code_version(uuid, text, text, uuid, uuid) to authenticated;
