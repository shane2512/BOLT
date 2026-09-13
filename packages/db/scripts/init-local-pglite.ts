/**
 * One-time setup for the local PGlite database (`DB_DRIVER=pglite`).
 *
 * Applies every drizzle migration in order to a fresh, persistent data
 * directory, exactly the same SQL files `db:push` would apply to real
 * Postgres. Safe to re-run: `IF NOT EXISTS`/idempotent DDL in the migrations
 * means a second run against an already-initialised directory is a no-op,
 * not a duplicate-schema error — same assumption the unlock ceremony script
 * already relies on for its own throwaway PGlite fallback.
 *
 *   pnpm --filter @bolt/db db:local:init
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(HERE, "..", "drizzle");
const dataDir = process.env.PGLITE_DATA_DIR ?? join(HERE, "..", ".local-pglite");

const migrations = readdirSync(DRIZZLE_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (migrations.length === 0) {
  throw new Error(`No .sql migrations found in ${DRIZZLE_DIR}`);
}

console.log(`data dir: ${dataDir}${existsSync(dataDir) ? " (exists — re-applying)" : " (new)"}`);
const pg = new PGlite(dataDir);

for (const file of migrations) {
  const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8");
  console.log(`applying ${file} ...`);
  for (const stmt of sql.split("--> statement-breakpoint")) {
    if (stmt.trim()) await pg.exec(stmt);
  }
}

const tables = await pg.query<{ table_name: string }>(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
);
console.log(`\nready. tables: ${tables.rows.map((r) => r.table_name).join(", ")}`);
await pg.close();
