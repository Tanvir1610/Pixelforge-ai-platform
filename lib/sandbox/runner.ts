import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isSafePath } from "@/lib/code/diff";
import {
  parseBuildErrors, parseEslintErrors, parseTypescriptErrors, prioritiseErrors,
  type BuildPhase, type ParsedError,
} from "./parse-errors";

/**
 * Sandbox execution (§23).
 *
 * Generated code is untrusted. It never runs on the application server process,
 * never sees application secrets, and never reaches the production database.
 *
 * This runner is the local/CI implementation: a scratch directory, a scrubbed
 * environment, hard timeouts and bounded output. It deliberately implements the
 * `Sandbox` interface below so a container or microVM backend can replace it
 * without touching the orchestrator. Process isolation here is weaker than a
 * container — see SECURITY.md — so this backend is for development, and the
 * container backend is what production uses.
 */
export interface SandboxFile {
  path: string;
  content: string;
}

export interface SandboxLimits {
  /** Per-command wall clock. A hung install must not hold a worker forever. */
  timeoutMs: number;
  /** Captured stdout/stderr per command. Bounds memory on runaway output. */
  maxOutputBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 180_000,
  maxOutputBytes: 512 * 1024,
  maxFiles: 2_000,
  maxTotalBytes: 32 * 1024 * 1024,
};

export interface CommandResult {
  phase: BuildPhase;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface SandboxRunResult {
  ok: boolean;
  root: string;
  commands: CommandResult[];
  errors: ParsedError[];
  timings: Partial<Record<BuildPhase, number>>;
  failedPhase: BuildPhase | null;
}

export interface Sandbox {
  materialise(files: SandboxFile[]): Promise<void>;
  run(phase: BuildPhase, command: string, args: string[]): Promise<CommandResult>;
  dispose(): Promise<void>;
  readonly root: string;
}

/**
 * The environment handed to generated code.
 *
 * An allowlist, not a denylist: the parent process holds Supabase service keys,
 * model API keys and Figma tokens, and inheriting `process.env` would put all
 * of them inside untrusted code. Anything not named here does not exist.
 */
function sandboxEnv(root: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: root,
    NODE_ENV: "production",
    CI: "1",
    // npm writes caches and logs; keeping them inside the sandbox means dispose
    // actually removes everything.
    npm_config_cache: join(root, ".npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

/**
 * Where each build tool's JavaScript entrypoint lives inside a package.
 *
 * Entrypoints, not the `.bin` shims: a shim is a `.cmd` batch file on Windows,
 * and Node refuses to spawn one without a shell (CVE-2024-27980). Running the
 * `.js` under the Node binary already executing us needs no interpreter at all.
 */
const TOOL_ENTRYPOINTS: Record<string, string> = {
  tsc: "typescript/bin/tsc",
  tsserver: "typescript/bin/tsserver",
  eslint: "eslint/bin/eslint.js",
  next: "next/dist/bin/next",
  vitest: "vitest/vitest.mjs",
};

/**
 * Finds a build tool without going near the network.
 *
 * The sandbox's own `node_modules` wins, so a generated project that pinned its
 * own TypeScript is typechecked by that one. Falling back to the platform's
 * installation is deliberate: the toolchain is ours, and a project that failed
 * to install its dev dependencies should still be checked rather than skipped.
 */
export function findToolEntrypoint(
  tool: string,
  roots: string[],
  exists: (path: string) => boolean = existsSync,
): string | null {
  const relative = TOOL_ENTRYPOINTS[tool];
  if (!relative) return null;

  for (const root of roots) {
    const candidate = join(root, "node_modules", ...relative.split("/"));
    if (exists(candidate)) return candidate;
  }
  return null;
}

export class SandboxToolError extends Error {}

/**
 * Resolves a pipeline step to an executable and its arguments.
 *
 * Two things are wrong with running `npx <tool>` here, and the second is the
 * serious one.
 *
 * On Windows, `npm` and `npx` are `.cmd` batch files, so `spawn(..., { shell:
 * false })` fails — ENOENT, or EINVAL if the extension is supplied. That is not
 * a build failure but it looked exactly like one: exit code null, nothing
 * parseable, an EXIT_null error with no file attached.
 *
 * Worse: the sandbox is an empty directory, so `npx tsc` found no local
 * TypeScript and did what npx does — downloaded a package named `tsc` from the
 * public registry and executed it. That package is not the TypeScript compiler;
 * it is an abandoned third-party one. Every build fetched and ran code from a
 * name we do not control, inside the sandbox, which is precisely the thing
 * `--ignore-scripts` is in the install step to prevent. And because that
 * package is not a compiler, the typecheck gate never typechecked anything.
 *
 * So `npx` is not used. Tools are resolved to an entrypoint on disk, and a tool
 * that cannot be found is an error rather than a download.
 */
export function resolveSpawn(
  command: string,
  args: string[],
  options: { sandboxRoot?: string; platform?: NodeJS.Platform } = {},
): { command: string; args: string[] } {
  const platform = options.platform ?? process.platform;

  if (command === "npx") {
    const [tool, ...rest] = args;
    const roots = [...(options.sandboxRoot ? [options.sandboxRoot] : []), process.cwd()];
    const entrypoint = tool ? findToolEntrypoint(tool, roots) : null;

    if (!entrypoint) {
      throw new SandboxToolError(
        `"${tool ?? "npx"}" is not an installed build tool. The sandbox never fetches one from the registry.`,
      );
    }
    return { command: process.execPath, args: [entrypoint, ...rest] };
  }

  // npm itself is still needed to install a project's dependencies.
  if (command === "npm" && platform === "win32") {
    const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cli)) return { command: process.execPath, args: [cli, ...args] };
  }

  return { command, args };
}

/**
 * Kills a process and everything it started.
 *
 * npm spawns children that outlive it, so killing the direct child alone leaves
 * an install running against a directory we are about to delete. POSIX gets the
 * process group; Windows has no such thing, so taskkill walks the tree.
 */
function killTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }): void {
  if (!child.pid) return;

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      child.kill("SIGKILL");
      return;
    }
  }

  try {
    // Negative pid kills the group, not just the direct child.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export class LocalSandbox implements Sandbox {
  private constructor(
    readonly root: string,
    private readonly limits: SandboxLimits,
  ) {}

  static async create(limits: SandboxLimits = DEFAULT_LIMITS): Promise<LocalSandbox> {
    const root = await mkdtemp(join(tmpdir(), "sandbox-"));
    return new LocalSandbox(root, limits);
  }

  /**
   * Writes the file set.
   *
   * Paths are re-checked here even though the write path already validated
   * them: this is the last point before bytes hit a real filesystem, and a
   * symlink or a crafted path escaping the root is the failure that matters.
   */
  async materialise(files: SandboxFile[]): Promise<void> {
    if (files.length > this.limits.maxFiles) {
      throw new Error(`Refusing to write ${files.length} files; the limit is ${this.limits.maxFiles}.`);
    }

    let total = 0;
    for (const file of files) {
      total += Buffer.byteLength(file.content, "utf8");
    }
    if (total > this.limits.maxTotalBytes) {
      throw new Error(`Project is ${Math.round(total / 1024)} KB, over the sandbox limit.`);
    }

    for (const file of files) {
      if (!isSafePath(file.path)) {
        throw new Error(`Refusing to write unsafe path "${file.path}".`);
      }

      const target = resolve(this.root, file.path);
      // Belt and braces: resolve() collapses any traversal the check missed.
      if (!target.startsWith(this.root + sep)) {
        throw new Error(`Path "${file.path}" escapes the sandbox root.`);
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }

  /**
   * Runs one command.
   *
   * `shell: false` throughout — arguments are passed as an array, so a filename
   * containing `; rm -rf /` is a filename and not a command. The whole process
   * group is killed on timeout, because npm spawns children that outlive it.
   */
  run(phase: BuildPhase, command: string, args: string[]): Promise<CommandResult> {
    const started = Date.now();

    return new Promise((resolvePromise) => {
      let spawned: { command: string; args: string[] };
      try {
        spawned = resolveSpawn(command, args, { sandboxRoot: this.root });
      } catch (error) {
        // Surfaced as a failed command rather than thrown: the pipeline reports
        // a phase that could not run the same way it reports one that failed.
        resolvePromise({
          phase,
          command: `${command} ${args.join(" ")}`.trim(),
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : "The command could not be resolved.",
          durationMs: Date.now() - started,
          timedOut: false,
          truncated: false,
        });
        return;
      }

      const child = spawn(spawned.command, spawned.args, {
        cwd: this.root,
        env: sandboxEnv(this.root),
        shell: false,
        // Windows has no process groups, and detaching there orphans the child
        // from the kill path below rather than helping it.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;

      const capture = (chunk: Buffer, into: "out" | "err") => {
        const text = chunk.toString("utf8");
        const current = into === "out" ? stdout : stderr;
        if (current.length + text.length > this.limits.maxOutputBytes) {
          truncated = true;
          const room = Math.max(0, this.limits.maxOutputBytes - current.length);
          if (into === "out") stdout += text.slice(0, room);
          else stderr += text.slice(0, room);
          return;
        }
        if (into === "out") stdout += text;
        else stderr += text;
      };

      child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "out"));
      child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "err"));

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, this.limits.timeoutMs);

      const finish = (exitCode: number | null) => {
        clearTimeout(timer);
        resolvePromise({
          phase,
          command: `${command} ${args.join(" ")}`.trim(),
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          timedOut,
          truncated,
        });
      };

      child.on("error", (error) => {
        stderr += `\n${error.message}`;
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

/** Which parser understands which phase's output. */
function parseFor(result: CommandResult): ParsedError[] {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.phase === "typecheck") return parseTypescriptErrors(combined);
  if (result.phase === "lint") return parseEslintErrors(combined);
  return parseBuildErrors(combined);
}

export interface BuildPipelineStep {
  phase: BuildPhase;
  command: string;
  args: string[];
  /** A lint failure should not stop a build that would otherwise succeed. */
  optional?: boolean;
}

/**
 * The default pipeline.
 *
 * `--ignore-scripts` is the single most important flag here: without it, a
 * dependency's postinstall runs arbitrary code the moment install starts,
 * before any of our other controls apply. Generated projects have no
 * legitimate need for install scripts.
 */
export function defaultPipeline(): BuildPipelineStep[] {
  return [
    { phase: "install", command: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"] },
    // `npx` is never used: see resolveSpawn. In an empty sandbox it downloads
    // whatever package happens to carry the tool's name and runs it.
    { phase: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
    { phase: "lint", command: "npx", args: ["eslint", ".", "--max-warnings", "50"], optional: true },
    { phase: "build", command: "npm", args: ["run", "build"] },
  ];
}

/**
 * Materialises a project and runs the pipeline, stopping at the first required
 * failure. There is no point typechecking a project whose dependencies never
 * installed, and the errors from doing so would bury the real cause.
 */
export async function runBuild(
  files: SandboxFile[],
  options: { limits?: SandboxLimits; pipeline?: BuildPipelineStep[]; sandbox?: Sandbox } = {},
): Promise<SandboxRunResult> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const sandbox = options.sandbox ?? (await LocalSandbox.create(limits));
  const pipeline = options.pipeline ?? defaultPipeline();

  const commands: CommandResult[] = [];
  const timings: Partial<Record<BuildPhase, number>> = {};
  let errors: ParsedError[] = [];
  let failedPhase: BuildPhase | null = null;

  try {
    await sandbox.materialise(files);

    for (const step of pipeline) {
      const result = await sandbox.run(step.phase, step.command, step.args);
      commands.push(result);
      timings[step.phase] = result.durationMs;

      const stepErrors = parseFor(result);
      errors = [...errors, ...stepErrors];

      if (result.exitCode !== 0) {
        if (result.timedOut) {
          errors.push({
            phase: step.phase,
            severity: "error",
            filePath: null,
            line: null,
            column: null,
            code: "TIMEOUT",
            message: `${step.phase} exceeded ${Math.round(limits.timeoutMs / 1000)}s and was stopped.`,
          });
        }

        // A non-zero exit with nothing parseable still has to surface.
        if (stepErrors.length === 0 && !result.timedOut) {
          errors.push({
            phase: step.phase,
            severity: "error",
            filePath: null,
            line: null,
            column: null,
            code: `EXIT_${result.exitCode}`,
            message:
              (result.stderr || result.stdout).trim().split("\n").slice(-5).join("\n").slice(0, 500) ||
              `${step.phase} failed with exit code ${result.exitCode}.`,
          });
        }

        if (!step.optional) {
          failedPhase = step.phase;
          break;
        }
      }
    }

    return {
      ok: failedPhase === null,
      root: sandbox.root,
      commands,
      errors: prioritiseErrors(errors),
      timings,
      failedPhase,
    };
  } finally {
    if (!options.sandbox) await sandbox.dispose();
  }
}
