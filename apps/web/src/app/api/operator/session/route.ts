/**
 * B1 — what the operator seat knows about whoever just signed in.
 *
 * Returns the verified Privy DID, the businesses the index has heard of, and —
 * separately, and explicitly — whether the off-chain workflow store is
 * reachable. The dashboard needs to distinguish "this business has no unlock
 * requests" from "we could not ask", and those are different screens.
 */
import { queryBusinesses } from "@bolt/core";
import { jsonSafe, withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbReachable(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { createDb, businesses } = await import("@bolt/db");
    await createDb().select({ id: businesses.id }).from(businesses).limit(1);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const GET = withOperator(async (_request, session) => {
  const subgraphUrl = process.env.SUBGRAPH_URL;

  let indexed: { slug: string; id: string }[] = [];
  let indexError: string | null = subgraphUrl ? null : "SUBGRAPH_URL is not set";
  if (subgraphUrl) {
    try {
      indexed = (await queryBusinesses(subgraphUrl)).map((b) => ({ slug: b.slug, id: b.id }));
    } catch (error) {
      indexError = error instanceof Error ? error.message : String(error);
    }
  }

  const db = await dbReachable();

  return jsonSafe({
    session: { userId: session.userId, expiresAt: session.expiration },
    businesses: indexed,
    indexError,
    workflowStore: db,
    // Said out loud rather than implied by an empty screen: a dashboard
    // session is not what keeps money still.
    scope:
      "This session proves a Privy login. It does not authorise any movement of money: where funds may go is fixed by each account's Privy policy inside an enclave, and widening a lock or publishing a mandate needs the business's key quorum."
  });
});
