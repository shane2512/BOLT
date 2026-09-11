import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
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
 */
export function createDb(connectionString = process.env.DATABASE_URL): NodePgDatabase<
  typeof schema
> {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return drizzle(new Pool({ connectionString }), { schema });
}
