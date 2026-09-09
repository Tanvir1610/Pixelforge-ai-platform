import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import type { DesignDocument, IrNode } from "@/lib/design-ir/types";

/**
 * IR sub-objects are structurally JSON but TypeScript will not infer that
 * through an interface. This asserts the shape at the single point where the IR
 * crosses into the database, rather than weakening the IR types themselves.
 */
function asJson(value: unknown): Json {
  return value as Json;
}

/**
 * Persists a Design IR document.
 *
 * Runs as the service role because it is called from the ingestion worker,
 * which has already authorised the project. It never takes an organization id
 * from a caller — the project row is the anchor.
 *
 * Nodes are written parent-before-child so the self-referencing foreign key is
 * always satisfied, and in chunks because a real marketing file is thousands of
 * rows and a single insert would exceed the request limit.
 */
const CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Groups nodes by depth so parents are always inserted first. */
function byDepth(nodes: IrNode[]): IrNode[][] {
  const levels = new Map<number, IrNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.depth) ?? [];
    level.push(node);
    levels.set(node.depth, level);
  }
  return [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([, level]) => level);
}

export interface PersistResult {
  figmaFileId: string;
  frameIds: Record<string, string>;
  nodesWritten: number;
  tokensWritten: number;
}

export async function persistDesignDocument(
  document: DesignDocument,
  options: { sourceUrl?: string; rawPayloadPath?: string },
): Promise<PersistResult> {
  const supabase = createServiceClient();
  const { projectId } = document;

  // Re-importing the same file replaces its design rows. The cascade on
  // figma_files removes frames; design_nodes are cleared explicitly because
  // they hang off the project, not the file.
  const { data: file, error: fileError } = await supabase
    .from("figma_files")
    .upsert(
      {
        project_id: projectId,
        figma_file_key: document.sourceFileKey,
        name: document.name,
        version: document.version,
        source_url: options.sourceUrl ?? null,
        raw_payload_path: options.rawPayloadPath ?? null,
        last_imported_at: new Date().toISOString(),
      },
      { onConflict: "project_id,figma_file_key" },
    )
    .select("id")
    .single();

  if (fileError || !file) throw new Error(`Could not record the Figma file: ${fileError?.message}`);

  await supabase.from("design_nodes").delete().eq("project_id", projectId);
  await supabase.from("design_tokens").delete().eq("project_id", projectId);

  // Every frame belongs to a page row; the IR flattens pages away, so one
  // synthetic page carries them.
  const { data: page, error: pageError } = await supabase
    .from("figma_pages")
    .upsert(
      { figma_file_id: file.id, figma_node_id: "canvas", name: "Imported", order_index: 0 },
      { onConflict: "figma_file_id,figma_node_id" },
    )
    .select("id")
    .single();

  if (pageError || !page) throw new Error(`Could not record the page: ${pageError?.message}`);

  const frameIds: Record<string, string> = {};
  for (const frame of document.frames) {
    const { data, error } = await supabase
      .from("figma_frames")
      .upsert(
        {
          figma_page_id: page.id,
          project_id: projectId,
          figma_node_id: frame.id,
          name: frame.name,
          width: frame.width,
          height: frame.height,
          breakpoint: frame.breakpoint ?? null,
          is_selected: true,
        },
        { onConflict: "figma_page_id,figma_node_id" },
      )
      .select("id")
      .single();

    if (error || !data) throw new Error(`Could not record frame "${frame.name}": ${error?.message}`);
    frameIds[frame.id] = data.id;
  }

  // Source ids are not database ids, so the mapping is built as we insert and
  // used to resolve each node's parent.
  const idMap = new Map<string, string>();
  const frameOfNode = new Map<string, string>();
  for (const frame of document.frames) {
    const stack = [frame.rootNodeId];
    while (stack.length) {
      const id = stack.pop();
      if (!id) continue;
      frameOfNode.set(id, frameIds[frame.id]);
      const node = document.nodes[id];
      if (node) stack.push(...node.childIds);
    }
  }

  let nodesWritten = 0;
  for (const level of byDepth(Object.values(document.nodes))) {
    for (const batch of chunk(level, CHUNK)) {
      const rows = batch.map((node) => ({
        project_id: projectId,
        figma_frame_id: frameOfNode.get(node.id) ?? null,
        parent_id: node.parentId ? (idMap.get(node.parentId) ?? null) : null,
        source_node_id: node.id,
        ir_type: node.type,
        semantic_role: node.semanticRole ?? null,
        name: node.name,
        order_index: node.orderIndex,
        depth: node.depth,
        x: node.box.x, y: node.box.y, width: node.box.width, height: node.box.height,
        layout_mode: node.layout.mode,
        layout_gap: node.layout.gap,
        padding_top: node.layout.padding.top,
        padding_right: node.layout.padding.right,
        padding_bottom: node.layout.padding.bottom,
        padding_left: node.layout.padding.left,
        align_items: node.layout.alignItems ?? null,
        justify_content: node.layout.justifyContent ?? null,
        sizing_horizontal: node.layout.sizingHorizontal,
        sizing_vertical: node.layout.sizingVertical,
        background_color: node.style.backgroundColor ?? null,
        border_color: node.style.borderColor ?? null,
        border_width: node.style.borderWidth ?? null,
        border_radius: node.style.borderRadius ?? null,
        font_family: node.typography?.fontFamily ?? null,
        font_size: node.typography?.fontSize ?? null,
        font_weight: node.typography?.fontWeight ?? null,
        line_height: node.typography?.lineHeight ?? null,
        letter_spacing: node.typography?.letterSpacing ?? null,
        text_color: node.typography?.color ?? null,
        text_content: node.textContent ?? null,
        effects: asJson(node.style.effects),
        constraints: asJson(node.constraints ?? {}),
        responsive_hints: asJson(node.responsiveHints ?? {}),
        interactions: asJson(node.interactions),
        confidence: node.confidence ?? null,
      }));

      const { data, error } = await supabase
        .from("design_nodes")
        .insert(rows)
        .select("id, source_node_id");

      if (error) throw new Error(`Could not write design nodes: ${error.message}`);
      for (const row of data ?? []) {
        if (row.source_node_id) idMap.set(row.source_node_id, row.id);
      }
      nodesWritten += rows.length;
    }
  }

  let tokensWritten = 0;
  if (document.tokens.length) {
    const { error } = await supabase.from("design_tokens").insert(
      document.tokens.map((token) => ({
        project_id: projectId,
        category: token.category,
        name: token.name,
        value: asJson(token.value),
        source: token.source,
        usage_count: token.usageCount,
      })),
    );
    if (error) throw new Error(`Could not write design tokens: ${error.message}`);
    tokensWritten = document.tokens.length;
  }

  return { figmaFileId: file.id, frameIds, nodesWritten, tokensWritten };
}
