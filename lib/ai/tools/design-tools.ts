import "server-only";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { registerTool } from "./registry";
import type { ToolContext } from "./types";

/**
 * Read-only tools over the Design IR.
 *
 * All are scoped to `context.projectId` rather than taking a project argument:
 * a model cannot ask for another tenant's design because it has no way to name
 * one. Cross-tenant safety does not depend on the model behaving.
 */
const getFrameInput = z.object({
  frameId: z.string().min(1).describe("Frame id from the design summary."),
});

const getNodesInput = z.object({
  role: z.string().min(1).optional().describe("Filter by semantic role, e.g. 'hero'."),
  limit: z.number().int().min(1).max(200).default(50),
});

const jsonSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

registerTool({
  name: "get_design_tokens",
  description: "The design tokens extracted from this project: colours, typography, spacing, radius, shadows.",
  mode: "read",
  schema: z.object({}),
  jsonSchema: jsonSchema({}),
  async execute(context: ToolContext) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("design_tokens")
      .select("category, name, value, usage_count")
      .eq("project_id", context.projectId)
      .order("usage_count", { ascending: false });
    return data ?? [];
  },
  summarise: (_input, output) => `${(output as unknown[]).length} tokens`,
});

registerTool({
  name: "get_frame",
  description: "One frame's node tree, with layout, typography and detected semantic roles.",
  mode: "read",
  schema: getFrameInput,
  jsonSchema: jsonSchema(
    { frameId: { type: "string", description: "Frame id from the design summary." } },
    ["frameId"],
  ),
  async execute(context: ToolContext, input: z.infer<typeof getFrameInput>) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("design_nodes")
      .select(
        "source_node_id, parent_id, ir_type, semantic_role, name, depth, order_index, x, y, width, height, " +
          "layout_mode, layout_gap, padding_top, padding_right, padding_bottom, padding_left, " +
          "font_size, font_weight, text_content, background_color, border_radius, confidence",
      )
      .eq("project_id", context.projectId)
      .eq("figma_frame_id", input.frameId)
      .order("depth", { ascending: true })
      .limit(600);
    return data ?? [];
  },
  summarise: (input, output) => `frame ${input.frameId}: ${(output as unknown[]).length} nodes`,
});

registerTool({
  name: "find_nodes",
  description: "Find design nodes by semantic role, most confident first.",
  mode: "read",
  schema: getNodesInput,
  jsonSchema: jsonSchema({
    role: { type: "string", description: "Semantic role, e.g. 'hero' or 'button'." },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  }),
  async execute(context: ToolContext, input: z.infer<typeof getNodesInput>) {
    const supabase = createServiceClient();
    let query = supabase
      .from("design_nodes")
      .select("source_node_id, name, semantic_role, confidence, width, height, depth")
      .eq("project_id", context.projectId);

    if (input.role) query = query.eq("semantic_role", input.role);

    const { data } = await query.order("confidence", { ascending: false }).limit(input.limit);
    return data ?? [];
  },
  summarise: (input, output) =>
    `${(output as unknown[]).length} nodes${input.role ? ` with role ${input.role}` : ""}`,
});
