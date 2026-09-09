-- =============================================================================
-- 0003 · Figma ingestion + Design IR  (schema now; pipeline lands in Phase 2)
--
-- Raw Figma payloads are kept only as an audit/replay artifact in storage.
-- Everything the AI reasons over lives in design_nodes, which is our IR.
-- =============================================================================

create table public.figma_files (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  figma_file_key    text not null,
  name              text not null,
  version           text,
  source_url        text,
  -- Path in the private `figma-assets` bucket; the raw JSON is never inlined here.
  raw_payload_path  text,
  last_imported_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (project_id, figma_file_key)
);
create index on public.figma_files (project_id) where deleted_at is null;

create table public.figma_pages (
  id              uuid primary key default gen_random_uuid(),
  figma_file_id   uuid not null references public.figma_files(id) on delete cascade,
  figma_node_id   text not null,
  name            text not null,
  order_index     int not null default 0,
  created_at      timestamptz not null default now(),
  unique (figma_file_id, figma_node_id)
);

create table public.figma_frames (
  id              uuid primary key default gen_random_uuid(),
  figma_page_id   uuid not null references public.figma_pages(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  figma_node_id   text not null,
  name            text not null,
  width           numeric not null,
  height          numeric not null,
  -- Which breakpoint this frame represents, when the file has one frame per width.
  breakpoint      int,
  is_selected     boolean not null default false,
  reference_image_path text,
  created_at      timestamptz not null default now(),
  unique (figma_page_id, figma_node_id)
);
create index on public.figma_frames (project_id, is_selected);

-- ---------------------------------------------------------------------------
-- Design IR. One row per node, adjacency-list tree, relational columns for the
-- properties every renderer needs and JSONB only for the genuinely open-ended
-- parts (effects, interactions, provider-specific extras).
-- ---------------------------------------------------------------------------
create table public.design_nodes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  figma_frame_id    uuid references public.figma_frames(id) on delete cascade,
  parent_id         uuid references public.design_nodes(id) on delete cascade,
  source_node_id    text,
  ir_type           text not null,        -- container | text | image | vector | instance | …
  semantic_role     text,                 -- navbar | hero | button | card | … (extensible)
  name              text not null,
  order_index       int not null default 0,
  depth             int not null default 0,

  x numeric, y numeric, width numeric, height numeric,

  layout_mode       text,                 -- none | horizontal | vertical | grid
  layout_gap        numeric,
  padding_top numeric, padding_right numeric, padding_bottom numeric, padding_left numeric,
  align_items       text,
  justify_content   text,
  sizing_horizontal text,                 -- fixed | hug | fill
  sizing_vertical   text,

  background_color  text,
  border_color      text,
  border_width      numeric,
  border_radius     numeric,

  font_family text, font_size numeric, font_weight int,
  line_height numeric, letter_spacing numeric, text_color text, text_content text,

  effects           jsonb not null default '[]'::jsonb,
  constraints       jsonb not null default '{}'::jsonb,
  responsive_hints  jsonb not null default '{}'::jsonb,
  interactions      jsonb not null default '[]'::jsonb,

  asset_id          uuid,
  design_component_id uuid,
  confidence        numeric(5,2) check (confidence between 0 and 100),
  created_at        timestamptz not null default now()
);
create index on public.design_nodes (project_id, figma_frame_id);
create index on public.design_nodes (parent_id);
create index on public.design_nodes (project_id, semantic_role);

create table public.design_tokens (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  category    text not null check (category in
                ('color','typography','spacing','radius','shadow','breakpoint','container','grid')),
  name        text not null,              -- e.g. colors.primary, spacing.md
  value       jsonb not null,
  source      text not null default 'inferred' check (source in ('figma_variable','figma_style','inferred','manual')),
  usage_count int not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, category, name)
);

create table public.design_components (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  name            text not null,
  semantic_role   text,
  confidence      numeric(5,2) check (confidence between 0 and 100),
  instance_count  int not null default 0,
  figma_component_key text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, name)
);

create table public.design_component_variants (
  id                  uuid primary key default gen_random_uuid(),
  design_component_id uuid not null references public.design_components(id) on delete cascade,
  name                text not null,
  properties          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (design_component_id, name)
);

create table public.design_assets (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('image','icon','svg','font','video')),
  mime_type     text,
  bytes         bigint not null default 0,
  storage_path  text not null,
  optimised_path text,
  usage_count   int not null default 0,
  created_at    timestamptz not null default now(),
  unique (project_id, storage_path)
);

alter table public.design_nodes
  add constraint design_nodes_asset_fk foreign key (asset_id)
    references public.design_assets(id) on delete set null,
  add constraint design_nodes_component_fk foreign key (design_component_id)
    references public.design_components(id) on delete set null;

create trigger touch_figma_files before update on public.figma_files
  for each row execute function public.touch_updated_at();
create trigger touch_design_components before update on public.design_components
  for each row execute function public.touch_updated_at();
