import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "@/lib/figma/url";

describe("parseFigmaUrl", () => {
  it("extracts the file key from a design URL", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/8kQ2abcdef/Northwind")?.fileKey).toBe("8kQ2abcdef");
  });

  it("accepts legacy /file/ URLs", () => {
    expect(parseFigmaUrl("https://figma.com/file/8kQ2abcdef/Northwind")?.fileKey).toBe("8kQ2abcdef");
  });

  it("converts the URL node id to the API's colon form", () => {
    expect(parseFigmaUrl("https://figma.com/design/8kQ2abcdef/X?node-id=142-8")?.nodeId).toBe("142:8");
  });

  it("returns no node id when the URL has none", () => {
    expect(parseFigmaUrl("https://figma.com/design/8kQ2abcdef/X")?.nodeId).toBeUndefined();
  });

  // This value decides which host receives a bearer token, so host checking
  // has to be exact rather than a substring match.
  it("rejects lookalike hosts", () => {
    expect(parseFigmaUrl("https://figma.com.evil.test/design/8kQ2abcdef/X")).toBeNull();
    expect(parseFigmaUrl("https://notfigma.com/design/8kQ2abcdef/X")).toBeNull();
    expect(parseFigmaUrl("https://evil.test/?x=https://figma.com/design/8kQ2abcdef")).toBeNull();
  });

  it("rejects non-https and malformed input", () => {
    expect(parseFigmaUrl("http://figma.com/design/8kQ2abcdef/X")).toBeNull();
    expect(parseFigmaUrl("figma.com/design/8kQ2abcdef")).toBeNull();
    expect(parseFigmaUrl("")).toBeNull();
    expect(parseFigmaUrl("javascript:alert(1)")).toBeNull();
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(parseFigmaUrl("  https://figma.com/design/8kQ2abcdef/X  ")?.fileKey).toBe("8kQ2abcdef");
  });
});
