/**
 * FR-2.4 — the refusal round-trips through Postgres unchanged.
 *
 * Runs against PGlite (in-memory WASM Postgres) rather than the real database:
 * the production path targets `DATABASE_URL`, but a unit test must not depend on
 * a network-reachable Postgres. Same schema, same drizzle query builder, same
 * jsonb semantics.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { accounts, businesses, policyRefusals, type BoltDb } from "@bolt/db";
import { recordPolicyRefusal } from "./refusals.js";
import { yieldEnabledFor } from "./policy-builder.js";
import { persistProvisionedBusiness } from "./provision.js";

const SCHEMA_SQL = fileURLToPath(
  new URL("../../db/drizzle/0000_swift_cardiac.sql", import.meta.url)
);

let db: BoltDb;
let businessId: string;

beforeAll(async () => {
  const client = new PGlite();
  const raw = drizzle(client);
  for (const statement of readFileSync(SCHEMA_SQL, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await client.exec(statement);
  }
  db = raw as unknown as BoltDb;

  const [business] = await db
    .insert(businesses)
    .values({ slug: "acme", name: "Acme", adminAddress: "0x" + "11".repeat(20) })
    .returning({ id: businesses.id });
  businessId = business!.id;
});

/** The shape @privy-io/node actually throws on a policy violation (Phase 0 evidence). */
function privyRefusal(): Error {
  const error = new Error('400 {"error":{"code":"policy_violation"}}') as Error & {
    status: number;
    error: unknown;
  };
  error.name = "BadRequestError";
  error.status = 400;
  error.error = {
    code: "policy_violation",
    message: "Request denied by policy",
    condition_ids: ["cond_abc"]
  };
  return error;
}

describe("recordPolicyRefusal", () => {
  it("stores Privy's raw error and reads it back unchanged", async () => {
    const error = privyRefusal();
    const id = await recordPolicyRefusal(db, {
      businessId,
      error,
      attemptedAction: { to: "0x36".padEnd(42, "0"), value: 0n, function: "transfer" }
    });

    const [row] = await db
      .select()
      .from(policyRefusals)
      .where(eq(policyRefusals.id, id));

    const stored = row!.rawError as Record<string, unknown>;
    // Non-enumerable Error properties survive.
    expect(stored.message).toBe(error.message);
    expect(stored.stack).toBe(error.stack);
    expect(stored.status).toBe(400);
    expect(stored.__type).toBe("Error");
    // The nested Privy body is byte-for-byte what Privy sent — not summarised,
    // not renamed, not reduced to a code.
    expect(stored.error).toEqual({
      code: "policy_violation",
      message: "Request denied by policy",
      condition_ids: ["cond_abc"]
    });
    // bigints survive as base-unit strings (jsonb cannot hold a bigint).
    expect((row!.attemptedAction as Record<string, unknown>).value).toBe("0");
  });

  it("stores a non-Error rejection too, rather than swallowing it", async () => {
    const id = await recordPolicyRefusal(db, { businessId, error: "upstream exploded" });
    const [row] = await db.select().from(policyRefusals).where(eq(policyRefusals.id, id));
    expect(row!.rawError).toEqual({ value: "upstream exploded" });
  });
});

describe("FR-1.6 — yield_enabled is false for CLIENT_MONEY in the database", () => {
  it("persists false through the real provisioning write path", async () => {
    await persistProvisionedBusiness(
      db,
      {
        slug: "beta",
        name: "Beta",
        keyQuorumId: "kq_test",
        organizationId: "org_test",
        accounts: (["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"] as const).map(
          (accountClass, i) => ({
            accountClass,
            label: accountClass,
            walletId: `w${i}`,
            address: "0x" + String(i + 3).repeat(2).repeat(20).slice(0, 40),
            policyId: accountClass === "OPERATING" ? null : `pol_${i}`,
            policyHash: null,
            policy: null,
            // Every account asks for yield; only OBLIGATION_RESERVE may have it.
            yieldEnabled: yieldEnabledFor(accountClass, true)
          })
        )
      },
      "0x" + "99".repeat(20)
    );

    const rows = await db
      .select({ class: accounts.class, yieldEnabled: accounts.yieldEnabled })
      .from(accounts);
    const byClass = Object.fromEntries(rows.map((r) => [r.class, r.yieldEnabled]));
    expect(byClass.CLIENT_MONEY).toBe(false);
    expect(byClass.OPERATING).toBe(false);
    expect(byClass.OBLIGATION_RESERVE).toBe(true);
  });
});
