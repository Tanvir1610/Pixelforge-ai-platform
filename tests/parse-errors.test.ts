import { describe, expect, it } from "vitest";
import {
  normalisePath, parseBuildErrors, parseEslintErrors, parseTypescriptErrors,
  prioritiseErrors, summariseErrors,
} from "@/lib/sandbox/parse-errors";

describe("typescript output", () => {
  // Real tsc output, both formats it emits.
  it("parses the compact format", () => {
    const errors = parseTypescriptErrors(
      `app/page.tsx(12,5): error TS2339: Property 'title' does not exist on type 'Props'.\n` +
        `components/Hero.tsx(3,18): error TS2307: Cannot find module '@/lib/tokens'.`,
    );

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      phase: "typecheck", severity: "error", filePath: "app/page.tsx",
      line: 12, column: 5, code: "TS2339",
    });
    expect(errors[1].message).toContain("Cannot find module");
  });

  it("parses the pretty format", () => {
    const errors = parseTypescriptErrors("src/index.ts:4:9 - error TS2322: Type 'string' is not assignable.");
    expect(errors[0]).toMatchObject({ filePath: "src/index.ts", line: 4, column: 9, code: "TS2322" });
  });

  it("distinguishes warnings from errors", () => {
    const errors = parseTypescriptErrors("a.ts(1,1): warning TS6133: 'x' is declared but never used.");
    expect(errors[0].severity).toBe("warning");
  });

  it("ignores summary and noise lines", () => {
    expect(parseTypescriptErrors("Found 3 errors in 2 files.\n\n  app/page.tsx:12")).toHaveLength(0);
  });

  it("returns nothing for clean output", () => {
    expect(parseTypescriptErrors("")).toEqual([]);
  });
});

describe("eslint output", () => {
  it("attributes issues to the file heading above them", () => {
    const errors = parseEslintErrors(
      `/work/app/page.tsx\n` +
        `  12:5   error    'x' is assigned a value but never used   @typescript-eslint/no-unused-vars\n` +
        `  20:1   warning  Missing return type                      @typescript-eslint/explicit-function-return-type\n`,
    );

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      phase: "lint", severity: "error", filePath: "work/app/page.tsx",
      line: 12, code: "@typescript-eslint/no-unused-vars",
    });
    expect(errors[1].severity).toBe("warning");
  });

  it("handles multiple files in one run", () => {
    const errors = parseEslintErrors(
      `a.tsx\n  1:1  error  Bad  rule-a\n\nb.tsx\n  2:2  error  Worse  rule-b\n`,
    );
    expect(errors.map((error) => error.filePath)).toEqual(["a.tsx", "b.tsx"]);
  });
});

describe("build output", () => {
  it("extracts an unresolved module and blames the importing file", () => {
    const errors = parseBuildErrors(
      `Failed to compile.\n\n./components/Hero.tsx\nModule not found: Can't resolve '@/lib/tokens'\n`,
    );

    const missing = errors.find((error) => error.code === "MODULE_NOT_FOUND");
    expect(missing).toBeDefined();
    expect(missing?.message).toContain("@/lib/tokens");
    expect(missing?.filePath).toBe("components/Hero.tsx");
  });

  it("captures generic failures it cannot fully parse", () => {
    const errors = parseBuildErrors("SyntaxError: Unexpected token '}'");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("SyntaxError");
  });
});

describe("normalisePath", () => {
  it("strips the sandbox root so paths match generated_files", () => {
    expect(normalisePath("/tmp/sandbox-a1b2c3/app/page.tsx")).toBe("app/page.tsx");
    expect(normalisePath("./app/page.tsx")).toBe("app/page.tsx");
    expect(normalisePath("app/page.tsx")).toBe("app/page.tsx");
  });
});

describe("prioritiseErrors", () => {
  const base = { filePath: "a.ts", line: 1, column: 1, code: "TS1", message: "boom" } as const;

  it("removes duplicates", () => {
    const result = prioritiseErrors([
      { ...base, phase: "typecheck", severity: "error" },
      { ...base, phase: "typecheck", severity: "error" },
    ]);
    expect(result).toHaveLength(1);
  });

  it("puts errors before warnings", () => {
    const result = prioritiseErrors([
      { ...base, phase: "lint", severity: "warning", message: "w" },
      { ...base, phase: "lint", severity: "error", message: "e" },
    ]);
    expect(result[0].severity).toBe("error");
  });

  // Fixing a missing import removes the dozen type errors it caused, so the
  // earlier phase has to be addressed first.
  it("orders by phase so the root cause comes first", () => {
    const result = prioritiseErrors([
      { ...base, phase: "typecheck", severity: "error", message: "type" },
      { ...base, phase: "build", severity: "error", message: "module" },
    ]);
    expect(result[0].phase).toBe("build");
  });

  it("caps the list so a repair prompt stays bounded", () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...base, phase: "typecheck" as const, severity: "error" as const, message: `error ${index}`,
    }));
    expect(prioritiseErrors(many, 25)).toHaveLength(25);
  });
});

describe("summariseErrors", () => {
  it("reads naturally for the status bar", () => {
    expect(summariseErrors([])).toBe("No problems");
    expect(
      summariseErrors([{ phase: "build", severity: "error", filePath: null, line: null, column: null, code: null, message: "x" }]),
    ).toBe("1 error");
    expect(
      summariseErrors([
        { phase: "build", severity: "error", filePath: null, line: null, column: null, code: null, message: "x" },
        { phase: "lint", severity: "warning", filePath: null, line: null, column: null, code: null, message: "y" },
      ]),
    ).toBe("1 error, 1 warning");
  });
});
