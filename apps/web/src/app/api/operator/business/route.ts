/**
 * B3–B7, B11 — everything the dashboard reads from the chain, in one call.
 *
 * The operator's home, accounts, activity, mandate history, unlock history and
 * alerts are all views over the same indexed data, so they are fetched once and
 * sliced client-side rather than each screen opening its own connection to the
 * subgraph. `runChecks` here is the same function the Monitor and the public
 * page run — an operator must not be shown a friendlier set of findings than
 * the public is (FR-7.6).
 */
import {
  queryBusinessBySlug,
  queryCoverageHistory,
  queryDeposits,
  queryLatestCoverage,
  queryMandates,
  queryPolicyRotations,
  queryUnlocks,
  runChecks
} from "@bolt/core";
import { jsonSafe, withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every operator screen hits this same route independently (see
 * `useOperatorData`), so clicking through the dashboard — exactly what
 * rehearsing a demo does — refires all six subgraph queries on every
 * navigation. Subgraph Studio's testing query endpoint is explicitly
 * documented as rate-limited (thegraph.com/docs/subgraphs/querying/
 * from-an-application), and there's no key that raises it short of
 * publishing to the decentralized network and querying the Gateway instead
 * — a real on-chain step outside this project's scope. A short in-memory
 * cache is the lazy, sufficient fix: indexed chain data doesn't change
 * second to second, so a brief staleness window costs nothing real and
 * saves the repeat queries a demo walkthrough generates.
 */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; body: unknown }>();

export const GET = withOperator(async (request) => {
  const slug = new URL(request.url).searchParams.get("business");
  const subgraphUrl = process.env.SUBGRAPH_URL;
  if (!slug) throw new Error("business is required");
  if (!subgraphUrl) throw new Error("SUBGRAPH_URL is not set");

  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  const business = await queryBusinessBySlug(subgraphUrl, slug);
  if (!business) return jsonSafe({ found: false, slug });

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
  const findings = runChecks({
    business,
    coverage: coverageHistory,
    deposits,
    mandates,
    unlocks,
    indexedAtBlock
  });

  const body = jsonSafe({
    found: true,
    business,
    indexedAtBlock,
    latestCoverage,
    coverageHistory,
    unlocks,
    deposits,
    mandates,
    policyRotations,
    findings
  });
  cache.set(slug, { expiresAt: Date.now() + CACHE_TTL_MS, body });
  return body;
});
