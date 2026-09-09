import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { DesignNodeRow, DesignTokenRow } from "@/lib/db/database.types";
import type { DesignDocument, IrNode } from "@/lib/design-ir/types";
import type { Session } from "@/lib/auth/session";

/**
 * Read side of the design domain, used by the analysis and understanding
 * screens. Runs under the user's JWT, so RLS filters by project membership.
 */
export interface DesignSummary {
  frames: { id: string; name: string; width: number; height: number; breakpoint: number | null }[];
  nodeCount: number;
  components: { name: string; role: string | null; confidence: number }[];
  tokens: DesignTokenRow[];
  needsReview: { name: string; role: string | null; confidence: number }[];
}

export async function getDesignSummary(session: Session, projectId: string): Promise<DesignSummary | null> {
  if (session.demo) return null;

  const supabase = await createClient();
  if (!supabase) return null;

  const [frames, nodes, tokens] = await Promise.all([
    supabase
      .from("figma_frames")
      .select("id, name, width, height, breakpoint")
      .eq("project_id", projectId)
      .order("width", { ascending: false }),
    supabase
      .from("design_nodes")
      .select("name, semantic_role, confidence")
      .eq("project_id", projectId)
      .not("semantic_role", "is", null)
      .order("confidence", { ascending: false }),
    supabase.from("design_tokens").select("*").eq("project_id", projectId).order("usage_count", { ascending: false }),
  ]);

  if (!frames.data?.length) return null;

  const classified = (nodes.data ?? []) as Pick<DesignNodeRow, "name" | "semantic_role" | "confidence">[];

  // One entry per role, keeping the most confident example of each — the
  // understanding screen lists component kinds, not every instance.
  const bestByRole = new Map<string, { name: string; role: string | null; confidence: number }>();
  for (const node of classified) {
    const role = node.semantic_role ?? "unknown";
    const confidence = Number(node.confidence ?? 0);
    const existing = bestByRole.get(role);
    if (!existing || confidence > existing.confidence) {
      bestByRole.set(role, { name: node.name, role: node.semantic_role, confidence });
    }
  }

  return {
    frames: frames.data,
    nodeCount: classified.length,
    components: [...bestByRole.values()].sort((a, b) => b.confidence - a.confidence),
    tokens: tokens.data ?? [],
    needsReview: classified
      .filter((node) => Number(node.confidence ?? 100) < 85)
      .map((node) => ({ name: node.name, role: node.semantic_role, confidence: Number(node.confidence ?? 0) })),
  };
}

/**
 * Rebuilds a DesignDocument from the database.
 *
 * The IR is stored as rows; agents consume the object graph. This is the
 * inverse of `persistDesignDocument`, and the reason `source_node_id` is kept:
 * corrections an agent proposes reference database ids, which have to map back
 * to something stable across re-imports.
 *
 * Uses the service role because it is called from the orchestrator, which has
 * already authorised the project.
 */
/**
 * JSONB columns come back as `Json`. The shape was written by our own
 * normaliser, so this narrows at the single point where it re-enters the IR —
 * the same boundary `persistDesignDocument` widens at.
 */
function fromJson<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T;
}

export async function loadDesignDocument(projectId: string): Promise<DesignDocument | null> {
  const supabase = createServiceClient();

  const [fileResult, framesResult, nodesResult, tokensResult] = await Promise.all([
    supabase.from("figma_files").select("*").eq("project_id", projectId).limit(1).maybeSingle(),
    supabase.from("figma_frames").select("*").eq("project_id", projectId).order("width", { ascending: false }),
    supabase.from("design_nodes").select("*").eq("project_id", projectId).order("depth").order("order_index"),
    supabase.from("design_tokens").select("*").eq("project_id", projectId),
  ]);

  const file = fileResult.data;
  const frameRows = framesResult.data ?? [];
  const nodeRows = nodesResult.data ?? [];
  if (!file || nodeRows.length === 0) return null;

  const nodes: Record<string, IrNode> = {};
  const childrenOf = new Map<string, string[]>();

  for (const row of nodeRows) {
    if (row.parent_id) {
      const siblings = childrenOf.get(row.parent_id) ?? [];
      siblings.push(row.id);
      childrenOf.set(row.parent_id, siblings);
    }
  }

  for (const row of nodeRows) {
    nodes[row.id] = {
      id: row.id,
      type: row.ir_type as IrNode["type"],
      name: row.name,
      sourceNodeId: row.source_node_id ?? undefined,
      parentId: row.parent_id,
      childIds: childrenOf.get(row.id) ?? [],
      orderIndex: row.order_index,
      depth: row.depth,
      box: {
        x: Number(row.x ?? 0), y: Number(row.y ?? 0),
        width: Number(row.width ?? 0), height: Number(row.height ?? 0),
      },
      layout: {
        mode: (row.layout_mode ?? "none") as IrNode["layout"]["mode"],
        gap: Number(row.layout_gap ?? 0),
        padding: {
          top: Number(row.padding_top ?? 0), right: Number(row.padding_right ?? 0),
          bottom: Number(row.padding_bottom ?? 0), left: Number(row.padding_left ?? 0),
        },
        alignItems: (row.align_items ?? undefined) as IrNode["layout"]["alignItems"],
        justifyContent: (row.justify_content ?? undefined) as IrNode["layout"]["justifyContent"],
        sizingHorizontal: (row.sizing_horizontal ?? "fixed") as IrNode["layout"]["sizingHorizontal"],
        sizingVertical: (row.sizing_vertical ?? "hug") as IrNode["layout"]["sizingVertical"],
      },
      style: {
        backgroundColor: row.background_color ?? undefined,
        borderColor: row.border_color ?? undefined,
        borderWidth: row.border_width === null ? undefined : Number(row.border_width),
        borderRadius: row.border_radius === null ? undefined : Number(row.border_radius),
        effects: fromJson<IrNode["style"]["effects"]>(row.effects, []),
      },
      typography: row.font_size
        ? {
            fontFamily: row.font_family ?? "Inter",
            fontSize: Number(row.font_size),
            fontWeight: row.font_weight ?? 400,
            lineHeight: Number(row.line_height ?? 0),
            letterSpacing: Number(row.letter_spacing ?? 0),
            color: row.text_color ?? "#000000",
          }
        : undefined,
      textContent: row.text_content ?? undefined,
      constraints: fromJson<IrNode["constraints"]>(row.constraints, undefined),
      responsiveHints: fromJson<IrNode["responsiveHints"]>(row.responsive_hints, undefined),
      interactions: fromJson<IrNode["interactions"]>(row.interactions, []),
      confidence: row.confidence === null ? undefined : Number(row.confidence),
      semanticRole: row.semantic_role ?? undefined,
    };
  }

  // Root nodes are the ones with no parent, one per frame.
  const rootByFrame = new Map<string, string>();
  for (const row of nodeRows) {
    if (!row.parent_id && row.figma_frame_id) rootByFrame.set(row.figma_frame_id, row.id);
  }

  return {
    projectId,
    sourceFileKey: file.figma_file_key,
    name: file.name,
    version: file.version ?? "",
    frames: frameRows
      .filter((frame) => rootByFrame.has(frame.id))
      .map((frame) => ({
        id: frame.id,
        name: frame.name,
        width: Number(frame.width),
        height: Number(frame.height),
        breakpoint: frame.breakpoint ?? undefined,
        rootNodeId: rootByFrame.get(frame.id) as string,
      })),
    nodes,
    tokens: (tokensResult.data ?? []).map((token) => ({
      name: token.name,
      category: token.category,
      value: token.value,
      source: token.source,
      usageCount: token.usage_count,
    })),
    components: [],
    assets: [],
  };
}
