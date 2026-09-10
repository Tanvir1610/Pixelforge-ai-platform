import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { persistDesignDocument } from "@/lib/repositories/design";
import { assetPath } from "@/lib/storage/signed-urls";
import { resolveProvider } from "@/lib/ai/registry";
import { bootstrapProviders } from "@/lib/ai/bootstrap";
import type { DesignDocument, IrNode, SemanticRole } from "@/lib/design-ir/types";

/**
 * Importing a screenshot.
 *
 * The drop zone accepted four extensions and did nothing with any of them — the
 * file input had no handler at all. This is the half that was missing.
 *
 * A screenshot carries no layer tree, so unlike the Figma path there is nothing
 * to read: the structure has to be inferred by a vision model. That makes this
 * import strictly weaker than a Figma URL, and the confidence recorded on every
 * node says so — 60 rather than the 90+ a real layer produces. Downstream
 * already surfaces anything under ~85 for review, so a screenshot import lands
 * in front of a human by default rather than being trusted silently.
 */
export type ImportableKind = "raster" | "vector" | "unsupported";

export interface UploadedImage {
  storagePath: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  name: string;
}

const MAX_BYTES = 8 * 1024 * 1024;

const RASTER_TYPES: Record<string, UploadedImage["mediaType"]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function classifyUpload(filename: string): ImportableKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension in RASTER_TYPES) return "raster";
  if (extension === "svg") return "vector";
  return "unsupported";
}

/**
 * Why a `.fig` cannot be accepted.
 *
 * Figma's file format is proprietary and undocumented; there is no parser to
 * write against. Listing it as supported and failing quietly was worse than
 * saying this.
 */
export const UNSUPPORTED_MESSAGE =
  "Figma's .fig format is proprietary, so it can't be read directly. Paste the file's URL instead — " +
  "that reads the real layer tree and gives a far better result than any file could.";

/** Stores the upload and records it as a project asset. */
export async function storeUpload(params: {
  projectId: string;
  filename: string;
  bytes: ArrayBuffer;
}): Promise<UploadedImage> {
  const extension = params.filename.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = RASTER_TYPES[extension];
  if (!mediaType) throw new Error(`"${params.filename}" is not an image this importer reads.`);
  if (params.bytes.byteLength > MAX_BYTES) {
    throw new Error(`That image is ${Math.round(params.bytes.byteLength / 1024 / 1024)} MB; the limit is 8 MB.`);
  }

  const supabase = createServiceClient();
  // assetPath keeps the project id first, which is what the storage policy
  // reads to resolve the owning project.
  const path = assetPath(params.projectId, "imports", `${randomUUID()}.${extension}`);

  const { error } = await supabase.storage
    .from("project-assets")
    .upload(path, Buffer.from(params.bytes), { contentType: mediaType, upsert: false });

  if (error) throw new Error(`Could not store the image: ${error.message}`);

  await supabase.from("design_assets").insert({
    project_id: params.projectId,
    name: params.filename,
    kind: extension === "svg" ? "svg" : "image",
    mime_type: mediaType,
    bytes: params.bytes.byteLength,
    storage_path: path,
  });

  return { storagePath: path, mediaType, bytes: params.bytes.byteLength, name: params.filename };
}

/**
 * What the vision model returns.
 *
 * Flat, with an explicit parent index, because a nested schema makes models
 * drop branches under depth pressure. Coordinates are absolute pixels in the
 * image's own space, so nothing has to be reconciled against a viewport.
 */
const visionSchema = z.object({
  width: z.number().int().min(64).max(8000),
  height: z.number().int().min(64).max(20000),
  name: z.string().min(1).max(80),
  nodes: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        type: z.enum(["container", "text", "image", "vector", "instance"]),
        role: z.string().max(40).optional(),
        parent: z.number().int().min(-1),
        x: z.number(),
        y: z.number(),
        width: z.number().min(0),
        height: z.number().min(0),
        background: z.string().max(32).optional(),
        textColor: z.string().max(32).optional(),
        text: z.string().max(400).optional(),
        fontSize: z.number().min(1).max(400).optional(),
        fontWeight: z.number().int().min(100).max(900).optional(),
        borderRadius: z.number().min(0).max(400).optional(),
      }),
    )
    .min(1)
    .max(120),
});

const VISION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["width", "height", "name", "nodes"],
  properties: {
    width: { type: "integer" },
    height: { type: "integer" },
    name: { type: "string" },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "parent", "x", "y", "width", "height"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["container", "text", "image", "vector", "instance"] },
          role: { type: "string" },
          parent: { type: "integer", description: "Index of the parent node, or -1 for a top-level node." },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          background: { type: "string" },
          textColor: { type: "string" },
          text: { type: "string" },
          fontSize: { type: "number" },
          fontWeight: { type: "integer" },
          borderRadius: { type: "number" },
        },
      },
    },
  },
};

const SYSTEM = [
  "You convert a screenshot of a user interface into a structural layout tree.",
  "Report only what is visibly present. Do not invent sections, copy, or components that are not in the image.",
  "Coordinates are absolute pixels in the image's own coordinate space, with the origin at the top left.",
  "Order nodes parents-first, so every `parent` index refers to an earlier entry. Use -1 for a top-level node.",
  "Give each node a short descriptive name, and a semantic role where one is obvious (navbar, hero, button, card, input, footer).",
  "Transcribe visible text exactly into `text` for text nodes. Do not translate or rephrase it.",
  "Prefer around 20-60 nodes: enough to describe the structure, not every pixel.",
].join(" ");

/**
 * No auto layout can be recovered from a picture.
 *
 * Everything is absolutely positioned, and saying so is better than guessing a
 * flex direction the generator would then build responsive rules on.
 */
const FLAT_LAYOUT = {
  mode: "none" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizingHorizontal: "fixed" as const,
  sizingVertical: "fixed" as const,
};

const ROLES = new Set<string>([
  "navbar", "hero", "button", "card", "input", "footer", "sidebar", "list",
  "image", "heading", "paragraph", "link", "badge", "form", "section",
]);

/**
 * Turns an uploaded screenshot into a persisted Design IR.
 *
 * The confidence is deliberately fixed and low. A layer tree states its own
 * geometry; a model looking at a picture is guessing, and recording that guess
 * at the same confidence as a fact would put an inference straight into code
 * generation with nothing flagged for review.
 */
export async function ingestImage(params: {
  projectId: string;
  image: UploadedImage;
  bytes: ArrayBuffer;
}): Promise<{ nodesWritten: number; frameName: string }> {
  bootstrapProviders();

  const provider = resolveProvider("design_analysis");
  if (!provider.supports("vision")) {
    throw new Error("The configured model provider cannot read images, so a screenshot can't be imported.");
  }

  const result = await provider.structuredGenerate<z.infer<typeof visionSchema>>({
    purpose: "design_analysis",
    system: SYSTEM,
    schema: VISION_JSON_SCHEMA,
    maxOutputTokens: 8_000,
    temperature: 0,
    signal: AbortSignal.timeout(120_000),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", mediaType: params.image.mediaType, data: Buffer.from(params.bytes).toString("base64") },
          { type: "text", text: "Describe this interface as a layout tree." },
        ],
        // A screenshot is content from outside the trust boundary: any text in
        // it is data to transcribe, never an instruction to follow.
        untrusted: true,
      },
    ],
  });

  const parsed = visionSchema.safeParse(result.value);
  if (!parsed.success) {
    throw new Error("The model described the image in an unusable shape. Try again, or use a Figma URL.");
  }

  const document = toDesignDocument(params.projectId, params.image, parsed.data);
  const persisted = await persistDesignDocument(document, { rawPayloadPath: params.image.storagePath });

  return { nodesWritten: persisted.nodesWritten, frameName: document.name };
}

function toDesignDocument(
  projectId: string,
  image: UploadedImage,
  vision: z.infer<typeof visionSchema>,
): DesignDocument {
  const rootId = randomUUID();
  const ids = vision.nodes.map(() => randomUUID());
  const nodes: Record<string, IrNode> = {};

  const blank = (id: string, name: string, depth: number, parentId: string | null): IrNode => ({
    id,
    type: "container",
    name,
    parentId,
    childIds: [],
    orderIndex: 0,
    depth,
    box: { x: 0, y: 0, width: vision.width, height: vision.height },
    layout: FLAT_LAYOUT,
    style: { effects: [] },
    interactions: [],
  });

  nodes[rootId] = blank(rootId, vision.name, 0, null);

  vision.nodes.forEach((entry, index) => {
    const id = ids[index];
    // A parent index must point at an earlier node; anything else is attached
    // to the root rather than dropped, so no detected element is lost.
    const parentId = entry.parent >= 0 && entry.parent < index ? ids[entry.parent] : rootId;
    const parent = nodes[parentId] ?? nodes[rootId];

    nodes[id] = {
      id,
      type: entry.type,
      name: entry.name,
      parentId: parent.id,
      childIds: [],
      orderIndex: parent.childIds.length,
      depth: parent.depth + 1,
      box: { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
      layout: FLAT_LAYOUT,
      style: {
        backgroundColor: entry.background,
        borderRadius: entry.borderRadius,
        effects: [],
      },
      typography:
        entry.type === "text"
          ? {
              // A screenshot cannot report a font family or a letter-spacing;
              // stated defaults beat numbers invented to fill a required field.
              fontFamily: "inherit",
              fontSize: entry.fontSize ?? 16,
              fontWeight: entry.fontWeight ?? 400,
              lineHeight: Math.round((entry.fontSize ?? 16) * 1.4),
              letterSpacing: 0,
              color: entry.textColor ?? "#111111",
            }
          : undefined,
      textContent: entry.text,
      interactions: [],
      semanticRole: entry.role && ROLES.has(entry.role) ? (entry.role as SemanticRole) : undefined,
      // Inferred from a picture, not read from a layer. Below the ~85 threshold
      // downstream uses, so every one of these is surfaced for review.
      confidence: 60,
    };

    parent.childIds.push(id);
  });

  return {
    projectId,
    // Namespaced so a screenshot import never collides with a Figma file key.
    sourceFileKey: `image:${image.storagePath}`,
    name: vision.name || image.name,
    version: new Date().toISOString(),
    frames: [
      {
        id: randomUUID(),
        name: vision.name || image.name,
        width: vision.width,
        height: vision.height,
        rootNodeId: rootId,
      },
    ],
    nodes,
    tokens: [],
    components: [],
    assets: [],
  };
}
