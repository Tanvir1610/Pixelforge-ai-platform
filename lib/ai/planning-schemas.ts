import { z } from "zod";

/**
 * Planning schemas.
 *
 * Every planner returns structured output validated against these. The model
 * is never trusted to produce well-formed plans — `structuredCall` feeds
 * validation issues back and retries.
 */
const routeSchema = z.object({
  path: z.string().min(1).max(200).describe("Route path, e.g. / or /pricing."),
  file: z.string().min(1).max(300).describe("File that implements it."),
  frameId: z.string().max(120).optional().describe("Design frame this route comes from."),
  title: z.string().max(200),
});

const directorySchema = z.object({
  path: z.string().min(1).max(300),
  purpose: z.string().min(1).max(300),
});

export const architecturePlanSchema = z.object({
  framework: z.enum(["nextjs", "react", "vue", "html"]),
  styling: z.enum(["tailwind", "css_modules", "vanilla_css"]),
  typescript: z.boolean(),
  routes: z.array(routeSchema).min(1).max(40),
  directories: z.array(directorySchema).max(30),
  tokenStrategy: z
    .enum(["tailwind_theme", "css_variables", "both"])
    .describe("How extracted design tokens reach the code."),
  /** Ordered: the generator writes files in this sequence (§17). */
  buildOrder: z.array(z.string().min(1).max(120)).min(1).max(20),
  notes: z.string().max(1200).optional(),
});

export type ArchitecturePlan = z.infer<typeof architecturePlanSchema>;

const propSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.string().min(1).max(120),
  required: z.boolean(),
  description: z.string().max(200).optional(),
});

const componentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Z][A-Za-z0-9]*$/, "Component names must be PascalCase."),
  file: z.string().min(1).max(300),
  semanticRole: z.string().max(60).optional(),
  /** Design node ids this component was derived from, for traceability. */
  sourceNodeIds: z.array(z.string().max(120)).max(50).default([]),
  props: z.array(propSchema).max(20).default([]),
  variants: z.array(z.string().max(60)).max(20).default([]),
  states: z.array(z.string().max(40)).max(12).default([]),
  instanceCount: z.number().int().min(1).max(1000).default(1),
  reason: z.string().max(300).describe("Why this is a component rather than inline markup."),
});

export const componentPlanSchema = z.object({
  components: z.array(componentSchema).min(1).max(60),
  /** Repeated markup the planner decided NOT to extract, and why. */
  inlined: z
    .array(z.object({ description: z.string().max(200), reason: z.string().max(300) }))
    .max(20)
    .default([]),
});

export type ComponentPlan = z.infer<typeof componentPlanSchema>;
export type PlannedComponent = z.infer<typeof componentSchema>;

/** Hand-written JSON Schema: the provider needs it before Zod ever runs. */
export const ARCHITECTURE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["framework", "styling", "typescript", "routes", "tokenStrategy", "buildOrder"],
  additionalProperties: false,
  properties: {
    framework: { type: "string", enum: ["nextjs", "react", "vue", "html"] },
    styling: { type: "string", enum: ["tailwind", "css_modules", "vanilla_css"] },
    typescript: { type: "boolean" },
    routes: {
      type: "array", minItems: 1, maxItems: 40,
      items: {
        type: "object",
        required: ["path", "file", "title"],
        additionalProperties: false,
        properties: {
          path: { type: "string" }, file: { type: "string" },
          frameId: { type: "string" }, title: { type: "string" },
        },
      },
    },
    directories: {
      type: "array", maxItems: 30,
      items: {
        type: "object",
        required: ["path", "purpose"],
        additionalProperties: false,
        properties: { path: { type: "string" }, purpose: { type: "string" } },
      },
    },
    tokenStrategy: { type: "string", enum: ["tailwind_theme", "css_variables", "both"] },
    buildOrder: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
    notes: { type: "string" },
  },
};

export const COMPONENT_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["components"],
  additionalProperties: false,
  properties: {
    components: {
      type: "array", minItems: 1, maxItems: 60,
      items: {
        type: "object",
        required: ["name", "file", "reason"],
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "PascalCase." },
          file: { type: "string" },
          semanticRole: { type: "string" },
          sourceNodeIds: { type: "array", items: { type: "string" }, maxItems: 50 },
          props: {
            type: "array", maxItems: 20,
            items: {
              type: "object",
              required: ["name", "type", "required"],
              additionalProperties: false,
              properties: {
                name: { type: "string" }, type: { type: "string" },
                required: { type: "boolean" }, description: { type: "string" },
              },
            },
          },
          variants: { type: "array", items: { type: "string" }, maxItems: 20 },
          states: { type: "array", items: { type: "string" }, maxItems: 12 },
          instanceCount: { type: "integer", minimum: 1 },
          reason: { type: "string" },
        },
      },
    },
    inlined: {
      type: "array", maxItems: 20,
      items: {
        type: "object",
        required: ["description", "reason"],
        additionalProperties: false,
        properties: { description: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};
