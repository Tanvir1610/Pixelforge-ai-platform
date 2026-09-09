-- =============================================================================
-- 0004 · Generation, build, visual QA, deployment, models, usage
--        (schema now; pipelines land in Phases 3–8)
-- =============================================================================

create table public.model_providers (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,     -- 'anthropic' | 'openai' | 'local' | 'pixelforge'
  display_name  text not null,
  kind          text not null check (kind in ('external','local','own')),
  enabled       boolean not null default true,
  capabilities  jsonb not null default '{}'::jsonb,  -- {generate, stream, embed, vision, structured}
  created_at    timestamptz not null default now()
);

create table public.generated_projects (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  framework       public.framework not null,
  styling         public.styling not null,
  root_path       text not null default '/',
  created_at      timestamptz not null default now()
);

create table public.code_versions (
  id                    uuid primary key default gen_random_uuid(),
  generated_project_id  uuid not null references public.generated_projects(id) on delete cascade,
  version_number        int not null,
  label                 text,
  parent_version_id     uuid references public.code_versions(id) on delete set null,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (generated_project_id, version_number)
);

create table public.generated_files (
  id                uuid primary key default gen_random_uuid(),
  code_version_id   uuid not null references public.code_versions(id) on delete cascade,
  path              text not null,
  content_hash      text not null,
  storage_path      text,                 -- large files live in object storage
  content           text,                 -- small files inline for fast diffing
  bytes             int not null default 0,
  language          text,
  created_at        timestamptz not null default now(),
  unique (code_version_id, path)
);
create index on public.generated_files (code_version_id);

create table public.generation_runs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  code_version_id uuid references public.code_versions(id) on delete set null,
  trigger         text not null check (trigger in ('import','manual','refinement','visual_fix','retry')),
  status          public.run_status not null default 'queued',
  progress        int not null default 0 check (progress between 0 and 100),
  error_code      text,
  error_message   text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.generation_runs (project_id, created_at desc);

create table public.generation_steps (
  id                uuid primary key default gen_random_uuid(),
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  key               text not null,        -- analyse_layout | plan_components | write_code | …
  label             text not null,
  status            public.run_status not null default 'queued',
  order_index       int not null,
  result_summary    text,
  started_at        timestamptz,
  finished_at       timestamptz,
  unique (generation_run_id, key)
);

create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  role              text not null check (role in ('user','assistant','system','tool')),
  content           text not null,
  -- Structured findings the assistant proposes, before the user approves them.
  proposal          jsonb,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.ai_messages (project_id, created_at);

create table public.ai_tool_calls (
  id              uuid primary key default gen_random_uuid(),
  ai_message_id   uuid references public.ai_messages(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete cascade,
  tool_name       text not null,
  arguments       jsonb not null default '{}'::jsonb,
  result_summary  text,
  status          public.run_status not null default 'queued',
  duration_ms     int,
  created_at      timestamptz not null default now()
);

create table public.model_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete set null,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  model_provider_id uuid references public.model_providers(id) on delete set null,
  model_key         text not null,
  purpose           text not null,        -- design_analysis | planning | codegen | visual_qa | …
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  latency_ms        int,
  status            public.run_status not null default 'completed',
  created_at        timestamptz not null default now()
);
create index on public.model_runs (organization_id, created_at desc);

create table public.build_runs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  code_version_id   uuid references public.code_versions(id) on delete set null,
  status            public.run_status not null default 'queued',
  install_ms int, typecheck_ms int, lint_ms int, build_ms int,
  log_path          text,
  preview_url       text,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index on public.build_runs (project_id, created_at desc);

create table public.build_errors (
  id            uuid primary key default gen_random_uuid(),
  build_run_id  uuid not null references public.build_runs(id) on delete cascade,
  severity      text not null check (severity in ('error','warning')),
  phase         text not null check (phase in ('install','typecheck','lint','build','runtime')),
  file_path     text,
  line          int,
  column_number int,
  code          text,
  message       text not null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table public.visual_comparisons (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  build_run_id      uuid references public.build_runs(id) on delete set null,
  figma_frame_id    uuid references public.figma_frames(id) on delete set null,
  iteration         int not null default 1,
  breakpoint        int not null default 1440,
  similarity_score  numeric(5,2) not null check (similarity_score between 0 and 100),
  spacing_score     numeric(5,2),
  typography_score  numeric(5,2),
  color_score       numeric(5,2),
  layout_score      numeric(5,2),
  component_score   numeric(5,2),
  reference_image_path text,
  actual_image_path    text,
  diff_image_path      text,
  created_at        timestamptz not null default now()
);
create index on public.visual_comparisons (project_id, created_at desc);

create table public.visual_difference_regions (
  id                    uuid primary key default gen_random_uuid(),
  visual_comparison_id  uuid not null references public.visual_comparisons(id) on delete cascade,
  category              text not null check (category in
                          ('layout','spacing','typography','color','position','size','alignment','image','border','shadow')),
  severity              text not null check (severity in ('high','medium','low')),
  label                 text not null,        -- 'Hero padding'
  detail                text,                 -- '96 vs 88px'
  expected_value        text,
  actual_value          text,
  x numeric, y numeric, width numeric, height numeric,
  design_node_id        uuid references public.design_nodes(id) on delete set null,
  fixed_at              timestamptz,
  created_at            timestamptz not null default now()
);

create table public.deployment_records (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  code_version_id uuid references public.code_versions(id) on delete set null,
  provider        public.host_provider not null,
  status          public.run_status not null default 'queued',
  commit_hash     text,
  branch          text,
  url             text,
  log_path        text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index on public.deployment_records (project_id, created_at desc);

-- Usage is always computed server-side from these rows; never trusted from a client.
create table public.usage_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  metric          text not null check (metric in ('ai_credits','generations','builds','storage_bytes','deployments')),
  quantity        numeric not null,
  occurred_at     timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb
);
create index on public.usage_records (organization_id, metric, occurred_at desc);

create table public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null unique references public.organizations(id) on delete cascade,
  plan              text not null check (plan in ('free','pro','team')),
  status            text not null check (status in ('trialing','active','past_due','canceled')),
  current_period_end timestamptz,
  external_customer_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Only a SHA-256 hash is stored. The plaintext key is shown once, at creation.
create table public.api_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  key_prefix      text not null,
  key_hash        text not null unique,
  last_used_at    timestamptz,
  expires_at      timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

create trigger touch_subscriptions before update on public.subscriptions
  for each row execute function public.touch_updated_at();

insert into public.model_providers (key, display_name, kind, capabilities) values
  ('anthropic', 'Anthropic', 'external',
   '{"generate":true,"stream":true,"structured":true,"vision":true,"embed":false}'::jsonb),
  ('openai', 'OpenAI', 'external',
   '{"generate":true,"stream":true,"structured":true,"vision":true,"embed":true}'::jsonb),
  ('pixelforge', 'PixelForge (own models)', 'own',
   '{"generate":false,"stream":false,"structured":false,"vision":false,"embed":false}'::jsonb)
on conflict (key) do nothing;
