import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.env.example` must never hold a value.
 *
 * It is committed, the repository is public, and it has already carried live
 * credentials into the history — an anon key and a service-role key, which
 * bypasses RLS completely. Deleting the line afterwards does not help: the
 * commit keeps it, and the key has to be rotated.
 *
 * The mistake is an easy one to make and invisible in review, because a
 * populated template looks like a helpfully filled-in example. This test is the
 * thing that notices, before a commit rather than after.
 *
 * Real values belong in `.env.local`, which is ignored, and in the host's own
 * environment settings for a deployment.
 */
const TEMPLATE = resolve(__dirname, "..", ".env.example");

/** `KEY=value` with something after the `=`. Comments and bare keys are fine. */
const POPULATED = /^([A-Z][A-Z0-9_]*)=(.+)$/;

function populatedLines(): { name: string; line: number }[] {
  const contents = readFileSync(TEMPLATE, "utf8");
  const found: { name: string; line: number }[] = [];

  contents.split(/\r?\n/).forEach((text, index) => {
    const match = POPULATED.exec(text.trim());
    if (match) found.push({ name: match[1], line: index + 1 });
  });

  return found;
}

describe(".env.example", () => {
  it("declares every variable the app reads", () => {
    const contents = readFileSync(TEMPLATE, "utf8");
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_APP_URL",
    ]) {
      expect(contents, `${name} should be documented in the template`).toContain(`${name}=`);
    }
  });

  it("holds no values at all, not even harmless-looking ones", () => {
    const populated = populatedLines();
    const detail = populated.map((entry) => `${entry.name} (line ${entry.line})`).join(", ");

    expect(
      populated,
      populated.length === 0
        ? ""
        : `.env.example has values in it: ${detail}. This file is committed to a public ` +
          "repository. Move them to .env.local, and rotate anything secret — the commit keeps it.",
    ).toEqual([]);
  });
});
