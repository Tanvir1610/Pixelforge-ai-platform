#!/usr/bin/env node
/**
 * Preflight check against a live Supabase project.
 *
 * Verifies connectivity, that migrations have been applied, that RLS is on, and
 * that the storage buckets exist. Run it after `supabase db push`:
 *
 *   node scripts/check-supabase.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, and uses
 * SUPABASE_SERVICE_ROLE_KEY only if present, for the checks that need it.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}

const EXPECTED_TABLES = [
  "profiles", "organizations", "organization_members", "projects", "project_members",
  "figma_files", "figma_frames", "design_nodes", "design_tokens", "design_components",
  "generation_runs", "generation_steps", "ai_messages", "build_runs",
  "visual_comparisons", "deployment_records", "usage_records", "model_providers",
];
const EXPECTED_BUCKETS = [
  "figma-assets", "project-assets", "generated-assets", "screenshots", "build-artifacts", "avatars",
];

let failures = 0;
const pass = (message) => console.log(`  ✓ ${message}`);
const fail = (message) => {
  console.log(`  ✗ ${message}`);
  failures += 1;
};

console.log(`\nChecking ${url}\n`);

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

// An anonymous read must return zero rows, not an error and not data. Zero rows
// is RLS doing its job; rows would mean the boundary is open.
console.log("Anonymous access");
const { data: leaked, error: anonError } = await anon.from("projects").select("id").limit(1);
if (anonError && /permission denied/i.test(anonError.message)) pass("anon cannot read projects (denied)");
else if (!anonError && (leaked ?? []).length === 0) pass("anon reads zero rows (RLS active)");
else if ((leaked ?? []).length > 0) fail(`anon read ${leaked.length} project row(s) — RLS is NOT protecting this table`);
else fail(`unexpected: ${anonError?.message}`);

const { error: providerError } = await anon.from("model_providers").select("key").limit(1);
if (!providerError) pass("reachable and schema is queryable");
else fail(`cannot query model_providers: ${providerError.message}`);

if (!serviceKey) {
  console.log("\nSkipping schema and storage checks (SUPABASE_SERVICE_ROLE_KEY not set).");
} else {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log("\nSchema");
  let missing = 0;
  for (const table of EXPECTED_TABLES) {
    const { error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) {
      fail(`table "${table}" is missing — run: supabase db push`);
      missing += 1;
      if (missing >= 3) {
        console.log("  … stopping table checks; migrations look unapplied");
        break;
      }
    }
  }
  if (missing === 0) pass(`all ${EXPECTED_TABLES.length} expected tables present`);

  console.log("\nFunctions");
  const { error: rpcError } = await admin.rpc("has_org_role", {
    org_id: "00000000-0000-0000-0000-000000000000",
    minimum: "viewer",
  });
  if (!rpcError) pass("authorization helpers installed");
  else fail(`has_org_role missing: ${rpcError.message}`);

  // 0016. The actor-scoped predicates are what let a worker holding the service
  // role say who it is acting for; without them code generation cannot save a
  // version at all, so a half-applied migration set has to be visible here.
  const NIL = "00000000-0000-0000-0000-000000000000";
  const { error: actorError } = await admin.rpc("can_write_project_as", { p_user: NIL, p_project: NIL });
  if (!actorError) pass("actor-scoped authorization installed (0016)");
  else fail(`can_write_project_as missing — run migration 0016: ${actorError.message}`);

  // Called with the actor argument the service role must pass. A complaint about
  // p_actor_id means the pre-0016 four-argument version is still installed,
  // which no worker can ever satisfy.
  const { error: versionError } = await admin.rpc("create_code_version", { p_project_id: NIL, p_actor_id: NIL });
  if (versionError && /insufficient|privilege/i.test(versionError.message)) {
    pass("create_code_version accepts an explicit actor (0016)");
  } else if (versionError && /p_actor_id|does not exist|schema cache/i.test(versionError.message)) {
    fail("create_code_version has no p_actor_id — migration 0016 is not applied");
  } else if (versionError) {
    fail(`create_code_version: ${versionError.message}`);
  } else {
    fail("create_code_version authorised a nil actor — the permission check is not running");
  }

  console.log("\nStorage");
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) {
    fail(`cannot list buckets: ${bucketError.message}`);
  } else {
    const names = new Set((buckets ?? []).map((bucket) => bucket.name));
    for (const expected of EXPECTED_BUCKETS) {
      if (names.has(expected)) {
        const bucket = buckets.find((candidate) => candidate.name === expected);
        if (bucket?.public) fail(`bucket "${expected}" is PUBLIC — it must be private`);
        else pass(`bucket "${expected}" present and private`);
      } else {
        fail(`bucket "${expected}" is missing`);
      }
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
