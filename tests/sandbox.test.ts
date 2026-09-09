import { afterEach, describe, expect, it } from "vitest";
import { LocalSandbox, runBuild, DEFAULT_LIMITS, type BuildPipelineStep } from "@/lib/sandbox/runner";

/**
 * These tests execute real processes. They are the only place in the suite that
 * does, deliberately: the sandbox's job is to contain untrusted code, and a
 * mocked child process would prove nothing about whether it actually does.
 */
const disposables: LocalSandbox[] = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((sandbox) => sandbox.dispose()));
});

async function sandbox(limits = DEFAULT_LIMITS) {
  const created = await LocalSandbox.create(limits);
  disposables.push(created);
  return created;
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true, noEmit: true, target: "ES2022",
    module: "esnext", moduleResolution: "bundler", skipLibCheck: true,
  },
});

const TYPECHECK: BuildPipelineStep[] = [
  { phase: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
];

describe("sandbox isolation", () => {
  it("refuses to write outside its root", async () => {
    const box = await sandbox();
    await expect(box.materialise([{ path: "../../escaped.txt", content: "nope" }])).rejects.toThrow(
      /unsafe path|escapes the sandbox/i,
    );
  });

  it("refuses absolute paths", async () => {
    const box = await sandbox();
    await expect(box.materialise([{ path: "/etc/passwd", content: "nope" }])).rejects.toThrow();
  });

  /**
   * The parent process holds Supabase service keys and model API keys. If the
   * child inherited process.env, untrusted code would read all of them.
   */
  it("does not leak the parent environment to generated code", async () => {
    const box = await sandbox();
    process.env.PIXELFORGE_TEST_SECRET = "super-secret-value";

    await box.materialise([
      { path: "leak.js", content: "console.log(JSON.stringify(Object.keys(process.env)))" },
    ]);
    const result = await box.run("build", "node", ["leak.js"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("PIXELFORGE_TEST_SECRET");
    expect(result.stdout).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(result.stdout).not.toContain("ANTHROPIC_API_KEY");
    // PATH is allowlisted, so the child can still find node.
    expect(result.stdout).toContain("PATH");

    delete process.env.PIXELFORGE_TEST_SECRET;
  });

  /** Arguments are passed as an array with shell:false, so this stays a filename. */
  it("does not interpret arguments through a shell", async () => {
    const box = await sandbox();
    await box.materialise([{ path: "safe.js", content: "console.log('ran')" }]);

    const result = await box.run("build", "node", ["safe.js; echo PWNED"]);

    expect(result.stdout).not.toContain("PWNED");
    expect(result.exitCode).not.toBe(0);
  });

  it("kills a hung process at the timeout", async () => {
    const box = await sandbox({ ...DEFAULT_LIMITS, timeoutMs: 1_500 });
    await box.materialise([{ path: "hang.js", content: "setInterval(() => {}, 1000)" }]);

    const result = await box.run("build", "node", ["hang.js"]);

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(10_000);
  }, 20_000);

  it("truncates runaway output instead of buffering it all", async () => {
    const box = await sandbox({ ...DEFAULT_LIMITS, maxOutputBytes: 4_096 });
    await box.materialise([
      { path: "spam.js", content: "for (let i = 0; i < 200000; i++) console.log('x'.repeat(80))" },
    ]);

    const result = await box.run("build", "node", ["spam.js"]);

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4_096);
  }, 30_000);

  it("rejects a project with too many files", async () => {
    const box = await sandbox({ ...DEFAULT_LIMITS, maxFiles: 3 });
    const files = Array.from({ length: 4 }, (_, index) => ({
      path: `file-${index}.ts`,
      content: "export const x = 1;",
    }));

    await expect(box.materialise(files)).rejects.toThrow(/limit is 3/);
  });

  it("rejects a project over the byte limit", async () => {
    const box = await sandbox({ ...DEFAULT_LIMITS, maxTotalBytes: 1_000 });
    await expect(
      box.materialise([{ path: "big.ts", content: "x".repeat(2_000) }]),
    ).rejects.toThrow(/over the sandbox limit/);
  });
});

describe("build pipeline", () => {
  it("reports success for a project that typechecks", async () => {
    const result = await runBuild(
      [
        { path: "tsconfig.json", content: TSCONFIG },
        { path: "src/index.ts", content: "export const greet = (name: string): string => `hi ${name}`;\n" },
      ],
      { pipeline: TYPECHECK },
    );

    expect(result.ok).toBe(true);
    expect(result.failedPhase).toBeNull();
    expect(result.errors).toHaveLength(0);
  }, 60_000);

  /** The whole point: a real compiler error becomes a structured, addressable one. */
  it("turns a real type error into a structured error with a file and line", async () => {
    const result = await runBuild(
      [
        { path: "tsconfig.json", content: TSCONFIG },
        { path: "src/index.ts", content: "export const greet = (name: string): number => `hi ${name}`;\n" },
      ],
      { pipeline: TYPECHECK },
    );

    expect(result.ok).toBe(false);
    expect(result.failedPhase).toBe("typecheck");
    expect(result.errors.length).toBeGreaterThan(0);

    const first = result.errors[0];
    expect(first.phase).toBe("typecheck");
    expect(first.filePath).toBe("src/index.ts");
    expect(first.line).toBe(1);
    expect(first.code).toMatch(/^TS\d+$/);
  }, 60_000);

  it("stops at the first required failure", async () => {
    const result = await runBuild(
      [{ path: "tsconfig.json", content: TSCONFIG }, { path: "src/a.ts", content: "const x: number = 'no';" }],
      {
        pipeline: [
          { phase: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
          { phase: "build", command: "node", args: ["-e", "console.log('should not run')"] },
        ],
      },
    );

    expect(result.failedPhase).toBe("typecheck");
    // There is no point building a project that does not typecheck, and the
    // resulting errors would bury the real cause.
    expect(result.commands).toHaveLength(1);
  }, 60_000);

  it("continues past an optional step that fails", async () => {
    const result = await runBuild([{ path: "a.js", content: "" }], {
      pipeline: [
        { phase: "lint", command: "node", args: ["-e", "process.exit(1)"], optional: true },
        { phase: "build", command: "node", args: ["-e", "console.log('built')"] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.commands).toHaveLength(2);
  }, 30_000);

  it("surfaces a non-zero exit even when nothing parses", async () => {
    const result = await runBuild([{ path: "a.js", content: "" }], {
      pipeline: [{ phase: "build", command: "node", args: ["-e", "process.stderr.write('opaque failure'); process.exit(3)"] }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("EXIT_3");
    expect(result.errors[0].message).toContain("opaque failure");
  }, 30_000);

  it("records timings per phase", async () => {
    const result = await runBuild([{ path: "a.js", content: "" }], {
      pipeline: [{ phase: "build", command: "node", args: ["-e", "0"] }],
    });

    expect(result.timings.build).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
