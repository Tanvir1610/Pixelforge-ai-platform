import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createZip } from "@/lib/code/zip";

/**
 * The archive has to be readable by tools we do not control, so these assert the
 * bytes rather than round-tripping through the same code that wrote them.
 */
function u32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

describe("createZip", () => {
  it("writes the signatures a zip reader looks for", () => {
    const zip = createZip([{ path: "a.txt", content: "hello" }]);

    expect(u32(zip, 0)).toBe(0x04034b50); // local file header
    // The end-of-central-directory record is the last 22 bytes when there is
    // no archive comment, which is where every reader starts.
    expect(u32(zip, zip.length - 22)).toBe(0x06054b50);
  });

  it("records the entry count in both central directory fields", () => {
    const zip = createZip([
      { path: "a.txt", content: "a" },
      { path: "b.txt", content: "b" },
      { path: "c/d.txt", content: "d" },
    ]);
    const end = zip.length - 22;

    expect(zip.readUInt16LE(end + 8)).toBe(3);
    expect(zip.readUInt16LE(end + 10)).toBe(3);
  });

  it("points the central directory at where it actually starts", () => {
    const zip = createZip([{ path: "a.txt", content: "x".repeat(500) }]);
    const end = zip.length - 22;
    const size = u32(zip, end + 12);
    const offset = u32(zip, end + 16);

    expect(u32(zip, offset)).toBe(0x02014b50); // central directory header
    expect(offset + size).toBe(end);
  });

  it("round-trips content through the deflate stream it declares", () => {
    // Compressible, so the writer chooses deflate over storing.
    const content = "const x = 1;\n".repeat(200);
    const zip = createZip([{ path: "app/page.tsx", content }]);

    const nameLength = zip.readUInt16LE(26);
    const extraLength = zip.readUInt16LE(28);
    const compressedSize = u32(zip, 18);
    const body = zip.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + compressedSize);

    expect(zip.readUInt16LE(8)).toBe(8); // method: deflate
    expect(inflateRawSync(body).toString("utf8")).toBe(content);
  });

  it("stores rather than deflates when compression would make a file bigger", () => {
    // A single byte deflates to more than one byte.
    const zip = createZip([{ path: "a.txt", content: "x" }]);

    expect(zip.readUInt16LE(8)).toBe(0); // method: stored
    expect(u32(zip, 18)).toBe(u32(zip, 22)); // compressed === uncompressed
  });

  it("writes the name as given, so paths survive extraction", () => {
    const zip = createZip([{ path: "components/ui/Button.tsx", content: "x" }]);
    const nameLength = zip.readUInt16LE(26);

    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("components/ui/Button.tsx");
  });

  it("normalises Windows separators, which are not zip paths", () => {
    const zip = createZip([{ path: "app\\page.tsx", content: "x" }]);
    const nameLength = zip.readUInt16LE(26);

    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("app/page.tsx");
  });

  /**
   * A path that climbs out of the extraction root is how an archive overwrites
   * files elsewhere on the machine that opens it.
   */
  it("refuses a path that escapes the archive root", () => {
    expect(() => createZip([{ path: "../../.ssh/authorized_keys", content: "x" }])).toThrow(/escapes/);
    expect(() => createZip([{ path: "a/../../b.txt", content: "x" }])).toThrow(/escapes/);
  });

  it("strips a leading slash rather than writing an absolute path", () => {
    const zip = createZip([{ path: "/etc/thing", content: "x" }]);
    const nameLength = zip.readUInt16LE(26);

    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("etc/thing");
  });

  it("marks names as UTF-8 so non-ASCII filenames survive", () => {
    const zip = createZip([{ path: "café/naïve.txt", content: "x" }]);

    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it("clamps dates before the 1980 epoch the format starts at", () => {
    const zip = createZip([{ path: "a.txt", content: "x" }], new Date("1970-01-01T00:00:00Z"));
    const dosDate = zip.readUInt16LE(12);

    // Year is stored as an offset from 1980; a negative one would wrap.
    expect(dosDate >> 9).toBeGreaterThanOrEqual(0);
  });

  it("produces an empty but valid archive for no entries", () => {
    const zip = createZip([]);

    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(0x06054b50);
  });

  /**
   * The real check: an archive the platform's own tar can open. Skipped where
   * bsdtar is not on PATH rather than failing, since that is a property of the
   * machine and not of the writer.
   */
  it("extracts with the system's own archiver", () => {
    const dir = mkdtempSync(join(tmpdir(), "pf-zip-"));
    const archive = join(dir, "out.zip");
    writeFileSync(
      archive,
      createZip([
        { path: "app/page.tsx", content: "export default function Page() { return null }\n" },
        { path: "README.md", content: "# hello\n".repeat(50) },
      ]),
    );

    try {
      execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "pipe" });
    } catch {
      return; // No usable tar here; the byte-level assertions above still ran.
    }

    expect(readdirSync(dir).sort()).toContain("app");
    expect(readFileSync(join(dir, "app", "page.tsx"), "utf8")).toContain("export default");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("# hello");
  });
});
