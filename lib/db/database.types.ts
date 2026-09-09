/**
 * Database types.
 *
 * Regenerate after every migration:
 *   npx supabase gen types typescript --linked > lib/db/database.types.ts
 *
 * Checked in so the app typechecks without a live database connection. Only the
 * tables Phase 1 touches are fully typed; the rest are declared as they are
 * implemented, so an unfinished table cannot be silently queried as if it worked.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrgRole = "owner" | "admin" | "developer" | "designer" | "viewer";
export type ProjectRole = "admin" | "developer" | "designer" | "viewer";
export type ProjectStatus = "draft" | "importing" | "analysing" | "generating" | "review" | "live" | "failed";
export type FrameworkKey = "nextjs" | "react" | "vue" | "html";
export type StylingKey = "tailwind" | "css_modules" | "vanilla_css";
export type HostProviderKey = "none" | "vercel" | "netlify" | "cloudflare";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type UsageMetric = "ai_credits" | "generations" | "builds" | "storage_bytes" | "deployments";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "team";
  ai_credits_limit: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  framework: FrameworkKey;
  styling: StylingKey;
  typescript: boolean;
  responsive: boolean;
  host_provider: HostProviderKey;
  match_score: number | null;
  thumbnail_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ProjectMemberRow = {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type UsageRecordRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  metric: UsageMetric;
  quantity: number;
  occurred_at: string;
  metadata: Json;
};

export type AuditLogRow = {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Json;
  created_at: string;
};


// --- Design domain (Phase 2) -------------------------------------------------

export type FigmaFileRow = {
  id: string;
  project_id: string;
  figma_file_key: string;
  name: string;
  version: string | null;
  source_url: string | null;
  raw_payload_path: string | null;
  last_imported_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type FigmaPageRow = {
  id: string;
  figma_file_id: string;
  figma_node_id: string;
  name: string;
  order_index: number;
  created_at: string;
};

export type FigmaFrameRow = {
  id: string;
  figma_page_id: string;
  project_id: string;
  figma_node_id: string;
  name: string;
  width: number;
  height: number;
  breakpoint: number | null;
  is_selected: boolean;
  reference_image_path: string | null;
  created_at: string;
};

export type DesignNodeRow = {
  id: string;
  project_id: string;
  figma_frame_id: string | null;
  parent_id: string | null;
  source_node_id: string | null;
  ir_type: string;
  semantic_role: string | null;
  name: string;
  order_index: number;
  depth: number;
  x: number | null; y: number | null; width: number | null; height: number | null;
  layout_mode: string | null;
  layout_gap: number | null;
  padding_top: number | null; padding_right: number | null;
  padding_bottom: number | null; padding_left: number | null;
  align_items: string | null;
  justify_content: string | null;
  sizing_horizontal: string | null;
  sizing_vertical: string | null;
  background_color: string | null;
  border_color: string | null;
  border_width: number | null;
  border_radius: number | null;
  font_family: string | null; font_size: number | null; font_weight: number | null;
  line_height: number | null; letter_spacing: number | null;
  text_color: string | null; text_content: string | null;
  effects: Json;
  constraints: Json;
  responsive_hints: Json;
  interactions: Json;
  asset_id: string | null;
  design_component_id: string | null;
  confidence: number | null;
  created_at: string;
};

export type DesignTokenCategory =
  | "color" | "typography" | "spacing" | "radius" | "shadow" | "breakpoint" | "container" | "grid";

export type DesignTokenRow = {
  id: string;
  project_id: string;
  category: DesignTokenCategory;
  name: string;
  value: Json;
  source: "figma_variable" | "figma_style" | "inferred" | "manual";
  usage_count: number;
  created_at: string;
};

export type DesignComponentRow = {
  id: string;
  project_id: string;
  name: string;
  semantic_role: string | null;
  confidence: number | null;
  instance_count: number;
  figma_component_key: string | null;
  source: "heuristic" | "model" | "manual";
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type DesignAssetRow = {
  id: string;
  project_id: string;
  name: string;
  kind: "image" | "icon" | "svg" | "font" | "video";
  mime_type: string | null;
  bytes: number;
  storage_path: string;
  optimised_path: string | null;
  usage_count: number;
  created_at: string;
};

export type FigmaConnectionRow = {
  id: string;
  organization_id: string;
  user_id: string;
  figma_user_id: string;
  figma_handle: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

// --- Generation (Phase 3 schema, written from Phase 2 onward) ----------------

export type GenerationTrigger = "import" | "manual" | "refinement" | "visual_fix" | "retry";

export type GenerationRunRow = {
  id: string;
  project_id: string;
  code_version_id: string | null;
  trigger: GenerationTrigger;
  status: RunStatus;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type GenerationStepRow = {
  id: string;
  generation_run_id: string;
  key: string;
  label: string;
  status: RunStatus;
  order_index: number;
  result_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
};


// --- Orchestration (Phase 3) -------------------------------------------------

export type ArtifactKind =
  | "design_analysis" | "component_plan" | "architecture_plan"
  | "responsive_plan" | "code_plan" | "visual_report" | "refinement_plan";

export type ModelProviderRow = {
  id: string;
  key: string;
  display_name: string;
  kind: "external" | "local" | "own";
  enabled: boolean;
  capabilities: Json;
  created_at: string;
};

export type ModelRunRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  generation_run_id: string | null;
  model_provider_id: string | null;
  model_key: string;
  purpose: string;
  agent: string | null;
  attempt: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  status: RunStatus;
  error_code: string | null;
  created_at: string;
};

export type GenerationArtifactRow = {
  id: string;
  project_id: string;
  generation_run_id: string | null;
  kind: ArtifactKind;
  schema_version: number;
  payload: Json;
  model_run_id: string | null;
  created_at: string;
};


// --- Code generation (Phase 4) -----------------------------------------------

export type ChangeKind = "added" | "modified" | "deleted" | "unchanged";

export type GeneratedProjectRow = {
  id: string;
  project_id: string;
  framework: FrameworkKey;
  styling: StylingKey;
  root_path: string;
  created_at: string;
};

export type CodeVersionRow = {
  id: string;
  generated_project_id: string;
  version_number: number;
  label: string | null;
  summary: string | null;
  parent_version_id: string | null;
  generation_run_id: string | null;
  file_count: number;
  added_count: number;
  modified_count: number;
  deleted_count: number;
  created_by: string | null;
  created_at: string;
};

export type GeneratedFileRow = {
  id: string;
  code_version_id: string;
  path: string;
  content_hash: string;
  storage_path: string | null;
  content: string | null;
  bytes: number;
  language: string | null;
  change_kind: ChangeKind;
  created_at: string;
};

export type AiToolCallRow = {
  id: string;
  ai_message_id: string | null;
  generation_run_id: string | null;
  project_id: string | null;
  tool_name: string;
  mode: "read" | "write";
  arguments: Json;
  result_summary: string | null;
  error_message: string | null;
  status: RunStatus;
  duration_ms: number | null;
  created_at: string;
};


// --- Builds (Phase 5) --------------------------------------------------------

export type BuildRunRow = {
  id: string;
  project_id: string;
  code_version_id: string | null;
  code_version_number: number | null;
  generation_run_id: string | null;
  status: RunStatus;
  failed_phase: string | null;
  error_count: number;
  warning_count: number;
  sandbox_backend: "local" | "container" | "microvm";
  timed_out: boolean;
  install_ms: number | null;
  typecheck_ms: number | null;
  lint_ms: number | null;
  build_ms: number | null;
  log_path: string | null;
  preview_url: string | null;
  created_at: string;
  finished_at: string | null;
};

export type BuildErrorRow = {
  id: string;
  build_run_id: string;
  severity: "error" | "warning";
  phase: "install" | "typecheck" | "lint" | "build" | "runtime";
  file_path: string | null;
  line: number | null;
  column_number: number | null;
  code: string | null;
  message: string;
  iteration: number;
  fix_attempted: boolean;
  resolved_at: string | null;
  created_at: string;
};


// --- Visual QA (Phase 6) -----------------------------------------------------

export type VisualComparisonRow = {
  id: string;
  project_id: string;
  build_run_id: string | null;
  figma_frame_id: string | null;
  code_version_id: string | null;
  generation_run_id: string | null;
  iteration: number;
  breakpoint: number;
  similarity_score: number;
  spacing_score: number | null;
  typography_score: number | null;
  color_score: number | null;
  layout_score: number | null;
  component_score: number | null;
  matched_nodes: number;
  unmatched_nodes: number;
  pixel_delta: number | null;
  reference_image_path: string | null;
  actual_image_path: string | null;
  diff_image_path: string | null;
  dom_snapshot_path: string | null;
  created_at: string;
};

export type VisualDifferenceRegionRow = {
  id: string;
  visual_comparison_id: string;
  category: string;
  severity: "high" | "medium" | "low";
  label: string;
  detail: string | null;
  expected_value: string | null;
  actual_value: string | null;
  x: number | null; y: number | null; width: number | null; height: number | null;
  design_node_id: string | null;
  source: "dom" | "pixel" | "both";
  magnitude: number;
  breakpoint: number | null;
  fixed_at: string | null;
  created_at: string;
};


// --- Deployment (Phase 7) ----------------------------------------------------

export type DeploymentPhaseKey =
  | "queued" | "uploading" | "building" | "deploying" | "live" | "failed" | "cancelled";

export type DeploymentCredentialRow = {
  id: string;
  organization_id: string;
  provider: HostProviderKey;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  account_id: string | null;
  account_label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type DeploymentRecordRow = {
  id: string;
  project_id: string;
  code_version_id: string | null;
  build_run_id: string | null;
  generation_run_id: string | null;
  provider: HostProviderKey;
  environment: "preview" | "production";
  status: RunStatus;
  phase: DeploymentPhaseKey;
  provider_deployment_id: string | null;
  commit_hash: string | null;
  branch: string | null;
  url: string | null;
  log_path: string | null;
  error_code: string | null;
  error_message: string | null;
  file_count: number;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
};


// --- Domains and host connect (Phase 7, part 2) ------------------------------

export type DomainStatusKey = "pending" | "verifying" | "verified" | "failed" | "removed";

export type ProjectDomainRow = {
  id: string;
  project_id: string;
  domain: string;
  provider: HostProviderKey;
  status: DomainStatusKey;
  is_primary: boolean;
  verification_type: "TXT" | "CNAME" | "A" | null;
  verification_name: string | null;
  verification_value: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OauthStateRow = {
  state: string;
  organization_id: string;
  user_id: string;
  provider: string;
  redirect_path: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};


// --- Payments ----------------------------------------------------------------

export type PaymentStatusKey =
  | "created" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";

export type BillingPlanRow = {
  key: "free" | "pro" | "team";
  display_name: string;
  amount_minor: number;
  currency: string;
  interval: "monthly" | "yearly";
  ai_credits: number;
  max_projects: number | null;
  provider_plan_id: string | null;
  active: boolean;
  created_at: string;
};

export type PaymentCustomerRow = {
  id: string;
  organization_id: string;
  provider: string;
  provider_customer_id: string;
  email: string | null;
  created_at: string;
};

export type PaymentOrderRow = {
  id: string;
  organization_id: string;
  plan_key: string;
  provider: string;
  provider_order_id: string;
  amount_minor: number;
  currency: string;
  status: PaymentStatusKey;
  created_by: string | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  organization_id: string;
  order_id: string | null;
  provider: string;
  provider_payment_id: string;
  amount_minor: number;
  amount_refunded_minor: number;
  currency: string;
  status: PaymentStatusKey;
  method: string | null;
  failure_reason: string | null;
  captured_at: string | null;
  created_at: string;
};

export type PaymentWebhookEventRow = {
  provider_event_id: string;
  provider: string;
  event_type: string;
  organization_id: string | null;
  payload: Json;
  processed_at: string | null;
  error_message: string | null;
  received_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Pick<ProfileRow, "id" | "email"> & Partial<ProfileRow>;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      organizations: {
        Row: OrganizationRow;
        Insert: Pick<OrganizationRow, "name" | "slug" | "created_by"> & Partial<OrganizationRow>;
        Update: Partial<OrganizationRow>;
        Relationships: [];
      };
      organization_members: {
        Row: OrganizationMemberRow;
        Insert: Pick<OrganizationMemberRow, "organization_id" | "user_id"> & Partial<OrganizationMemberRow>;
        Update: Partial<OrganizationMemberRow>;
        Relationships: [];
      };
      projects: {
        Row: ProjectRow;
        Insert: Pick<ProjectRow, "organization_id" | "name" | "slug" | "created_by"> & Partial<ProjectRow>;
        Update: Partial<ProjectRow>;
        Relationships: [];
      };
      project_members: {
        Row: ProjectMemberRow;
        Insert: Pick<ProjectMemberRow, "project_id" | "user_id"> & Partial<ProjectMemberRow>;
        Update: Partial<ProjectMemberRow>;
        Relationships: [];
      };
      usage_records: {
        Row: UsageRecordRow;
        Insert: Pick<UsageRecordRow, "organization_id" | "metric" | "quantity"> & Partial<UsageRecordRow>;
        Update: Partial<UsageRecordRow>;
        Relationships: [];
      };
      figma_files: {
        Row: FigmaFileRow;
        Insert: Pick<FigmaFileRow, "project_id" | "figma_file_key" | "name"> & Partial<FigmaFileRow>;
        Update: Partial<FigmaFileRow>;
        Relationships: [];
      };
      figma_pages: {
        Row: FigmaPageRow;
        Insert: Pick<FigmaPageRow, "figma_file_id" | "figma_node_id" | "name"> & Partial<FigmaPageRow>;
        Update: Partial<FigmaPageRow>;
        Relationships: [];
      };
      figma_frames: {
        Row: FigmaFrameRow;
        Insert: Pick<FigmaFrameRow, "figma_page_id" | "project_id" | "figma_node_id" | "name" | "width" | "height"> &
          Partial<FigmaFrameRow>;
        Update: Partial<FigmaFrameRow>;
        Relationships: [];
      };
      design_nodes: {
        Row: DesignNodeRow;
        Insert: Pick<DesignNodeRow, "project_id" | "ir_type" | "name"> & Partial<DesignNodeRow>;
        Update: Partial<DesignNodeRow>;
        Relationships: [];
      };
      design_tokens: {
        Row: DesignTokenRow;
        Insert: Pick<DesignTokenRow, "project_id" | "category" | "name" | "value"> & Partial<DesignTokenRow>;
        Update: Partial<DesignTokenRow>;
        Relationships: [];
      };
      design_components: {
        Row: DesignComponentRow;
        Insert: Pick<DesignComponentRow, "project_id" | "name"> & Partial<DesignComponentRow>;
        Update: Partial<DesignComponentRow>;
        Relationships: [];
      };
      design_assets: {
        Row: DesignAssetRow;
        Insert: Pick<DesignAssetRow, "project_id" | "name" | "kind" | "storage_path"> & Partial<DesignAssetRow>;
        Update: Partial<DesignAssetRow>;
        Relationships: [];
      };
      figma_connections: {
        Row: FigmaConnectionRow;
        Insert: Pick<FigmaConnectionRow, "organization_id" | "user_id" | "figma_user_id" | "access_token"> &
          Partial<FigmaConnectionRow>;
        Update: Partial<FigmaConnectionRow>;
        Relationships: [];
      };
      generation_runs: {
        Row: GenerationRunRow;
        Insert: Pick<GenerationRunRow, "project_id" | "trigger"> & Partial<GenerationRunRow>;
        Update: Partial<GenerationRunRow>;
        Relationships: [];
      };
      generation_steps: {
        Row: GenerationStepRow;
        Insert: Pick<GenerationStepRow, "generation_run_id" | "key" | "label" | "order_index"> &
          Partial<GenerationStepRow>;
        Update: Partial<GenerationStepRow>;
        Relationships: [];
      };
      model_providers: {
        Row: ModelProviderRow;
        Insert: Pick<ModelProviderRow, "key" | "display_name" | "kind"> & Partial<ModelProviderRow>;
        Update: Partial<ModelProviderRow>;
        Relationships: [];
      };
      model_runs: {
        Row: ModelRunRow;
        Insert: Pick<ModelRunRow, "organization_id" | "model_key" | "purpose"> & Partial<ModelRunRow>;
        Update: Partial<ModelRunRow>;
        Relationships: [];
      };
      generation_artifacts: {
        Row: GenerationArtifactRow;
        Insert: Pick<GenerationArtifactRow, "project_id" | "kind" | "payload"> & Partial<GenerationArtifactRow>;
        Update: Partial<GenerationArtifactRow>;
        Relationships: [];
      };
      generated_projects: {
        Row: GeneratedProjectRow;
        Insert: Pick<GeneratedProjectRow, "project_id" | "framework" | "styling"> & Partial<GeneratedProjectRow>;
        Update: Partial<GeneratedProjectRow>;
        Relationships: [];
      };
      code_versions: {
        Row: CodeVersionRow;
        Insert: Pick<CodeVersionRow, "generated_project_id" | "version_number"> & Partial<CodeVersionRow>;
        Update: Partial<CodeVersionRow>;
        Relationships: [];
      };
      generated_files: {
        Row: GeneratedFileRow;
        Insert: Pick<GeneratedFileRow, "code_version_id" | "path" | "content_hash"> & Partial<GeneratedFileRow>;
        Update: Partial<GeneratedFileRow>;
        Relationships: [];
      };
      ai_tool_calls: {
        Row: AiToolCallRow;
        Insert: Pick<AiToolCallRow, "tool_name"> & Partial<AiToolCallRow>;
        Update: Partial<AiToolCallRow>;
        Relationships: [];
      };
      build_runs: {
        Row: BuildRunRow;
        Insert: Pick<BuildRunRow, "project_id"> & Partial<BuildRunRow>;
        Update: Partial<BuildRunRow>;
        Relationships: [];
      };
      build_errors: {
        Row: BuildErrorRow;
        Insert: Pick<BuildErrorRow, "build_run_id" | "severity" | "phase" | "message"> & Partial<BuildErrorRow>;
        Update: Partial<BuildErrorRow>;
        Relationships: [];
      };
      visual_comparisons: {
        Row: VisualComparisonRow;
        Insert: Pick<VisualComparisonRow, "project_id" | "breakpoint" | "similarity_score"> &
          Partial<VisualComparisonRow>;
        Update: Partial<VisualComparisonRow>;
        Relationships: [];
      };
      visual_difference_regions: {
        Row: VisualDifferenceRegionRow;
        Insert: Pick<VisualDifferenceRegionRow, "visual_comparison_id" | "category" | "severity" | "label"> &
          Partial<VisualDifferenceRegionRow>;
        Update: Partial<VisualDifferenceRegionRow>;
        Relationships: [];
      };
      deployment_credentials: {
        Row: DeploymentCredentialRow;
        Insert: Pick<DeploymentCredentialRow, "organization_id" | "provider" | "access_token"> &
          Partial<DeploymentCredentialRow>;
        Update: Partial<DeploymentCredentialRow>;
        Relationships: [];
      };
      deployment_records: {
        Row: DeploymentRecordRow;
        Insert: Pick<DeploymentRecordRow, "project_id" | "provider"> & Partial<DeploymentRecordRow>;
        Update: Partial<DeploymentRecordRow>;
        Relationships: [];
      };
      project_domains: {
        Row: ProjectDomainRow;
        Insert: Pick<ProjectDomainRow, "project_id" | "domain" | "provider"> & Partial<ProjectDomainRow>;
        Update: Partial<ProjectDomainRow>;
        Relationships: [];
      };
      oauth_states: {
        Row: OauthStateRow;
        Insert: Pick<OauthStateRow, "state" | "organization_id" | "user_id" | "provider"> & Partial<OauthStateRow>;
        Update: Partial<OauthStateRow>;
        Relationships: [];
      };
      billing_plans: {
        Row: BillingPlanRow;
        Insert: Pick<BillingPlanRow, "key" | "display_name" | "amount_minor" | "ai_credits"> &
          Partial<BillingPlanRow>;
        Update: Partial<BillingPlanRow>;
        Relationships: [];
      };
      payment_customers: {
        Row: PaymentCustomerRow;
        Insert: Pick<PaymentCustomerRow, "organization_id" | "provider_customer_id"> &
          Partial<PaymentCustomerRow>;
        Update: Partial<PaymentCustomerRow>;
        Relationships: [];
      };
      payment_orders: {
        Row: PaymentOrderRow;
        Insert: Pick<PaymentOrderRow, "organization_id" | "plan_key" | "provider_order_id" | "amount_minor"> &
          Partial<PaymentOrderRow>;
        Update: Partial<PaymentOrderRow>;
        Relationships: [];
      };
      payments: {
        Row: PaymentRow;
        Insert: Pick<PaymentRow, "organization_id" | "provider_payment_id" | "amount_minor" | "status"> &
          Partial<PaymentRow>;
        Update: Partial<PaymentRow>;
        Relationships: [];
      };
      payment_webhook_events: {
        Row: PaymentWebhookEventRow;
        Insert: Pick<PaymentWebhookEventRow, "provider_event_id" | "event_type" | "payload"> &
          Partial<PaymentWebhookEventRow>;
        Update: Partial<PaymentWebhookEventRow>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: Pick<AuditLogRow, "action" | "resource_type"> & Partial<AuditLogRow>;
        Update: Partial<AuditLogRow>;
        Relationships: [];
      };
    };
    // Record<string, never> would make *every* string a valid view name, which
    // breaks .from() overload resolution. Record<never, never> has no keys.
    Views: Record<never, never>;
    Functions: {
      can_read_project: { Args: { project: string }; Returns: boolean };
      can_write_project: { Args: { project: string }; Returns: boolean };
      has_org_role: { Args: { org_id: string; minimum: OrgRole }; Returns: boolean };
      my_figma_connection: {
        Args: Record<never, never>;
        Returns: { figma_handle: string | null; expires_at: string | null; is_active: boolean }[];
      };
      my_credit_balance: {
        Args: { p_organization_id: string };
        Returns: { used: number; limit: number; remaining: number }[];
      };
      start_generation_run: {
        Args: { p_project_id: string; p_trigger: GenerationTrigger; p_steps: string[][] };
        Returns: string;
      };
      apply_role_corrections: {
        Args: { p_project_id: string; p_updates: Json };
        Returns: number;
      };
      record_model_run: {
        Args: {
          p_organization_id: string; p_model_key: string; p_purpose: string;
          p_input_tokens: number; p_output_tokens: number; p_cost_usd: number;
          p_latency_ms: number; p_status?: RunStatus; p_project_id?: string | null;
          p_generation_run_id?: string | null; p_provider_key?: string | null;
          p_credits?: number;
        };
        Returns: string;
      };
      has_credits: {
        Args: { p_organization_id: string; p_needed?: number };
        Returns: boolean;
      };
      create_code_version: {
        Args: {
          p_project_id: string; p_label?: string | null;
          p_summary?: string | null; p_generation_run_id?: string | null;
        };
        Returns: string;
      };
      finalise_code_version: { Args: { p_version_id: string }; Returns: undefined };
      restore_code_version: { Args: { p_version_id: string }; Returns: string };
      start_build_run: {
        Args: {
          p_project_id: string; p_code_version_id?: string | null;
          p_generation_run_id?: string | null; p_sandbox_backend?: string;
        };
        Returns: string;
      };
      finish_build_run: {
        Args: {
          p_build_run_id: string; p_status: RunStatus; p_failed_phase?: string | null;
          p_timings?: Json; p_errors?: Json; p_timed_out?: boolean; p_iteration?: number;
        };
        Returns: undefined;
      };
      record_visual_comparison: {
        Args: {
          p_project_id: string; p_breakpoint: number; p_similarity: number; p_metrics: Json;
          p_regions?: Json; p_code_version_id?: string | null; p_generation_run_id?: string | null;
          p_iteration?: number; p_matched_nodes?: number; p_unmatched_nodes?: number;
          p_pixel_delta?: number | null; p_figma_frame_id?: string | null;
        };
        Returns: string;
      };
      mark_regions_fixed: { Args: { p_region_ids: string[] }; Returns: number };
      start_deployment: {
        Args: {
          p_project_id: string; p_code_version_id: string; p_provider: HostProviderKey;
          p_environment?: string; p_generation_run_id?: string | null;
        };
        Returns: string;
      };
      update_deployment_phase: {
        Args: {
          p_deployment_id: string; p_phase: string;
          p_provider_deployment_id?: string | null; p_url?: string | null;
        };
        Returns: undefined;
      };
      finish_deployment: {
        Args: {
          p_deployment_id: string; p_status: RunStatus; p_url?: string | null;
          p_error_code?: string | null; p_error_message?: string | null; p_commit_hash?: string | null;
        };
        Returns: undefined;
      };
      my_deployment_connections: {
        Args: Record<never, never>;
        Returns: { provider: HostProviderKey; account_label: string | null; is_active: boolean }[];
      };
      set_domain_verification: {
        Args: {
          p_domain_id: string; p_status: DomainStatusKey; p_type?: string | null;
          p_name?: string | null; p_value?: string | null; p_error?: string | null;
        };
        Returns: undefined;
      };
      rollback_deployment: { Args: { p_deployment_id: string }; Returns: string };
      consume_oauth_state: {
        Args: { p_state: string };
        Returns: { organization_id: string; user_id: string; provider: string; redirect_path: string }[];
      };
      apply_subscription: {
        Args: {
          p_organization_id: string; p_plan_key: string; p_status: string;
          p_provider_subscription_id?: string | null;
          p_period_start?: string | null; p_period_end?: string | null;
          p_payment_id?: string | null;
        };
        Returns: undefined;
      };
      claim_webhook_event: {
        Args: {
          p_provider_event_id: string; p_event_type: string;
          p_payload: Json; p_organization_id?: string | null;
        };
        Returns: boolean;
      };
      complete_webhook_event: {
        Args: { p_provider_event_id: string; p_error?: string | null };
        Returns: undefined;
      };
      record_usage: {
        Args: {
          p_organization_id: string; p_metric: UsageMetric; p_quantity: number;
          p_project_id?: string | null; p_metadata?: Json;
        };
        Returns: number;
      };
    };
    Enums: {
      org_role: OrgRole;
      project_role: ProjectRole;
      project_status: ProjectStatus;
      framework: FrameworkKey;
      styling: StylingKey;
      host_provider: HostProviderKey;
      run_status: RunStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
