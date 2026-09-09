import { z } from "zod";

/**
 * Agent output schemas.
 *
 * Each one is both the Zod validator and the JSON Schema handed to the model,
 * so the contract cannot drift between what we ask for and what we accept.
 */

export const designAnalysisSchema = z.object({
  summary: z.string().min(1).max(600),
  pageKind: z.enum(["marketing", "application", "documentation", "commerce", "other"]),
  sections: z
    .array(
      z.object({
        nodeId: z.string(),
        role: z.string().min(1).max(40),
        confidence: z.number().min(0).max(100),
        rationale: z.string().max(240),
      }),
    )
    .max(60),
  corrections: z
    .array(
      z.object({
        nodeId: z.string(),
        role: z.string().min(1).max(40),
        confidence: z.number().min(0).max(100),
        reason: z.string().max(240),
      }),
    )
    .max(40),
  concerns: z.array(z.string().max(240)).max(10),
});

export type DesignAnalysis = z.infer<typeof designAnalysisSchema>;

export const componentPlanSchema = z.object({
  components: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "Must be a PascalCase component name."),
        role: z.string().max(40),
        nodeIds: z.array(z.string()).min(1),
        props: z.array(
          z.object({
            name: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
            type: z.string().max(60),
            required: z.boolean(),
          }),
        ).max(12),
        variants: z.array(z.string().max(30)).max(10),
        reuseOf: z.string().nullable(),
      }),
    )
    .max(40),
  notes: z.array(z.string().max(240)).max(10),
});

export type ComponentPlan = z.infer<typeof componentPlanSchema>;

/**
 * Hand-written JSON Schemas.
 *
 * Generated from the Zod schemas would be neater, but every generator emits
 * constructs (anyOf for optionals, $ref chains) that tool-use schemas handle
 * inconsistently. Writing them out keeps the model's contract simple and is
 * checked against the Zod schema by tests.
 */
export const DESIGN_ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["summary", "pageKind", "sections", "corrections", "concerns"],
  properties: {
    summary: { type: "string", description: "What this design is, in two or three sentences." },
    pageKind: { type: "string", enum: ["marketing", "application", "documentation", "commerce", "other"] },
    sections: {
      type: "array",
      description: "Top-level sections in document order.",
      items: {
        type: "object",
        required: ["nodeId", "role", "confidence", "rationale"],
        properties: {
          nodeId: { type: "string", description: "The #id exactly as given in the node list." },
          role: { type: "string", description: "navbar, hero, feature_grid, pricing_section, footer, …" },
          confidence: { type: "number" },
          rationale: { type: "string" },
        },
      },
    },
    corrections: {
      type: "array",
      description: "Only nodes whose detected role is wrong. Omit anything you agree with.",
      items: {
        type: "object",
        required: ["nodeId", "role", "confidence", "reason"],
        properties: {
          nodeId: { type: "string" },
          role: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    concerns: {
      type: "array",
      description: "Things that will make code generation unreliable.",
      items: { type: "string" },
    },
  },
};

export const COMPONENT_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["components", "notes"],
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "role", "nodeIds", "props", "variants", "reuseOf"],
        properties: {
          name: { type: "string", description: "PascalCase component name." },
          role: { type: "string" },
          nodeIds: { type: "array", items: { type: "string" } },
          props: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "type", "required"],
              properties: {
                name: { type: "string" },
                type: { type: "string", description: "TypeScript type, e.g. string, number, ReactNode." },
                required: { type: "boolean" },
              },
            },
          },
          variants: { type: "array", items: { type: "string" } },
          reuseOf: { type: ["string", "null"], description: "Existing component to reuse, or null." },
        },
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
};
