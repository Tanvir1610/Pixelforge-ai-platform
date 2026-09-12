import "server-only";

import ts from "typescript";

/**
 * Checking what the model actually wrote.
 *
 * Generated files went straight into a code version unread. Nothing parsed
 * them, nothing counted a brace, nothing noticed a response that stopped
 * mid-function because the output limit was reached — and the user found out
 * when they downloaded the zip and ran a build on their own machine, hours
 * later, with no way to tell whether the platform or their setup was at fault.
 *
 * A full typecheck needs npm, node_modules and a writable tree, none of which a
 * serverless request has. Parsing does not: TypeScript's own parser reports
 * syntactic diagnostics from a string, in milliseconds, with no filesystem and
 * no dependency resolution. That catches the failures that actually happen —
 * truncation, unbalanced JSX, a stray markdown fence — and honestly does not
 * catch the ones that need types, which is why this is called validation and
 * not a build.
 */
export interface FileDiagnostic {
  path: string;
  line: number;
  column: number;
  message: string;
  /** "syntax" is the parser; the rest are structural checks it cannot make. */
  kind: "syntax" | "truncated" | "fenced" | "empty" | "placeholder" | "json";
}

export interface ValidationResult {
  ok: boolean;
  checked: number;
  diagnostics: FileDiagnostic[];
  /** Paths with at least one problem, which is what the UI counts. */
  badFiles: string[];
}

export interface ValidatableFile {
  path: string;
  content: string;
}

/** Past this, parsing costs more than the answer is worth. */
const MAX_BYTES = 512 * 1024;
const MAX_DIAGNOSTICS_PER_FILE = 5;

function scriptKind(path: string): ts.ScriptKind | null {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".ts")) return ts.ScriptKind.TS;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return null;
}

/**
 * A fenced code block that leaked into the file.
 *
 * Models are asked for raw file content and sometimes answer in markdown. The
 * result parses as garbage, and the first diagnostic it produces is confusing
 * enough to send someone looking in the wrong place.
 */
function fencedBlock(content: string): number | null {
  const lines = content.split("\n");
  for (let index = 0; index < Math.min(lines.length, 5); index += 1) {
    if (/^\s*```/.test(lines[index])) return index + 1;
  }
  // A trailing fence is the other half of the same mistake.
  for (let index = Math.max(0, lines.length - 3); index < lines.length; index += 1) {
    if (/^\s*```\s*$/.test(lines[index])) return index + 1;
  }
  return null;
}

/**
 * A body the model left for someone else to write.
 *
 * Distinct from a syntax error because the file parses perfectly. It is still
 * not finished code, and shipping it silently is how a generated project comes
 * to contain a component that renders nothing.
 */
const PLACEHOLDER = /(\/\/|\/\*|\{\/\*)\s*(\.\.\.\s*)?(rest of|remaining|the rest|implementation (goes )?here|your code here|same as (above|before)|unchanged|omitted for brevity|truncated)/i;

function placeholderLine(content: string): number | null {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (PLACEHOLDER.test(lines[index])) return index + 1;
  }
  return null;
}

/**
 * Output that stopped before the model finished.
 *
 * The parser usually reports this as a missing token, but not always — a file
 * cut inside a string literal or a comment can parse clean and still be half a
 * file. Counting delimiters outside those contexts catches what the parser
 * accepts.
 */
function unbalanced(content: string, kind: ts.ScriptKind): string | null {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    kind === ts.ScriptKind.TSX || kind === ts.ScriptKind.JSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    content,
  );

  let braces = 0;
  let parens = 0;
  let brackets = 0;

  // The scanner already skips comments and treats a string as one token, so
  // a brace inside either is never counted.
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.OpenBraceToken) braces += 1;
    else if (token === ts.SyntaxKind.CloseBraceToken) braces -= 1;
    else if (token === ts.SyntaxKind.OpenParenToken) parens += 1;
    else if (token === ts.SyntaxKind.CloseParenToken) parens -= 1;
    else if (token === ts.SyntaxKind.OpenBracketToken) brackets += 1;
    else if (token === ts.SyntaxKind.CloseBracketToken) brackets -= 1;

    // An unterminated string or template is itself a truncation.
    if (scanner.isUnterminated()) {
      return "The file ends inside an unterminated string — the model's output was cut off.";
    }
    token = scanner.scan();
  }

  if (braces > 0) return `${braces} unclosed ${braces === 1 ? "brace" : "braces"} — the file looks truncated.`;
  if (parens > 0) return `${parens} unclosed ${parens === 1 ? "parenthesis" : "parentheses"} — the file looks truncated.`;
  if (brackets > 0) return `${brackets} unclosed ${brackets === 1 ? "bracket" : "brackets"} — the file looks truncated.`;
  return null;
}

function validateOne(file: ValidatableFile): FileDiagnostic[] {
  const diagnostics: FileDiagnostic[] = [];
  const content = file.content;

  if (content.trim().length === 0) {
    return [{ path: file.path, line: 1, column: 1, kind: "empty", message: "The file is empty." }];
  }

  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) return diagnostics;

  const kind = scriptKind(file.path);
  const isJson = file.path.endsWith(".json");

  // Only files this understands get the content checks. A generated README
  // legitimately contains fenced code blocks, and a stylesheet's comments are
  // not placeholders — flagging either is a false alarm on correct output,
  // which is the fastest way to make a check worth ignoring.
  if (kind === null && !isJson) return diagnostics;

  const fence = fencedBlock(content);
  if (fence !== null) {
    diagnostics.push({
      path: file.path, line: fence, column: 1, kind: "fenced",
      message: "A markdown code fence was written into the file itself.",
    });
  }

  const placeholder = placeholderLine(content);
  if (placeholder !== null) {
    diagnostics.push({
      path: file.path, line: placeholder, column: 1, kind: "placeholder",
      message: "A placeholder comment stands in for real code here.",
    });
  }

  if (isJson) {
    try {
      JSON.parse(content);
    } catch (error) {
      diagnostics.push({
        path: file.path, line: 1, column: 1, kind: "json",
        message: error instanceof Error ? error.message : "Invalid JSON.",
      });
    }
    return diagnostics;
  }

  // Unreachable — a non-JSON file with no script kind returned above — but the
  // JSON branch leaves `kind` nullable and the parser needs a definite one.
  if (kind === null) return diagnostics;

  const source = ts.createSourceFile(file.path, content, ts.ScriptTarget.Latest, true, kind);

  // parseDiagnostics is not on the public SourceFile type, but it is the only
  // way to read syntactic errors without constructing a Program — which would
  // need a filesystem and every import resolvable, neither of which applies to
  // a file set that has not been installed.
  const parseErrors = (source as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
    .parseDiagnostics ?? [];

  for (const diagnostic of parseErrors.slice(0, MAX_DIAGNOSTICS_PER_FILE)) {
    const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start);
    diagnostics.push({
      path: file.path,
      line: line + 1,
      column: character + 1,
      kind: "syntax",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    });
  }

  // Only worth reporting when the parser found nothing: it is a coarser check,
  // and two descriptions of one problem help nobody.
  if (parseErrors.length === 0) {
    const imbalance = unbalanced(content, kind);
    if (imbalance) {
      diagnostics.push({
        path: file.path,
        line: content.split("\n").length,
        column: 1,
        kind: "truncated",
        message: imbalance,
      });
    }
  }

  return diagnostics;
}

/**
 * Validates a generated file set.
 *
 * Never throws. A validator that can fail a generation is worse than no
 * validator: the model's output is already paid for, and losing it to a bug in
 * this file would be the most expensive possible way to be wrong.
 */
export function validateGeneratedFiles(files: ValidatableFile[]): ValidationResult {
  const diagnostics: FileDiagnostic[] = [];

  for (const file of files) {
    try {
      diagnostics.push(...validateOne(file));
    } catch (error) {
      console.error("[validate]", file.path, error);
    }
  }

  const badFiles = [...new Set(diagnostics.map((diagnostic) => diagnostic.path))];

  return {
    ok: diagnostics.length === 0,
    checked: files.length,
    diagnostics,
    badFiles,
  };
}

/** One line for a run's step summary. */
export function summariseValidation(result: ValidationResult): string {
  if (result.ok) return `${result.checked} files parsed clean`;

  const count = result.badFiles.length;
  const problems = result.diagnostics.length;
  // "of N" pluralises on the set, "has/have" on the bad ones: "1 of 12 files
  // has 3 problems" reads correctly where either alone does not.
  return (
    `${count} of ${result.checked} ${result.checked === 1 ? "file" : "files"} ` +
    `${count === 1 ? "has" : "have"} ${problems === 1 ? "a problem" : `${problems} problems`}`
  );
}
