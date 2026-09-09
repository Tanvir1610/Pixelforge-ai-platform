import { PNG } from "pngjs";
import type { Rect } from "./types";

/**
 * Pixel comparison.
 *
 * Catches what geometry cannot see: wrong colours, missing images, bad font
 * rendering. It reports *where* the render differs, not *what* is wrong — the
 * DOM comparison supplies the "what".
 */
export interface PixelDiffOptions {
  /**
   * Per-channel difference below which two pixels are considered equal.
   *
   * Not zero: antialiasing and subpixel text rendering differ between the
   * Figma renderer and a browser, and a zero threshold reports every glyph
   * edge as a difference.
   */
  threshold?: number;
  /** Ignore differences where both pixels are nearly transparent. */
  ignoreAlphaBelow?: number;
}

export interface PixelDiffResult {
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  /** 0–1. The headline number the similarity score is derived from. */
  delta: number;
  /** Per-pixel mask, 1 where the images differ. Feeds region clustering. */
  mask: Uint8Array;
}

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

export function decodePng(buffer: Buffer): DecodedImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function encodePng(image: DecodedImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

/**
 * Compares two images.
 *
 * Differing dimensions are compared over their overlap rather than refused: a
 * page one pixel taller than the reference is an ordinary outcome, and refusing
 * to compare would lose the signal entirely. The size difference itself is
 * reported separately by the DOM comparison.
 */
export function diffImages(
  reference: DecodedImage,
  actual: DecodedImage,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  const threshold = options.threshold ?? 12;
  const ignoreAlphaBelow = options.ignoreAlphaBelow ?? 8;

  const width = Math.min(reference.width, actual.width);
  const height = Math.min(reference.height, actual.height);
  const totalPixels = width * height;

  const mask = new Uint8Array(totalPixels);
  let differingPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const refIndex = (y * reference.width + x) * 4;
      const actIndex = (y * actual.width + x) * 4;

      const refAlpha = reference.data[refIndex + 3];
      const actAlpha = actual.data[actIndex + 3];
      if (refAlpha < ignoreAlphaBelow && actAlpha < ignoreAlphaBelow) continue;

      const dr = Math.abs(reference.data[refIndex] - actual.data[actIndex]);
      const dg = Math.abs(reference.data[refIndex + 1] - actual.data[actIndex + 1]);
      const db = Math.abs(reference.data[refIndex + 2] - actual.data[actIndex + 2]);
      const da = Math.abs(refAlpha - actAlpha);

      if (dr > threshold || dg > threshold || db > threshold || da > threshold) {
        mask[y * width + x] = 1;
        differingPixels += 1;
      }
    }
  }

  return {
    width, height, totalPixels, differingPixels,
    delta: totalPixels === 0 ? 0 : differingPixels / totalPixels,
    mask,
  };
}

/**
 * Groups differing pixels into rectangles.
 *
 * A mask of ten thousand scattered pixels is unusable in a UI. Flood fill on a
 * coarse grid turns it into a handful of "this area is wrong" boxes the user
 * can actually look at, and tiny clusters are dropped as antialiasing noise.
 */
export function clusterRegions(
  diff: PixelDiffResult,
  options: { cellSize?: number; minCells?: number; maxRegions?: number } = {},
): Rect[] {
  const cellSize = options.cellSize ?? 16;
  const minCells = options.minCells ?? 2;
  const maxRegions = options.maxRegions ?? 20;

  const cols = Math.ceil(diff.width / cellSize);
  const rows = Math.ceil(diff.height / cellSize);
  if (cols === 0 || rows === 0) return [];

  // A cell is "hot" when enough of its pixels differ. The fraction filters out
  // single stray pixels without losing thin edges like a 1px border shift.
  const hot = new Uint8Array(cols * rows);
  const cellPixels = cellSize * cellSize;
  const counts = new Int32Array(cols * rows);

  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      if (diff.mask[y * diff.width + x]) {
        counts[Math.floor(y / cellSize) * cols + Math.floor(x / cellSize)] += 1;
      }
    }
  }

  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] / cellPixels > 0.05) hot[index] = 1;
  }

  const visited = new Uint8Array(cols * rows);
  const regions: Rect[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const start = row * cols + col;
      if (!hot[start] || visited[start]) continue;

      let minCol = col, maxCol = col, minRow = row, maxRow = row, cells = 0;
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const current = stack.pop()!;
        const currentRow = Math.floor(current / cols);
        const currentCol = current % cols;
        cells += 1;

        if (currentCol < minCol) minCol = currentCol;
        if (currentCol > maxCol) maxCol = currentCol;
        if (currentRow < minRow) minRow = currentRow;
        if (currentRow > maxRow) maxRow = currentRow;

        // 8-connected: a diagonal shift should stay one region, not two.
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const nextRow = currentRow + dr;
            const nextCol = currentCol + dc;
            if (nextRow < 0 || nextCol < 0 || nextRow >= rows || nextCol >= cols) continue;
            const next = nextRow * cols + nextCol;
            if (hot[next] && !visited[next]) {
              visited[next] = 1;
              stack.push(next);
            }
          }
        }
      }

      if (cells < minCells) continue;

      regions.push({
        x: minCol * cellSize,
        y: minRow * cellSize,
        width: Math.min((maxCol - minCol + 1) * cellSize, diff.width - minCol * cellSize),
        height: Math.min((maxRow - minRow + 1) * cellSize, diff.height - minRow * cellSize),
      });
    }
  }

  // Largest first: the biggest wrong area is the one worth looking at.
  return regions.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, maxRegions);
}

/** Red overlay on the differing pixels, for the comparison screen. */
export function renderDiffImage(actual: DecodedImage, diff: PixelDiffResult): DecodedImage {
  const output = Buffer.alloc(diff.width * diff.height * 4);

  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      const source = (y * actual.width + x) * 4;
      const target = (y * diff.width + x) * 4;

      if (diff.mask[y * diff.width + x]) {
        output[target] = 255;
        output[target + 1] = 40;
        output[target + 2] = 40;
        output[target + 3] = 255;
      } else {
        // Faded greyscale, so the highlights are the only thing that reads.
        const grey = Math.round(
          (actual.data[source] * 0.299 + actual.data[source + 1] * 0.587 + actual.data[source + 2] * 0.114) * 0.35 + 165,
        );
        output[target] = grey;
        output[target + 1] = grey;
        output[target + 2] = grey;
        output[target + 3] = 255;
      }
    }
  }

  return { width: diff.width, height: diff.height, data: output };
}
