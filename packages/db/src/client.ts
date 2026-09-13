import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

/**
 * Any Postgres-backed drizzle database: node-postgres in production, PGlite
 * in tests. Direct Postgres ports are unreachable from some build sandboxes, so
 * anything that must be provably correct is tested against the in-memory driver.
 */
export type BoltDb = PgDatabase<PgQueryResultHKT, Record<string, never>>;

/**
 * Production Postgres. The pool is created lazily so importing this module —
 * which `@bolt/db`'s index does — never opens a socket; tests swap in a
 * different driver against the same schema instead.
 *
 * This sandbox's outbound network policy blocks raw Postgres ports (5432/6543
 * confirmed closed; only 443 is open). Two opt-in alternatives exist for that:
 *
 * `DB_DRIVER=neon-http` routes every query over HTTPS via Neon's serverless
 * driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`) instead of
 * opening a raw socket — same `DATABASE_URL`, just a Neon connection string,
 * and it works from here because it's plain fetch, not TCP.
 *
 * `DB_DRIVER=pglite` switches every caller to a persistent local PGlite
 * database instead — a real Postgres engine running in-process (WASM), no
 * server or network involved at all. Docker Desktop was unreachable too, and
 * `@electric-sql/pglite-socket` (a TCP bridge speaking real Postgres wire
 * protocol over PGlite, which would have let this function stay untouched)
 * turned out to have a live bug in 0.2.11 — every real query closes the
 * connection (its own debug output shows an unfinished `idle in transaction`
 * code path). In-process is what's left, and it needs `wasmModule`/`fsBundle`
 * supplied explicitly: PGlite's own file-locating code resolves its
 * `.wasm`/`.data` files relative to its *own* `import.meta.url`, which Next's
 * webpack server bundle relocates, breaking the lookup. Reading the files
 * ourselves via `createRequire` (resolved against *this* module's real
 * location, which webpack does rewrite correctly) sidesteps that path
 * entirely. `PGLITE_DATA_DIR` (absolute path, set in `.env`) points at the
 * data directory; run `pnpm --filter @bolt/db db:local:init` once first to
 * create the schema there.
 *
 * Both are explicit opt-ins, not autodetected, so production behaviour never
 * silently changes: unset (or any other value) keeps using `DATABASE_URL`
 * via a raw `pg.Pool` exactly as before.
 */
export function createDb(connectionString = process.env.DATABASE_URL): NodePgDatabase<
  typeof schema
> {
  if (process.env.DB_DRIVER === "neon-http") {
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    // Same `PgDatabase` interface as the node-postgres branch below; only the
    // concrete driver differs, and every caller already treats the result as
    // `BoltDb` (see e.g. `packages/privy/scripts/phase6-ceremony.ts`'s `openDb`).
    return drizzleNeonHttp(neon(connectionString), { schema }) as unknown as NodePgDatabase<
      typeof schema
    >;
  }
  if (process.env.DB_DRIVER === "pglite") {
    // Both branches return drizzle instances implementing the same
    // `PgDatabase` interface; only the concrete driver type differs, and
    // every caller in this codebase already treats the result as `BoltDb`
    // (see e.g. `packages/privy/scripts/phase6-ceremony.ts`'s `openDb`).
    return createLocalPgliteDb() as unknown as NodePgDatabase<typeof schema>;
  }
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return drizzle(
    new Pool({
      connectionString,
      // Without this, an unreachable Postgres host falls back to the OS TCP
      // timeout — ~39 seconds, measured, during which every caller just hangs.
      // A page whose whole point is that it does not depend on our database
      // should find that out quickly and say so, not spin. A healthy pooler
      // connects in well under a second.
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 8_000)
    }),
    { schema }
  );
}

let pgliteWasmModule: WebAssembly.Module | undefined;
let pgliteFsBundle: Blob | undefined;

function createLocalPgliteDb() {
  const dir = process.env.PGLITE_DATA_DIR;
  if (!dir) {
    throw new Error("DB_DRIVER=pglite requires PGLITE_DATA_DIR (an absolute path) to be set");
  }
  // Resolved once per process and reused: `new WebAssembly.Module` and the
  // file reads are synchronous, so this stays a plain sync call like the
  // node-postgres branch above, matching `createDb`'s declared return type.
  if (!pgliteWasmModule || !pgliteFsBundle) {
    // `PGLITE_WASM_DIR` (absolute, set in `.env`) takes priority over
    // resolving it ourselves: inside Next's webpack server bundle,
    // `require.resolve("@electric-sql/pglite")` returns a plausible-looking
    // but wrong path (observed: an `apps/` path missing the `web` segment
    // entirely) — the same class of bug as PGlite's own internal
    // `import.meta.url` lookups this whole approach exists to avoid, just
    // one level up. Set once, outside any bundler, it can't be wrong.
    const distDir =
      process.env.PGLITE_WASM_DIR ?? dirname(createRequire(import.meta.url).resolve("@electric-sql/pglite"));
    pgliteWasmModule = new WebAssembly.Module(readFileSync(join(distDir, "postgres.wasm")));
    pgliteFsBundle = new Blob([readFileSync(join(distDir, "postgres.data"))]);
  }
  // `createDb` is synchronous everywhere it's called, but PGlite queues
  // operations against its own internal readiness promise, so constructing
  // it synchronously and letting drizzle await inside each query works
  // exactly like the ceremony script's usage of the same driver.
  const pg = new PGlite({ dataDir: dir, wasmModule: pgliteWasmModule, fsBundle: pgliteFsBundle });
  return drizzlePglite(pg, { schema });
}
