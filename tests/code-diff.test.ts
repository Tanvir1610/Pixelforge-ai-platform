import { describe, expect, it } from "vitest";
import {
  byteLength, carryForward, diffFileSet, hashContent, isSafePath, languageFor,
} from "@/lib/code/diff";

describe("hashing", () => {
  it("is stable and content-sensitive", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("")).toHaveLength(64);
  });

  it("counts bytes, not characters", () => {
    expect(byteLength("abc")).toBe(3);
    // A multi-byte file is bigger than its character count suggests, which
    // matters for the inline-vs-storage threshold.
    expect(byteLength("→")).toBe(3);
    expect(byteLength("é")).toBe(2);
  });

  it("infers language from the extension", () => {
    expect(languageFor("app/page.tsx")).toBe("typescript");
    expect(languageFor("styles/globals.css")).toBe("css");
    expect(languageFor("README")).toBeNull();
  });
});

describe("path safety", () => {
  it("accepts ordinary project-relative paths", () => {
    expect(isSafePath("app/page.tsx")).toBe(true);
    expect(isSafePath("components/ui/button.tsx")).toBe(true);
  });

  // Generated code is untrusted output. A model emitting these must not be able
  // to address anything outside the project root.
  it("rejects traversal and absolute paths", () => {
    expect(isSafePath("../../.env")).toBe(false);
    expect(isSafePath("app/../../etc/passwd")).toBe(false);
    expect(isSafePath("/etc/passwd")).toBe(false);
    expect(isSafePath("C:\\Windows\\system32")).toBe(false);
    expect(isSafePath("app/./page.tsx")).toBe(false);
  });

  it("rejects empty segments, null bytes and absurd lengths", () => {
    expect(isSafePath("")).toBe(false);
    expect(isSafePath("app//page.tsx")).toBe(false);
    expect(isSafePath("app/\0/page.tsx")).toBe(false);
    expect(isSafePath("a/".repeat(300))).toBe(false);
  });
});

describe("diffFileSet", () => {
  const previous = new Map([
    ["app/page.tsx", hashContent("old page")],
    ["components/Hero.tsx", hashContent("hero")],
    ["app/globals.css", hashContent("css")],
  ]);

  it("classifies added, modified and unchanged", () => {
    const result = diffFileSet(previous, [
      { path: "app/page.tsx", content: "new page" },
      { path: "components/Hero.tsx", content: "hero" },
      { path: "components/Footer.tsx", content: "footer" },
    ]);

    expect(result.modified).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.added).toBe(1);
    expect(result.records.find((r) => r.path === "app/page.tsx")?.changeKind).toBe("modified");
    expect(result.records.find((r) => r.path === "components/Hero.tsx")?.changeKind).toBe("unchanged");
  });

  // A generation touching two files must not read as deleting everything else.
  it("only deletes what was explicitly listed", () => {
    const result = diffFileSet(previous, [{ path: "app/page.tsx", content: "new page" }]);
    expect(result.deleted).toBe(0);
  });

  it("deletes when asked", () => {
    const result = diffFileSet(previous, [], ["app/globals.css"]);
    expect(result.deleted).toBe(1);
    expect(result.records[0]).toMatchObject({ path: "app/globals.css", changeKind: "deleted", content: null });
  });

  it("ignores deletion of a file that was never there", () => {
    expect(diffFileSet(previous, [], ["nope.tsx"]).deleted).toBe(0);
  });

  it("does not delete a file that is also being written", () => {
    const result = diffFileSet(previous, [{ path: "app/page.tsx", content: "x" }], ["app/page.tsx"]);
    expect(result.deleted).toBe(0);
    expect(result.modified).toBe(1);
  });

  it("treats everything as added when there is no previous version", () => {
    const result = diffFileSet(new Map(), [{ path: "a.tsx", content: "a" }]);
    expect(result.added).toBe(1);
    expect(result.modified).toBe(0);
  });
});

describe("carryForward", () => {
  const previous = new Map([
    ["app/page.tsx", { hash: hashContent("page"), content: "page", bytes: 4, language: "typescript" }],
    ["components/Hero.tsx", { hash: hashContent("hero"), content: "hero", bytes: 4, language: "typescript" }],
    ["app/globals.css", { hash: hashContent("css"), content: "css", bytes: 3, language: "css" }],
  ]);

  // A version row is a complete snapshot, so reading one never has to walk the
  // parent chain.
  it("produces a full snapshot, not just the changes", () => {
    const diff = diffFileSet(
      new Map([...previous].map(([path, file]) => [path, file.hash])),
      [{ path: "app/page.tsx", content: "changed" }],
    );
    const records = carryForward(previous, diff);

    expect(records).toHaveLength(3);
    expect(records.find((r) => r.path === "components/Hero.tsx")?.changeKind).toBe("unchanged");
    expect(records.find((r) => r.path === "app/page.tsx")?.changeKind).toBe("modified");
  });

  it("drops deleted files from the snapshot", () => {
    const diff = diffFileSet(
      new Map([...previous].map(([path, file]) => [path, file.hash])),
      [],
      ["app/globals.css"],
    );
    const records = carryForward(previous, diff);

    expect(records.map((r) => r.path)).not.toContain("app/globals.css");
    expect(records).toHaveLength(2);
  });
});
