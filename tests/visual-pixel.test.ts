import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  clusterRegions, decodePng, diffImages, encodePng, renderDiffImage, type DecodedImage,
} from "@/lib/visual/pixel-diff";

/** Builds a real image, so the diff is exercised on actual pixel data. */
function image(width: number, height: number, fill: [number, number, number, number] = [255, 255, 255, 255]): DecodedImage {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill[0];
    data[index * 4 + 1] = fill[1];
    data[index * 4 + 2] = fill[2];
    data[index * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

function paint(target: DecodedImage, x: number, y: number, w: number, h: number, colour: [number, number, number]) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const index = (row * target.width + col) * 4;
      target.data[index] = colour[0];
      target.data[index + 1] = colour[1];
      target.data[index + 2] = colour[2];
      target.data[index + 3] = 255;
    }
  }
}

describe("png round-trip", () => {
  it("decodes what it encodes", () => {
    const original = image(8, 8, [10, 20, 30, 255]);
    const decoded = decodePng(encodePng(original));

    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    expect(decoded.data[0]).toBe(10);
  });

  it("reads a PNG produced by another encoder", () => {
    const png = new PNG({ width: 4, height: 4 });
    png.data.fill(128);
    const decoded = decodePng(PNG.sync.write(png));
    expect(decoded.data[0]).toBe(128);
  });
});

describe("diffImages", () => {
  it("reports no difference for identical images", () => {
    const result = diffImages(image(40, 40), image(40, 40));
    expect(result.differingPixels).toBe(0);
    expect(result.delta).toBe(0);
  });

  it("finds a painted block", () => {
    const reference = image(40, 40);
    const actual = image(40, 40);
    paint(actual, 10, 10, 10, 10, [255, 0, 0]);

    const result = diffImages(reference, actual);

    expect(result.differingPixels).toBe(100);
    expect(result.delta).toBeCloseTo(100 / 1600, 4);
  });

  /**
   * Antialiasing and subpixel text render differently between Figma and a
   * browser. A zero threshold would flag every glyph edge.
   */
  it("tolerates imperceptible differences", () => {
    const reference = image(20, 20, [200, 200, 200, 255]);
    const actual = image(20, 20, [205, 203, 202, 255]);

    expect(diffImages(reference, actual).differingPixels).toBe(0);
    expect(diffImages(reference, actual, { threshold: 1 }).differingPixels).toBe(400);
  });

  it("ignores areas transparent in both images", () => {
    const reference = image(10, 10, [0, 0, 0, 0]);
    const actual = image(10, 10, [255, 255, 255, 0]);
    expect(diffImages(reference, actual).differingPixels).toBe(0);
  });

  /** A page one pixel taller than the reference is ordinary, not a failure. */
  it("compares the overlap when sizes differ", () => {
    const result = diffImages(image(40, 40), image(40, 60));
    expect(result.height).toBe(40);
    expect(result.totalPixels).toBe(1600);
  });

  it("handles an empty overlap without dividing by zero", () => {
    const result = diffImages(image(0, 0), image(10, 10));
    expect(result.delta).toBe(0);
  });
});

describe("clusterRegions", () => {
  it("turns scattered pixels into one usable box", () => {
    const reference = image(160, 160);
    const actual = image(160, 160);
    paint(actual, 32, 32, 48, 48, [255, 0, 0]);

    const regions = clusterRegions(diffImages(reference, actual));

    expect(regions).toHaveLength(1);
    expect(regions[0].x).toBeLessThanOrEqual(32);
    expect(regions[0].y).toBeLessThanOrEqual(32);
    expect(regions[0].width).toBeGreaterThanOrEqual(48);
  });

  it("keeps distant changes as separate regions", () => {
    const reference = image(320, 320);
    const actual = image(320, 320);
    paint(actual, 16, 16, 48, 48, [255, 0, 0]);
    paint(actual, 240, 240, 48, 48, [0, 0, 255]);

    expect(clusterRegions(diffImages(reference, actual))).toHaveLength(2);
  });

  it("merges a diagonal shift into one region", () => {
    const reference = image(160, 160);
    const actual = image(160, 160);
    paint(actual, 32, 32, 32, 32, [255, 0, 0]);
    paint(actual, 64, 64, 32, 32, [255, 0, 0]);

    // 8-connected, so a diagonal offset stays one problem area.
    expect(clusterRegions(diffImages(reference, actual))).toHaveLength(1);
  });

  it("drops specks below the minimum size", () => {
    const reference = image(160, 160);
    const actual = image(160, 160);
    paint(actual, 80, 80, 2, 2, [255, 0, 0]);

    expect(clusterRegions(diffImages(reference, actual))).toHaveLength(0);
  });

  it("returns the largest region first and caps the count", () => {
    const reference = image(400, 400);
    const actual = image(400, 400);
    paint(actual, 10, 10, 20, 20, [255, 0, 0]);
    paint(actual, 200, 200, 120, 120, [255, 0, 0]);

    const regions = clusterRegions(diffImages(reference, actual), { maxRegions: 1 });
    expect(regions).toHaveLength(1);
    expect(regions[0].width).toBeGreaterThan(100);
  });

  it("returns nothing for an identical pair", () => {
    expect(clusterRegions(diffImages(image(64, 64), image(64, 64)))).toEqual([]);
  });
});

describe("renderDiffImage", () => {
  it("highlights differences in red and fades the rest", () => {
    const reference = image(32, 32);
    const actual = image(32, 32);
    paint(actual, 8, 8, 8, 8, [0, 0, 0]);

    const diff = diffImages(reference, actual);
    const rendered = renderDiffImage(actual, diff);

    const insideIndex = (10 * 32 + 10) * 4;
    expect(rendered.data[insideIndex]).toBe(255);
    expect(rendered.data[insideIndex + 1]).toBe(40);

    const outsideIndex = (2 * 32 + 2) * 4;
    expect(rendered.data[outsideIndex]).toBe(rendered.data[outsideIndex + 1]);

    // It has to survive encoding: this is what the user downloads.
    expect(() => decodePng(encodePng(rendered))).not.toThrow();
  });
});
