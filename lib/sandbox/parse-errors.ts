/**
 * Build output → structured errors.
 *
 * The debugging agent needs a file, a line and a message, not a wall of text.
 * Parsing is pure so it can be tested against real compiler output without
 * running a build, and every parser degrades to a single unparsed error rather
 * than returning nothing — an error we cannot parse still has to reach the user.
 */
export type BuildPhase = "install" | "typecheck" | "lint" | "build" | "runtime";

export interface ParsedError {
  phase: BuildPhase;
  severity: "error" | "warning";
  filePath: string | null;
  line: number | null;
  column: number | null;
  code: string | null;
  message: string;
}

/** `app/page.tsx(12,5): error TS2339: Property 'x' does not exist.` */
const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

/** `app/page.tsx:12:5 - error TS2339: ...` (pretty output) */
const TSC_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

export function parseTypescriptErrors(output: string): ParsedError[] {
  const errors: ParsedError[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = TSC_LINE.exec(line) ?? TSC_PRETTY.exec(line);
    if (!match) continue;

    errors.push({
      phase: "typecheck",
      severity: match[4] === "warning" ? "warning" : "error",
      filePath: normalisePath(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[5],
      message: match[6],
    });
  }

  return errors;
}

/**
 * ESLint stylish output is file-scoped: a header line names the file and the
 * lines beneath it carry positions, so parsing is stateful.
 */
const ESLINT_FILE = /^(\/?[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue))$/;
const ESLINT_ISSUE = /^(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}([\w@/-]+)$/;

export function parseEslintErrors(output: string): ParsedError[] {
  const errors: ParsedError[] = [];
  let currentFile: string | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const fileMatch = ESLINT_FILE.exec(line);
    if (fileMatch) {
      currentFile = normalisePath(fileMatch[1]);
      continue;
    }

    const issueMatch = ESLINT_ISSUE.exec(line);
    if (issueMatch) {
      errors.push({
        phase: "lint",
        severity: issueMatch[3] === "warning" ? "warning" : "error",
        filePath: currentFile,
        line: Number(issueMatch[1]),
        column: Number(issueMatch[2]),
        code: issueMatch[5],
        message: issueMatch[4],
      });
    }
  }

  return errors;
}

/**
 * Next.js and bundler failures. These have no single format, so the useful
 * signals are extracted individually rather than pretending there is a grammar.
 */
const MODULE_NOT_FOUND = /Module not found: (?:Error: )?Can't resolve '([^']+)'/;
const IMPORT_TRACE = /^\.?\/?(.+?\.(?:tsx?|jsx?|css|vue))$/;

export function parseBuildErrors(output: string): ParsedError[] {
  const errors: ParsedError[] = [];
  const lines = output.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    const missing = MODULE_NOT_FOUND.exec(line);
    if (missing) {
      // The offending file is usually named in the surrounding context.
      let filePath: string | null = null;
      for (let back = index - 1; back >= Math.max(0, index - 4); back -= 1) {
        const candidate = IMPORT_TRACE.exec(lines[back].trim());
        if (candidate) {
          filePath = normalisePath(candidate[1]);
          break;
        }
      }

      errors.push({
        phase: "build",
        severity: "error",
        filePath,
        line: null,
        column: null,
        code: "MODULE_NOT_FOUND",
        message: `Cannot resolve '${missing[1]}'`,
      });
      continue;
    }

    if (/^(?:Error|Failed to compile|SyntaxError)/.test(line)) {
      errors.push({
        phase: "build",
        severity: "error",
        filePath: null,
        line: null,
        column: null,
        code: null,
        message: line.slice(0, 500),
      });
    }
  }

  return errors;
}

/** Strips the sandbox root so paths match what is stored in `generated_files`. */
export function normalisePath(path: string): string {
  return path
    .replace(/^.*?\/sandbox-[\w-]+\//, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

/**
 * Deduplicates and orders errors for the repair agent.
 *
 * Fixing the first error often removes several later ones — a missing import
 * produces one module error and a dozen type errors — so errors are ordered by
 * phase, earliest first, and warnings sink below errors.
 */
const PHASE_ORDER: Record<BuildPhase, number> = {
  install: 0, build: 1, typecheck: 2, lint: 3, runtime: 4,
};

export function prioritiseErrors(errors: ParsedError[], limit = 25): ParsedError[] {
  const seen = new Set<string>();
  const unique: ParsedError[] = [];

  for (const error of errors) {
    const key = `${error.phase}|${error.filePath}|${error.line}|${error.code}|${error.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(error);
  }

  return unique
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      if (a.phase !== b.phase) return PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
      return (a.filePath ?? "").localeCompare(b.filePath ?? "");
    })
    .slice(0, limit);
}

/** One-line summary for the build status bar. */
export function summariseErrors(errors: ParsedError[]): string {
  const errorCount = errors.filter((error) => error.severity === "error").length;
  const warningCount = errors.length - errorCount;

  if (errorCount === 0 && warningCount === 0) return "No problems";
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`);
  if (warningCount) parts.push(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`);
  return parts.join(", ");
}
