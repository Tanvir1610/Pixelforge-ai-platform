import { describe, expect, it } from "vitest";
import { classifyUpload, UNSUPPORTED_MESSAGE } from "@/lib/figma/image-ingest";

/**
 * The drop zone advertised `.fig`, `.png`, `.jpg` and `.svg`, and its file
 * input had no handler at all, so every one of them did nothing.
 */
describe("upload classification", () => {
  it("treats screenshots as readable rasters", () => {
    for (const name of ["shot.png", "Design.PNG", "hero.jpg", "hero.jpeg", "capture.webp"]) {
      expect(classifyUpload(name), name).toBe("raster");
    }
  });

  it("treats SVG separately, since it is stored rather than interpreted", () => {
    expect(classifyUpload("logo.svg")).toBe("vector");
    expect(classifyUpload("LOGO.SVG")).toBe("vector");
  });

  /**
   * Figma's format is proprietary and undocumented. Accepting one and failing
   * quietly is worse than saying why, so it is classified unsupported and the
   * message points at the URL path.
   */
  it("rejects .fig, and says what to do instead", () => {
    expect(classifyUpload("Design System.fig")).toBe("unsupported");
    expect(UNSUPPORTED_MESSAGE).toMatch(/proprietary/i);
    expect(UNSUPPORTED_MESSAGE).toMatch(/URL/);
  });

  it("rejects anything else rather than guessing", () => {
    for (const name of ["notes.pdf", "archive.zip", "script.js", "noextension", ""]) {
      expect(classifyUpload(name), name).toBe("unsupported");
    }
  });
});
