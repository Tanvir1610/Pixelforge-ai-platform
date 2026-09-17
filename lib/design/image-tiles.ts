import { PNG } from "pngjs";

/**
 * Preparing a design image for a model to read.
 *
 * A landing page is a tall image — 1440 wide and 6000 or more high is ordinary.
 * Sent whole, it is scaled down to fit the model's image limit along its long
 * edge, which leaves a page a few hundred pixels wide: every heading still
 * visible, every line of body copy, every spacing value unreadable. That is
 * the detail "build it exactly like the design" depends on.
 *
 * So the page is narrowed to a readable width once, then cut into near-square
 * slices from top to bottom. Each slice is read at full resolution, and in
 * order they are the whole page.
 *
 * Pure and deterministic: the same PNG always produces byte-identical tiles,
 * which is what lets a generation's later steps read them from the prompt cache
 * instead of paying for them again.
 */
export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

/** Wide enough for body copy to stay legible, small enough to stay cheap. */
export const TILE_WIDTH = 1200;
/** Slightly taller than wide, so a typical section lands in one tile. */
export const TILE_HEIGHT = 1400;
/**
 * A slice below this height is merged into the one above rather than sent on
 * its own: a 40-pixel strip costs an image and shows nothing.
 */
const MIN_TAIL = 200;

export function decode(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function encode(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  // Fixed options, so identical pixels always encode to identical bytes.
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

/**
 * Narrows an image to `maxWidth`, keeping its aspect ratio.
 *
 * Area-averaging rather than nearest-neighbour: nearest-neighbour at these
 * ratios drops whole strokes of small text, which is the detail being kept.
 * An image already narrow enough is returned unchanged.
 */
export function downscale(image: RgbaImage, maxWidth: number): RgbaImage {
  if (image.width <= maxWidth) return image;

  const scale = image.width / maxWidth;
  const width = maxWidth;
  const height = Math.max(1, Math.round(image.height / scale));
  const out = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceTop = Math.floor(y * scale);
    const sourceBottom = Math.min(image.height, Math.max(sourceTop + 1, Math.floor((y + 1) * scale)));

    for (let x = 0; x < width; x += 1) {
      const sourceLeft = Math.floor(x * scale);
      const sourceRight = Math.min(image.width, Math.max(sourceLeft + 1, Math.floor((x + 1) * scale)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = sourceTop; sy < sourceBottom; sy += 1) {
        for (let sx = sourceLeft; sx < sourceRight; sx += 1) {
          const offset = (sy * image.width + sx) * 4;
          r += image.data[offset];
          g += image.data[offset + 1];
          b += image.data[offset + 2];
          a += image.data[offset + 3];
          count += 1;
        }
      }

      const target = (y * width + x) * 4;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
      out[target + 3] = Math.round(a / count);
    }
  }

  return { width, height, data: out };
}

/** Copies rows [top, bottom) into a new image. */
function crop(image: RgbaImage, top: number, bottom: number): RgbaImage {
  const height = bottom - top;
  const data = Buffer.alloc(image.width * height * 4);
  image.data.copy(data, 0, top * image.width * 4, bottom * image.width * 4);
  return { width: image.width, height, data };
}

/**
 * Cuts an image into horizontal slices, top to bottom.
 *
 * `maxTiles` bounds cost. When a page is taller than that many tiles allow,
 * the remainder is dropped and `truncated` says so — reported rather than
 * silently squeezed, because a generator told "this is the page" when it is
 * the top two thirds of one will leave the bottom third out and nobody will
 * know why.
 */
export function tile(
  image: RgbaImage,
  maxTiles: number,
  tileHeight = TILE_HEIGHT,
): { tiles: RgbaImage[]; truncated: boolean; coveredHeight: number } {
  const tiles: RgbaImage[] = [];
  let top = 0;

  while (top < image.height && tiles.length < maxTiles) {
    let bottom = Math.min(image.height, top + tileHeight);
    // Fold a thin tail into this slice instead of spending an image on it.
    if (image.height - bottom < MIN_TAIL) bottom = image.height;
    tiles.push(crop(image, top, bottom));
    top = bottom;
  }

  return { tiles, truncated: top < image.height, coveredHeight: top };
}

export interface PreparedImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64. */
  data: string;
}

/**
 * Past this a single image is rejected by the API. Base64 inflates by a third,
 * so the raw limit sits below 5 MB with room to spare.
 */
const MAX_IMAGE_BYTES = 3_700_000;

export interface PrepareResult {
  images: PreparedImage[];
  /** What the model is not being shown, in words a user can act on. */
  gaps: string[];
}

/**
 * A design image, ready to send.
 *
 * PNGs are narrowed and sliced. JPEG and WebP are passed through whole: there
 * is no decoder for them here, and sending one downscaled image is still far
 * better than sending none — but it is reported, because a tall JPEG loses the
 * small print this whole module exists to keep.
 */
export function prepareDesignImage(
  bytes: Buffer,
  mediaType: string,
  maxTiles: number,
  label: string,
): PrepareResult {
  if (maxTiles <= 0) return { images: [], gaps: [`${label}: skipped, image budget used up`] };

  if (mediaType === "image/png") {
    const narrowed = downscale(decode(bytes), TILE_WIDTH);
    const { tiles, truncated, coveredHeight } = tile(narrowed, maxTiles);

    const images: PreparedImage[] = [];
    const gaps: string[] = [];

    for (const slice of tiles) {
      const encoded = encode(slice);
      if (encoded.byteLength > MAX_IMAGE_BYTES) {
        gaps.push(`${label}: one slice was too large to send`);
        continue;
      }
      images.push({ mediaType: "image/png", data: encoded.toString("base64") });
    }

    if (truncated) {
      const percent = Math.round((coveredHeight / narrowed.height) * 100);
      gaps.push(`${label}: only the top ${percent}% of the page fits in the image budget`);
    }

    return { images, gaps };
  }

  if (mediaType === "image/jpeg" || mediaType === "image/webp") {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { images: [], gaps: [`${label}: the image is too large to send — upload a PNG under 3.7 MB`] };
    }
    return {
      images: [{ mediaType, data: bytes.toString("base64") }],
      gaps: [`${label}: sent as one ${mediaType === "image/jpeg" ? "JPEG" : "WebP"}, so fine text on a tall page may be unreadable — a PNG is sliced and read at full size`],
    };
  }

  return { images: [], gaps: [`${label}: ${mediaType} is not an image format the model reads`] };
}
