import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { FigmaClient } from "@/lib/figma/client";
import { resolveFigmaToken } from "@/lib/figma/credentials";
import { assetPath } from "@/lib/storage/signed-urls";
import { currentDesign } from "@/lib/repositories/current-design";
import type { ImagePart } from "@/lib/ai/types";
import { prepareDesignImage, TILE_WIDTH } from "./image-tiles";

/**
 * What the design actually looks like, for the model to see.
 *
 * Until this existed, code generation never saw the design. Each step was
 * given the architecture, the component list and the design *tokens* — the
 * palette, the type scale, the spacing values — and nothing else: no layout,
 * no copy, no picture. So "build this page exactly like the design" was being
 * asked of a model that had been handed a list of colours, and the output
 * matched the design about as well as that allows.
 *
 * `figma_frames.reference_image_path` was in the schema for exactly this and
 * nothing ever wrote it. This fills it, from whichever source the import had:
 *
 * - an uploaded screenshot is already in storage — its path is recorded in the
 *   imported file's key as `image:<path>`;
 * - a Figma frame is rendered through Figma's images endpoint on first use,
 *   stored, and read from storage afterwards.
 *
 * Resolved lazily at generation time rather than during import, so projects
 * imported before this existed work without being imported again.
 */
const BUCKET = "project-assets";
/** Desktop first; a tablet and a mobile frame after it if there is budget. */
const MAX_FRAMES = 3;
/** Across all frames. Cached after the first step, but not free on the first. */
const MAX_IMAGES = 8;
/** The widest frame is the one the code is mostly built from. */
const PRIMARY_TILES = 6;

export interface ReferenceImages {
  parts: ImagePart[];
  /** One entry per frame considered, for the UI to report honestly. */
  frames: { name: string; width: number; images: number; source: "upload" | "figma" | "none" }[];
  /** Everything the model is not being shown, and why. */
  gaps: string[];
}

/** Sniffed from the bytes: a stored object's content type is not always set. */
function mediaTypeOf(bytes: Buffer): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "application/octet-stream";
}

type Frame = { id: string; name: string; width: number; figma_node_id: string; reference_image_path: string | null };

/**
 * Renders a Figma frame and stores it, returning the stored path.
 *
 * Rendered near the width the tiles are cut at, rather than at Figma's default
 * 2x: a 2880-pixel render is four times the download and is narrowed straight
 * back down before anything reads it.
 */
async function renderFigmaFrame(
  client: FigmaClient,
  fileKey: string,
  projectId: string,
  frame: Frame,
): Promise<string> {
  const scale = Math.min(2, Math.max(0.1, TILE_WIDTH / Math.max(1, Number(frame.width))));
  const rendered = await client.getImages(fileKey, [frame.figma_node_id], {
    format: "png",
    scale: Math.round(scale * 100) / 100,
  });

  const url = rendered.images?.[frame.figma_node_id];
  if (rendered.err || !url) throw new Error(rendered.err ?? "Figma returned no image for this frame");

  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Figma's render could not be downloaded (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());

  const path = assetPath(projectId, "references", `${frame.id}.png`);
  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`The render could not be stored: ${error.message}`);

  await supabase.from("figma_frames").update({ reference_image_path: path }).eq("id", frame.id);
  return path;
}

export async function loadReferenceImages(input: {
  organizationId: string;
  projectId: string;
}): Promise<ReferenceImages> {
  const { organizationId, projectId } = input;
  const supabase = createServiceClient();
  const result: ReferenceImages = { parts: [], frames: [], gaps: [] };

  // The latest import only. Frames from a file this project was imported from
  // before are still in the table, and are often wider.
  const design = await currentDesign(supabase, projectId);
  const file = design ? { figma_file_key: design.fileKey } : null;

  if (!design || !file) {
    result.gaps.push("No design has been imported, so there is nothing to show the model.");
    return result;
  }

  const { data: frameRows } = await supabase
    .from("figma_frames")
    .select("id, name, width, figma_node_id, reference_image_path")
    .in("figma_page_id", design.pageIds)
    .order("width", { ascending: false })
    .limit(MAX_FRAMES)
    .overrideTypes<Frame[]>();

  const frames = frameRows ?? [];
  const fromUpload = file.figma_file_key.startsWith("image:");

  // Only created when a Figma frame actually needs rendering.
  let figma: FigmaClient | null | undefined;

  let budget = MAX_IMAGES;

  for (const [index, frame] of frames.entries()) {
    const label = `"${frame.name}"`;
    let path = frame.reference_image_path;
    let source: "upload" | "figma" | "none" = fromUpload ? "upload" : "figma";

    try {
      if (!path && fromUpload) {
        // The upload itself is the reference. Recorded so the next read is direct.
        path = file.figma_file_key.slice("image:".length);
        await supabase.from("figma_frames").update({ reference_image_path: path }).eq("id", frame.id);
      }

      if (!path && !fromUpload) {
        if (figma === undefined) {
          const credential = await resolveFigmaToken(organizationId);
          figma = credential ? new FigmaClient(credential) : null;
        }
        if (!figma) {
          result.gaps.push(`${label}: Figma is not connected, so the frame could not be rendered.`);
          result.frames.push({ name: frame.name, width: frame.width, images: 0, source: "none" });
          continue;
        }
        path = await renderFigmaFrame(figma, file.figma_file_key, projectId, frame);
      }

      if (!path) {
        result.frames.push({ name: frame.name, width: frame.width, images: 0, source: "none" });
        continue;
      }

      const { data: blob, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !blob) throw new Error(error?.message ?? "the stored image could not be read");

      const bytes = Buffer.from(await blob.arrayBuffer());
      // The primary frame gets most of the budget; later ones a couple each.
      const allowance = index === 0 ? Math.min(PRIMARY_TILES, budget) : Math.min(2, budget);
      const prepared = prepareDesignImage(bytes, mediaTypeOf(bytes), allowance, label);

      for (const image of prepared.images) {
        result.parts.push({ type: "image", mediaType: image.mediaType, data: image.data });
      }
      budget -= prepared.images.length;
      result.gaps.push(...prepared.gaps);
      result.frames.push({ name: frame.name, width: frame.width, images: prepared.images.length, source });
    } catch (error) {
      // Best-effort per frame. A generation with two of three reference images
      // is far better than one refused because the third would not render.
      console.error("[reference-images]", frame.id, error);
      result.gaps.push(`${label}: ${error instanceof Error ? error.message : "could not be loaded"}.`);
      result.frames.push({ name: frame.name, width: frame.width, images: 0, source: "none" });
    }
  }

  return result;
}

/** One line for a status message. */
export function describeReferences(references: ReferenceImages): string {
  const shown = references.frames.filter((frame) => frame.images > 0);
  if (shown.length === 0) return "no design image available — building from the layer structure alone";

  const images = references.parts.length;
  return `${images} design ${images === 1 ? "image" : "images"} from ${shown.map((frame) => frame.name).join(", ")}`;
}
