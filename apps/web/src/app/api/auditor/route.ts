/**
 * FR-10 — the auditor's export.
 *
 * Exactly the rows the auditor page read, as JSON, with the subgraph endpoint
 * they came from named in the envelope so a reader can re-run the queries
 * themselves. Deliberately not called a "signed audit bundle": BOLT does not
 * sign this and a signature from us would prove nothing an auditor should
 * accept — the evidence is the chain, and this file is only a convenience copy
 * of one read of it.
 */
import {
  queryBusinessBySlug,
  queryCoverageAtBlock,
  queryCoverageHistory,
  queryDeposits,
  queryLatestCoverage,
  queryMandates,
  queryPolicyRotations,
  queryUnlocks,
  runChecks
} from "@bolt/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `bigint` has no JSON form; base units are written as decimal strings. */
const replacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get("business");
  const blockParam = url.searchParams.get("block");
  const subgraphUrl = process.env.SUBGRAPH_URL;

  if (!slug) return Response.json({ error: "business is required" }, { status: 400 });
  if (!subgraphUrl) return Response.json({ error: "SUBGRAPH_URL is not set" }, { status: 503 });

  let atBlock: bigint | null = null;
  if (blockParam) {
    try {
      atBlock = BigInt(blockParam);
    } catch {
      return Response.json({ error: `"${blockParam}" is not a block number` }, { status: 400 });
    }
  }

  try {
    const business = await queryBusinessBySlug(subgraphUrl, slug);
    if (!business) return Response.json({ error: `${slug} is not indexed` }, { status: 404 });

    const [latestCoverage, coverageHistory, unlocks, deposits, mandates, policyRotations] =
      await Promise.all([
        queryLatestCoverage(subgraphUrl, business.id),
        queryCoverageHistory(subgraphUrl, business.id),
        queryUnlocks(subgraphUrl, business.id),
        queryDeposits(subgraphUrl, business.id),
        queryMandates(subgraphUrl, business.id),
        queryPolicyRotations(subgraphUrl, business.id)
      ]);

    const indexedAtBlock = coverageHistory.at(-1)?.blockNumber ?? 0n;
    const reconstructed =
      atBlock !== null ? await queryCoverageAtBlock(subgraphUrl, business.id, atBlock) : null;

    const findings = runChecks({
      business,
      coverage: coverageHistory,
      deposits,
      mandates,
      unlocks,
      indexedAtBlock
    });

    const body = {
      readAt: new Date().toISOString(),
      source: {
        subgraph: subgraphUrl,
        note: "Every figure below is an indexed BoltRegistry event or an on-chain USDC balance. Nothing here is read from BOLT's own database, and nothing here is signed by BOLT — re-run these queries against the endpoint above, or derive them from Arc directly."
      },
      business,
      indexedAtBlock,
      reconstructedAtBlock: atBlock,
      coverageAtBlock: reconstructed,
      latestCoverage,
      coverageHistory,
      mandates,
      deposits,
      unlocks,
      policyRotations,
      findings
    };

    return new Response(JSON.stringify(body, replacer, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="bolt-audit-${slug}${atBlock !== null ? `-block-${atBlock}` : ""}.json"`
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
