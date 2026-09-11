import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Applies the migration chain to an in-process Postgres (PGlite, WASM).
 *
 * `verify-db.sh` needs a real server and psql, which is why migrations kept
 * reaching production unrun: three in a row failed in the SQL editor on faults
 * a single apply would have caught — a return type that cannot be replaced, a
 * column missing from a GROUP BY, a dollar-quoted body split by the editor.
 *
 * This needs nothing installed. Run it before handing a migration over:
 *
 *   npm run db:check
 */
const ROOT = join(process.cwd(), "supabase");
const MIGRATIONS = join(ROOT, "migrations");

const db = await PGlite.create();

/** Extensions PGlite does not carry. Only pgvector is actually needed later. */
function degradeExtensions(sql) {
  return sql
    .replace(/create extension if not exists "vector";/g, "select 1;")
    .replace(/create extension if not exists "pg_trgm";/g, "select 1;")
    .replace(/create extension if not exists "pgcrypto";/g, "select 1;")
    // Trigram indexes need pg_trgm's operator class. Neutered for validation
    // only: the index's presence is not what a migration check is testing.
    .replace(/create index[^;]*gin_trgm_ops[^;]*;/gi, "select 1;");
}

/** gen_random_uuid is in core since 13, but pgcrypto's absence removes digest. */
await db.exec(`
  create schema if not exists auth;
  create schema if not exists storage;
`);

const stubs = readFileSync(join(ROOT, "tests", "00_supabase_stubs.sql"), "utf8");
try {
  await db.exec(degradeExtensions(stubs));
  console.log("  stubs                                    ok");
} catch (error) {
  console.log("  stubs                                    FAILED");
  console.log("    " + String(error.message).split("\n")[0]);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
let failures = 0;

for (const file of files) {
  const sql = degradeExtensions(readFileSync(join(MIGRATIONS, file), "utf8"));
  try {
    await db.exec(sql);
    console.log(`  ${file.padEnd(40)} ok`);
  } catch (error) {
    failures += 1;
    console.log(`  ${file.padEnd(40)} FAILED`);
    for (const line of String(error.message).split("\n").slice(0, 4)) {
      console.log("    " + line);
    }
    // Keep going: a later migration may be independently checkable.
  }
}

console.log(failures === 0 ? "\nall migrations applied" : `\n${failures} migration(s) failed`);
process.exit(failures === 0 ? 0 : 1);
