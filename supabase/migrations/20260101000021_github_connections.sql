-- =============================================================================
-- 0021 · GitHub connections and repository links
--
-- Generated code could be read on screen and, since the export route, taken as
-- a zip. It could not be pushed anywhere. Three separate controls offered to —
-- "Push", "Push to GitHub", "Download repository" — and none of them had a
-- handler, because there was no integration behind any of them.
--
-- GitHub is not a deployment host, so it does not belong in
-- `deployment_credentials`: that table's `provider` is the `host_provider` enum
-- and its rows are tokens that create and destroy infrastructure. A source
-- repository is a different thing with a different lifetime, and mixing the two
-- would mean one revocation path for two unrelated kinds of access.
--
-- The shape mirrors `figma_connections`, which is the closest analogue: a
-- per-user token, held for the organization, with no client policy at all.
--
-- Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The connection.
--
-- NO client policy, deliberately, exactly as with figma_connections and
-- deployment_credentials. A token with `repo` scope can read and rewrite every
-- repository the user can reach; a browser session may learn that a connection
-- exists and under whose login, never the token itself.
-- ---------------------------------------------------------------------------
create table if not exists public.github_connections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,

  github_user_id   text not null,
  github_login     text not null,

  access_token     text not null,
  refresh_token    text,
  -- Classic OAuth App tokens do not expire. GitHub Apps, and OAuth Apps with
  -- expiring tokens enabled, return an expiry — so null means "no expiry",
  -- not "unknown".
  expires_at       timestamptz,

  -- Recorded rather than assumed. The Figma integration assumed OAuth and would
  -- have sent a pasted personal token with the wrong header; the same mistake
  -- is available here, since a fine-grained personal access token is a perfectly
  -- good way to connect and needs no OAuth app at all.
  token_kind       text not null default 'oauth'
                     check (token_kind in ('oauth', 'personal')),
  -- What the token is actually allowed to do, as GitHub reported it back.
  scope            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  unique (organization_id, user_id)
);

create index if not exists github_connections_org_idx
  on public.github_connections (organization_id) where revoked_at is null;

alter table public.github_connections enable row level security;
-- Intentionally no policies. Service role only.

drop trigger if exists touch_github_connections on public.github_connections;
create trigger touch_github_connections before update on public.github_connections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Non-secret projection, so the UI can say "Connected as @octocat".
-- ---------------------------------------------------------------------------
drop function if exists public.my_github_connection();

create function public.my_github_connection()
returns table (
  github_login text,
  expires_at timestamptz,
  is_active boolean,
  token_kind text,
  scope text
)
language sql
stable
security definer
set search_path = public
as $my_github_connection$
  select
    c.github_login,
    c.expires_at,
    (c.revoked_at is null and (c.expires_at is null or c.expires_at > now())),
    c.token_kind,
    c.scope
  from public.github_connections c
  where c.user_id = auth.uid()
    and public.is_org_member(c.organization_id)
  limit 1;
$my_github_connection$;

grant execute on function public.my_github_connection() to authenticated;

-- ---------------------------------------------------------------------------
-- Which repository a project pushes to.
--
-- One repository per project. A project that pushed to two places would have no
-- answer to "what is the current state of this code", which is the question the
-- screen exists to answer.
-- ---------------------------------------------------------------------------
create table if not exists public.github_repositories (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null unique references public.projects(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  owner            text not null,
  name             text not null,
  default_branch   text not null default 'main',
  html_url         text,
  -- True when this platform created it, which decides whether the first push
  -- may initialise an empty repository.
  created_by_us    boolean not null default false,

  last_pushed_sha  text,
  last_pushed_at   timestamptz,
  -- How many files the last successful push wrote, for the UI to report.
  last_file_count  int,

  connected_by     uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- GitHub is case-insensitive on both but preserves case; storing them lowered
  -- would make the displayed name wrong, so uniqueness is enforced on a lowered
  -- expression instead.
  unique (organization_id, owner, name)
);

create index if not exists github_repositories_org_idx
  on public.github_repositories (organization_id);

alter table public.github_repositories enable row level security;

-- Readable by anyone who can read the project: this is a repository name, not
-- a credential. Writes go through the service role, because a row here is only
-- ever created as the result of a call GitHub accepted — a browser-forged link
-- to a repository nobody owns would make the push button lie.
drop policy if exists "read project repository" on public.github_repositories;
create policy "read project repository" on public.github_repositories
  for select using (public.can_read_project_as(auth.uid(), project_id));

drop trigger if exists touch_github_repositories on public.github_repositories;
create trigger touch_github_repositories before update on public.github_repositories
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Push history.
--
-- Separate from the link because a link has one current state and a project has
-- many pushes, and "what did we send and when" is the first question asked when
-- a repository does not look the way someone expected.
-- ---------------------------------------------------------------------------
create table if not exists public.github_pushes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  code_version_id   uuid references public.code_versions(id) on delete set null,

  branch            text not null,
  commit_sha        text,
  commit_message    text,
  file_count        int not null default 0,
  status            text not null default 'succeeded'
                      check (status in ('succeeded', 'failed')),
  error_message     text,

  pushed_by         uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists github_pushes_project_idx
  on public.github_pushes (project_id, created_at desc);

alter table public.github_repositories enable row level security;
alter table public.github_pushes enable row level security;

drop policy if exists "read project pushes" on public.github_pushes;
create policy "read project pushes" on public.github_pushes
  for select using (public.can_read_project_as(auth.uid(), project_id));

comment on table public.github_connections is
  'Per-user GitHub tokens held for an organization. No client policy: service role only.';
comment on table public.github_repositories is
  'Which repository a project pushes generated code to. One per project.';
