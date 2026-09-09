import { z } from "zod";

/**
 * Code generation output.
 *
 * The content bound is high because a step can legitimately be several complete
 * files, but it is bounded: an unbounded field invites a model to stream until
 * it is cut off, and a truncated file always fails to compile.
 */
const generatedFileSchema = z.object({
  path: z.string().min(1).max(300),
  content: z.string().min(1).max(200_000),
  purpose: z.string().max(200).optional(),
});

export const codeStepSchema = z.object({
  files: z.array(generatedFileSchema).max(40),
  deletions: z.array(z.string().min(1).max(300)).max(20).default([]),
  notes: z.string().max(1000).optional(),
});

export type CodeStep = z.infer<typeof codeStepSchema>;

export const CODE_STEP_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["files"],
  additionalProperties: false,
  properties: {
    files: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        required: ["path", "content"],
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Relative to the project root." },
          content: { type: "string", description: "Complete file content. Never abbreviated." },
          purpose: { type: "string" },
        },
      },
    },
    deletions: { type: "array", items: { type: "string" }, maxItems: 20 },
    notes: { type: "string" },
  },
};
