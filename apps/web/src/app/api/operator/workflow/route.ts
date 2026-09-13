/**
 * B4, B5, B9, B10, B12 — the off-chain half of the dashboard.
 *
 * Postgres holds config and workflow state: which Privy policy is attached to
 * which account, an unlock request's free-text reason and its collected
 * approvals, the beneficiary directory, and the raw Privy refusals we have
 * recorded. None of that is a figure — every number the dashboard shows comes
 * from the subgraph route beside this one (invariant 8).
 *
 * The store is genuinely optional to the product's claims, so this route
 * reports its own reachability instead of failing the page. "No unlock requests
 * exist" and "we could not ask" are different screens and must not collapse
 * into one.
 */
import { desc, eq } from "drizzle-orm";
import { jsonSafe, withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withOperator(async (request) => {
  const slug = new URL(request.url).searchParams.get("business");
  if (!slug) throw new Error("business is required");

  try {
    const {
      accounts,
      alerts,
      beneficiaries,
      businesses,
      createDb,
      mandateRules,
      mandates,
      obligations,
      policyRefusals,
      unlockApprovals,
      unlockRequests
    } = await import("@bolt/db");
    const db = createDb();

    const [business] = await db.select().from(businesses).where(eq(businesses.slug, slug));
    if (!business) {
      return jsonSafe({
        reachable: true,
        known: false,
        slug,
        detail: `The index knows ${slug}, but there is no row for it in this deployment's workflow store. Read-only screens still work; anything that writes needs the row.`
      });
    }

    const [
      accountRows,
      unlockRows,
      approvalRows,
      mandateRows,
      ruleRows,
      obligationRows,
      beneficiaryRows,
      alertRows,
      refusalRows
    ] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.businessId, business.id)),
      db
        .select()
        .from(unlockRequests)
        .where(eq(unlockRequests.businessId, business.id))
        .orderBy(desc(unlockRequests.createdAt)),
      db.select().from(unlockApprovals),
      db
        .select()
        .from(mandates)
        .where(eq(mandates.businessId, business.id))
        .orderBy(desc(mandates.version)),
      db.select().from(mandateRules),
      db.select().from(obligations).where(eq(obligations.businessId, business.id)),
      db.select().from(beneficiaries).where(eq(beneficiaries.businessId, business.id)),
      db
        .select()
        .from(alerts)
        .where(eq(alerts.businessId, business.id))
        .orderBy(desc(alerts.createdAt)),
      db
        .select()
        .from(policyRefusals)
        .where(eq(policyRefusals.businessId, business.id))
        .orderBy(desc(policyRefusals.occurredAt))
        .limit(25)
    ]);

    const ruleIds = new Set(mandateRows.map((m) => m.id));
    const unlockIds = new Set(unlockRows.map((u) => u.id));

    return jsonSafe({
      reachable: true,
      known: true,
      business,
      accounts: accountRows,
      unlocks: unlockRows.map((u) => ({
        ...u,
        approvals: approvalRows.filter((a) => a.unlockRequestId === u.id)
      })),
      // Approvals for unlocks this business does not own are another
      // business's business.
      orphanApprovals: approvalRows.filter((a) => !unlockIds.has(a.unlockRequestId)).length,
      mandates: mandateRows.map((m) => ({
        ...m,
        rules: ruleRows.filter((r) => r.mandateId === m.id)
      })),
      danglingRules: ruleRows.filter((r) => !ruleIds.has(r.mandateId)).length,
      obligations: obligationRows,
      beneficiaries: beneficiaryRows.map((b) => ({
        // The directory is workflow state, but an email is still an email:
        // the dashboard never needs the local part to do its job.
        id: b.id,
        email: b.email,
        walletAddress: b.walletAddress,
        verifiedAddress: b.verifiedAddress,
        createdAt: b.createdAt
      })),
      alerts: alertRows,
      refusals: refusalRows
    });
  } catch (error) {
    return jsonSafe({
      reachable: false,
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
