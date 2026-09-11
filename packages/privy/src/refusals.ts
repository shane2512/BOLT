/**
 * FR-2.4 — a refused transaction returns Privy's raw error, stored verbatim and
 * never wrapped, prettified or swallowed.
 *
 * Policy refusals are the product's core event and its demo material. The only
 * transformation applied here is the one JSON storage physically requires:
 * pulling non-enumerable own properties (Error puts `message` and `stack`
 * there) into a plain object, and rendering bigints as strings. Nothing is
 * renamed, summarised, or dropped.
 */
import { policyRefusals, type BoltDb } from "@bolt/db";

export interface PolicyRefusalInput {
  businessId?: string;
  accountId?: string;
  /** What was sent to Privy. Kept alongside the error so the refusal is reproducible. */
  attemptedAction?: unknown;
  /** The error exactly as Privy's SDK threw it. */
  error: unknown;
}

/**
 * Every own property, enumerable or not, in a JSON-storable shape. This is what
 * "verbatim" means for an object that has to survive a jsonb column.
 */
export function rawErrorBody(error: unknown): unknown {
  if (error === null || typeof error !== "object") return { value: String(error) };
  const out: Record<string, unknown> = {
    __type: (error as object).constructor?.name ?? "unknown"
  };
  for (const key of Object.getOwnPropertyNames(error)) {
    out[key] = (error as Record<string, unknown>)[key];
  }
  return jsonSafe(out);
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))
  ) as unknown;
}

/**
 * Stores the refusal and returns its row id. Never throws away the input error:
 * callers are expected to rethrow after calling this (CLAUDE.md invariant 1).
 */
export async function recordPolicyRefusal(
  db: BoltDb,
  refusal: PolicyRefusalInput
): Promise<string> {
  const [row] = await db
    .insert(policyRefusals)
    .values({
      businessId: refusal.businessId ?? null,
      accountId: refusal.accountId ?? null,
      rawError: rawErrorBody(refusal.error),
      attemptedAction:
        refusal.attemptedAction === undefined ? null : jsonSafe(refusal.attemptedAction)
    })
    .returning({ id: policyRefusals.id });
  if (!row) throw new Error("recordPolicyRefusal: insert returned no row");
  return row.id;
}
