import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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
      const child = spawn(command, args, {
        cwd: this.root,
        env: sandboxEnv(this.root),
        shell: false,
        detached: true,
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
        try {
          // Negative pid kills the group, not just the direct child.
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
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
