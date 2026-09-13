/**
 * FR-5.1–FR-5.3 — real details for one unlock ceremony, for the approver
 * link (`/approve/{id}`). Deliberately no operator auth: a quorum member
 * opens this from their own phone, not from a signed-in operator session —
 * same reasoning as the claim flow's beneficiary lookup.
 *
 * Merges three real sources, nothing invented:
 *   - the workflow-store row (packages/db) for the reason text — only its
 *     hash ever goes on chain, so the text itself has to come from here
 *   - the subgraph for the on-chain-confirmed status, approvals and tx
 *   - a live read of the Privy intent for the real signature threshold and
 *     quorum size (signatureThreshold/quorumMemberCount, not persisted
 *     anywhere, so re-derived from the intent itself)
 */
import { eq } from "drizzle-orm";
import { PrivyClient } from "@privy-io/node";
import { accounts, businesses, createDb, unlockRequests, type BoltDb } from "@bolt/db";
import { businessIdOf, unlockIdOf, queryUnlocks } from "@bolt/core";
import { signatureThreshold, quorumMemberCount, type IntentSnapshot } from "@bolt/privy";
import { jsonSafe } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

function approverIds(): string[] {
  try {
    return Object.keys(JSON.parse(process.env.UNLOCK_APPROVER_KEYS ?? "{}"));
  } catch {
    return [];
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const db = createDb() as unknown as BoltDb;

  const [row] = await db.select().from(unlockRequests).where(eq(unlockRequests.id, id));
  if (!row) return Response.json({ found: false });

  const [account] = await db.select().from(accounts).where(eq(accounts.id, row.accountId));
  const [business] = await db.select().from(businesses).where(eq(businesses.id, row.businessId));
  if (!account || !business) return Response.json({ found: false });

  let onChain = null as null | Awaited<ReturnType<typeof queryUnlocks>>[number];
  const subgraphUrl = process.env.SUBGRAPH_URL;
  if (subgraphUrl) {
    const unlocks = await queryUnlocks(subgraphUrl, businessIdOf(business.slug));
    const target = unlockIdOf(id).toLowerCase();
    onChain = unlocks.find((u) => u.id.toLowerCase() === target) ?? null;
  }

  let quorum: { threshold: number; size: number } | null = null;
  if (row.intentId) {
    try {
      const privy = new PrivyClient({
        appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
        appSecret: need("PRIVY_APP_SECRET")
      });
      const intent = (await privy.intents().get(row.intentId)) as unknown as IntentSnapshot;
      quorum = { threshold: signatureThreshold(intent), size: quorumMemberCount(intent) };
    } catch {
      // Best-effort context for the page — not required to render it.
    }
  }

  return Response.json(jsonSafe({
    found: true,
    id: row.id,
    account: { label: account.label, class: account.class, address: account.address },
    amount: row.amount,
    destination: row.destination,
    reason: row.reason,
    reasonHash: row.reasonHash,
    status: onChain?.status ?? "REQUESTED",
    approvals: onChain?.approvals ?? [],
    approvalCount: onChain?.approvalCount ?? 0,
    requestedTx: onChain?.requestedTx ?? null,
    quorum,
    approverIds: approverIds()
  }));
}
