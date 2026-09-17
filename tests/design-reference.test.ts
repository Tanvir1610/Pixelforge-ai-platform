import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import {
  decode, downscale, encode, prepareDesignImage, tile, TILE_HEIGHT, TILE_WIDTH, type RgbaImage,
} from "@/lib/design/image-tiles";
import { designText } from "@/lib/ai/context/compact";
import type { DesignDocument, IrNode } from "@/lib/design-ir/types";

/**
 * Showing the model the design.
 *
 * Code generation was given the palette and never the page. These cover the
 * pieces that put the page in front of it: the image arriving at a legible
 * size, the copy arriving whole and in order, and the prompt laid out so the
 * design is only paid for once per generation.
 */
function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return { width, height, data };
}

function pngBytes(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

function node(id: string, overrides: Partial<IrNode>): IrNode {
  return {
    id, type: "container", name: id, parentId: null, childIds: [], orderIndex: 0, depth: 0,
    box: { x: 0, y: 0, width: 100, height: 100 },
    layout: { mode: "none", gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, sizingHorizontal: "fixed", sizingVertical: "hug" },
    style: { effects: [] },
    interactions: [],
    ...overrides,
  };
}

const longParagraph =
  "Northwind turns field research into decisions your team can act on, without the three-week synthesis cycle.";

const document: DesignDocument = {
  projectId: "p", sourceFileKey: "k", name: "Site", version: "1",
  frames: [{ id: "f", name: "Home", width: 1440, height: 3000, rootNodeId: "root" }],
  nodes: {
    root: node("root", { type: "frame", childIds: ["hero", "footer"] }),
    hero: node("hero", { depth: 1, name: "Hero", semanticRole: "hero", childIds: ["h1", "p1"] }),
    h1: node("h1", {
      depth: 2, type: "text", textContent: "Ship your ideas.",
      typography: { fontFamily: "Inter", fontSize: 64, fontWeight: 800, lineHeight: 68, letterSpacing: 0, color: "#111111" },
    }),
    p1: node("p1", { depth: 2, type: "text", textContent: longParagraph }),
    footer: node("footer", { depth: 1, name: "Footer", childIds: ["c1"] }),
    c1: node("c1", { depth: 2, type: "text", textContent: "© 2026 Northwind" }),
  },
  tokens: [], components: [], assets: [],
};


describe("downscale", () => {
  it("narrows to the target width and keeps the aspect ratio", () => {
    const out = downscale(solid(2400, 6000, [10, 20, 30, 255]), 1200);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(3000);
  });

  it("leaves an image that is already narrow enough untouched", () => {
    const image = solid(800, 900, [0, 0, 0, 255]);
    expect(downscale(image, 1200)).toBe(image);
  });

  /** Area-averaged, so a one-pixel stroke survives as a grey rather than vanishing. */
  it("averages the pixels it merges rather than picking one", () => {
    const image = solid(4, 1, [0, 0, 0, 255]);
    // Alternate black and white columns.
    for (const x of [1, 3]) image.data.fill(255, x * 4, x * 4 + 3);

    const out = downscale(image, 2);
    expect(out.data[0]).toBe(128);
    expect(out.data[4]).toBe(128);
  });
});

describe("tile", () => {
  it("cuts a tall page into slices that cover it top to bottom", () => {
    const page = solid(TILE_WIDTH, TILE_HEIGHT * 3, [255, 255, 255, 255]);
    const { tiles, truncated, coveredHeight } = tile(page, 10);

    expect(tiles).toHaveLength(3);
    expect(tiles.every((slice) => slice.width === TILE_WIDTH)).toBe(true);
    expect(truncated).toBe(false);
    expect(coveredHeight).toBe(page.height);
  });

  it("folds a thin remainder into the last slice instead of sending a strip", () => {
    const page = solid(100, TILE_HEIGHT + 50, [0, 0, 0, 255]);
    const { tiles } = tile(page, 10);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].height).toBe(TILE_HEIGHT + 50);
  });

  /** Reported, because a model told "this is the page" will leave out the rest. */
  it("reports when the page is taller than the budget allows", () => {
    const page = solid(100, TILE_HEIGHT * 5, [0, 0, 0, 255]);
    const { tiles, truncated, coveredHeight } = tile(page, 2);

    expect(tiles).toHaveLength(2);
    expect(truncated).toBe(true);
    expect(coveredHeight).toBe(TILE_HEIGHT * 2);
  });

  it("keeps the rows in order", () => {
    const page = solid(1, TILE_HEIGHT * 2, [0, 0, 0, 255]);
    // Mark the first row of the second slice.
    page.data[TILE_HEIGHT * 4] = 200;

    const { tiles } = tile(page, 5);
    expect(tiles[1].data[0]).toBe(200);
  });
});

describe("prepareDesignImage", () => {
  it("narrows and slices a PNG into images the API accepts", () => {
    const bytes = pngBytes(solid(2880, 9000, [240, 240, 250, 255]));
    const { images, gaps } = prepareDesignImage(bytes, "image/png", 6, '"Home"');

    expect(images.length).toBeGreaterThan(1);
    expect(images.every((image) => image.mediaType === "image/png")).toBe(true);
    for (const image of images) {
      expect(decode(Buffer.from(image.data, "base64")).width).toBe(TILE_WIDTH);
    }
    expect(gaps).toEqual([]);
  });

  /** Byte-identical output is what lets later steps read the images from cache. */
  it("produces the same bytes every time", () => {
    const bytes = pngBytes(solid(1600, 3000, [12, 34, 56, 255]));
    const first = prepareDesignImage(bytes, "image/png", 6, "x");
    const second = prepareDesignImage(bytes, "image/png", 6, "x");

    expect(second.images.map((image) => image.data)).toEqual(first.images.map((image) => image.data));
  });

  it("says how much of a page was left out", () => {
    const bytes = pngBytes(solid(1200, TILE_HEIGHT * 4, [0, 0, 0, 255]));
    const { gaps } = prepareDesignImage(bytes, "image/png", 1, '"Home"');

    expect(gaps.join(" ")).toMatch(/top 25%/);
  });

  it("passes a JPEG through whole, and says what that costs", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const { images, gaps } = prepareDesignImage(jpeg, "image/jpeg", 6, '"Shot"');

    expect(images).toHaveLength(1);
    expect(gaps.join(" ")).toMatch(/PNG is sliced/);
  });

  it("sends nothing once the budget is spent", () => {
    const bytes = pngBytes(solid(10, 10, [0, 0, 0, 255]));
    expect(prepareDesignImage(bytes, "image/png", 0, "x").images).toEqual([]);
  });

  it("round-trips through the encoder without changing pixels", () => {
    const image = solid(3, 2, [1, 2, 3, 4]);
    expect(decode(encode(image)).data.equals(image.data)).toBe(true);
  });
});

describe("designText", () => {
  /** The layer summary clips at 80 characters; the generator must not have to guess the rest. */
  it("keeps text whole", () => {
    expect(designText(document).text).toContain(longParagraph);
  });

  it("lists text in reading order", () => {
    const { text } = designText(document);
    const order = ["Ship your ideas.", longParagraph, "© 2026 Northwind"].map((line) => text.indexOf(line));

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("labels each line with the section it belongs to", () => {
    const { text } = designText(document);
    expect(text).toMatch(/\(hero\) "Ship your ideas\."/);
    expect(text).toMatch(/\(Footer\) "© 2026 Northwind"/);
  });

  it("carries the type the text is set in", () => {
    expect(designText(document).text).toContain("[64px/800 #111111]");
  });

  it("says when it had to stop", () => {
    const result = designText(document, 12);
    expect(result.truncated).toBe(true);
    expect(result.text).toMatch(/further text omitted/);
  });
});

describe("the code generator's prompt", () => {
  it("puts the design first, cached, and the per-step instructions after it", async () => {
    const captured: { messages: { role: string; untrusted?: boolean; content: { type: string; cache?: boolean; text?: string }[] }[] }[] = [];

    vi.doMock("@/lib/ai/structured", async (original) => ({
      ...(await original<typeof import("@/lib/ai/structured")>()),
      structuredCall: async (options: (typeof captured)[number]) => {
        captured.push(options);
        return { value: { files: [], notes: null }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 }, modelKey: "claude-opus-5", providerKey: "anthropic", attempts: 1 };
      },
    }));
    const { runCodeStep } = await import("@/lib/ai/agents/code-generator");

    await runCodeStep({
      step: "Build the hero",
      architecture: { framework: "nextjs", styling: "tailwind", typescript: true, tokenStrategy: "css-variables", routes: [], directories: [], buildOrder: [] } as never,
      components: { components: [] } as never,
      document,
      existingFiles: [],
      reference: { parts: [{ type: "image", mediaType: "image/png", data: "AAAA" }], gaps: [] },
    });
    vi.doUnmock("@/lib/ai/structured");

    const [design, step] = captured[0].messages;

    // The design: images before text, marked untrusted, cached on its last block.
    expect(design.untrusted).toBe(true);
    expect(design.content[0].type).toBe("image");
    expect(design.content.at(-1)?.cache).toBe(true);
    expect(design.content.at(-1)?.text).toContain(longParagraph);

    // Anything that changes between steps comes after the cached prefix.
    expect(step.content[0].text).toContain("STEP TO GENERATE: Build the hero");
    expect(design.content.at(-1)?.text).not.toContain("Build the hero");
  });
});
