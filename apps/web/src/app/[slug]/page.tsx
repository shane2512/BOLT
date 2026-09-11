/**
 * FR-6 — the public, unauthenticated solvency page.
 *
 * Every figure below traces to a `@bolt/core` subgraph-client call, which is
 * itself an indexed `BoltRegistry` event or an on-chain USDC balance
 * (CLAUDE.md invariant 8). Nothing here reads Postgres — the one place
 * Postgres appears on this page is the beneficiary lookup's email -> address
 * step (`/api/beneficiary`), which is a directory lookup, not a figure.
 */
import { notFound } from "next/navigation";
import {
  arcTestnet,
  queryBusinessBySlug,
  queryDeposits,
  queryLatestCoverage,
  queryCoverageHistory,
  queryMandates,
  queryUnlocks,
  runChecks,
  type AccountResult,
  type CoverageSnapshotResult,
  type Finding
} from "@bolt/core";
import { reasonHashOf, unlockIdOf } from "@bolt/core";
import CoverageChart from "./CoverageChart";
import BeneficiaryLookup from "./BeneficiaryLookup";
import { fmtUsdc, fmtBps, fmtTimestamp, shortAddress, shortHash } from "./format";

export const dynamic = "force-dynamic"; // unauthenticated, always reads live chain state

const EXPLORER = arcTestnet.blockExplorers.default.url;
const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

const CLASS_ORDER = ["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"] as const;

const YIELD_RULE: Record<string, string> = {
  CLIENT_MONEY: "Never earns yield, by design. Client money is never put at risk or invested (CLAUDE.md invariant 4).",
  OBLIGATION_RESERVE: "May earn yield while idle — it is the company's own liability (e.g. tax or payroll reserves), not client money.",
  OPERATING: "Not applicable. Operating funds move freely for the business's own use, not held for yield."
};

function need(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

/**
 * FR-5.6 — the free text behind each `UnlockRequested.reasonHash`.
 *
 * This is the one thing on the page that comes out of Postgres, and it is not a
 * figure: the hash beside it is the on-chain commitment, and a reader who
 * doesn't trust us can keccak the text themselves and compare. If Postgres is
 * unreachable the section still renders — from the chain, without the prose,
 * which is the correct degradation for a page whose whole claim is that it does
 * not depend on us.
 */
async function loadUnlockReasons(): Promise<Map<string, { reason: string; matches: boolean }>> {
  const reasons = new Map<string, { reason: string; matches: boolean }>();
  try {
    const { createDb, unlockRequests } = await import("@bolt/db");
    const rows = await createDb()
      .select({ id: unlockRequests.id, reason: unlockRequests.reason, reasonHash: unlockRequests.reasonHash })
      .from(unlockRequests);
    for (const row of rows) {
      reasons.set(unlockIdOf(row.id).toLowerCase(), {
        reason: row.reason,
        matches: reasonHashOf(row.reason).toLowerCase() === row.reasonHash.toLowerCase()
      });
    }
  } catch {
    // Nothing to do and nothing to hide: the hashes below still stand alone.
  }
  return reasons;
}

// Text colour is set explicitly, not inherited: the page renders under the
// visitor's colour scheme, and a pale tinted card with inherited light text is
// invisible in dark mode.
const FINDING_STYLE: Record<string, string> = {
  SEVERE: "border-red-500 bg-red-50 text-red-950",
  WARNING: "border-amber-500 bg-amber-50 text-amber-950",
  INFO: "border-gray-300 bg-gray-50 text-gray-900"
};

/** One Monitor finding, with the evidence that backs it left open to inspection. */
function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className={`border rounded p-4 ${FINDING_STYLE[finding.severity] ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{finding.title}</h3>
        <span className="text-xs uppercase tracking-wide opacity-70">
          {finding.severity} · {finding.kind}
        </span>
      </div>
      <p className="mt-2">{finding.message}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs opacity-70">
          Evidence — block numbers and transaction hashes
        </summary>
        <pre className="mt-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-all bg-white/60 p-2 rounded border">
          {JSON.stringify(finding.evidence, null, 2)}
        </pre>
      </details>
    </article>
  );
}

export default async function PublicSolvencyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const subgraphUrl = need("SUBGRAPH_URL");

  const business = await queryBusinessBySlug(subgraphUrl, slug);
  if (!business) notFound();

  const [latestCoverage, history, unlocks, deposits, mandates, unlockReasons] = await Promise.all([
    queryLatestCoverage(subgraphUrl, business.id),
    queryCoverageHistory(subgraphUrl, business.id),
    queryUnlocks(subgraphUrl, business.id),
    queryDeposits(subgraphUrl, business.id),
    queryMandates(subgraphUrl, business.id),
    loadUnlockReasons()
  ]);

  // FR-7.6 — the Solvency Monitor's severe findings, surfaced publicly.
  //
  // The page runs the Monitor's own checks (`runChecks`, `@bolt/core`) against
  // the same subgraph the Monitor reads, rather than displaying rows the
  // Monitor wrote to Postgres. Same code, same data, no second display path —
  // and no figure on this page that exists only in our database (invariant 8).
  // A reader can reach the same conclusions from the block numbers below.
  const findings = runChecks({
    business,
    coverage: history,
    deposits,
    mandates,
    unlocks,
    indexedAtBlock: history.at(-1)?.blockNumber ?? 0n
  });
  const severeFindings = findings.filter((f) => f.severity === "SEVERE");
  const warningFindings = findings.filter((f) => f.severity === "WARNING");

  const coverageByClass = new Map<string, CoverageSnapshotResult>(latestCoverage.map((c) => [c.class, c]));
  const accountsByClass = new Map<string, AccountResult[]>();
  for (const account of business.accounts) {
    const arr = accountsByClass.get(account.class) ?? [];
    arr.push(account);
    accountsByClass.set(account.class, arr);
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-10 text-sm">
      <header>
        <h1 className="text-2xl font-semibold">{slug}</h1>
        <p className="text-gray-500 mt-1">
          Public solvency page. Every figure below is an on-chain event or on-chain balance — check any address or
          transaction on{" "}
          <a href={EXPLORER} target="_blank" rel="noopener noreferrer" className="underline">
            Arcscan
          </a>
          .
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-xs text-gray-600">
          <div>
            <dt className="uppercase tracking-wide">Business id</dt>
            <dd className="font-mono">{shortHash(business.id)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide">Admin</dt>
            <dd className="font-mono">
              <a href={addressUrl(business.admin)} target="_blank" rel="noopener noreferrer" className="underline">
                {shortAddress(business.admin)}
              </a>
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide">Registered</dt>
            <dd>{fmtTimestamp(business.registeredAtTimestamp)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide">Total deposited</dt>
            <dd>{fmtUsdc(business.totalDeposited)}</dd>
          </div>
        </dl>
      </header>

      {/* FR-7.6 — severe Monitor findings, surfaced publicly */}
      {severeFindings.length > 0 || warningFindings.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">Solvency Monitor</h2>
          <div className="space-y-3">
            {severeFindings.map((f) => (
              <FindingCard key={f.fingerprint} finding={f} />
            ))}
          </div>
          {warningFindings.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-500">
                {warningFindings.length} warning-level finding{warningFindings.length === 1 ? "" : "s"}
              </summary>
              <div className="space-y-3 mt-2">
                {warningFindings.map((f) => (
                  <FindingCard key={f.fingerprint} finding={f} />
                ))}
              </div>
            </details>
          ) : null}
          <p className="text-xs text-gray-500 mt-3">
            Findings are computed live from the same indexed history the rest of this page reads —
            the agent has no private data source (FR-7.1). Every figure inside a finding names the
            block or transaction it came from, so you can check the conclusion rather than take it.
          </p>
        </section>
      ) : null}

      {/* FR-6.2 — owed vs held per class, current coverage ratio */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Owed vs. held, by account class</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Class</th>
                <th className="py-2 pr-4">Held</th>
                <th className="py-2 pr-4">Owed</th>
                <th className="py-2 pr-4">Coverage</th>
                <th className="py-2 pr-4">Yield</th>
                <th className="py-2">As of</th>
              </tr>
            </thead>
            <tbody>
              {CLASS_ORDER.map((cls) => {
                const c = coverageByClass.get(cls);
                if (!c) {
                  return (
                    <tr key={cls} className="border-b">
                      <td className="py-2 pr-4 font-medium">{cls}</td>
                      <td colSpan={5} className="py-2 text-gray-400">
                        no indexed activity
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={cls} className="border-b">
                    <td className="py-2 pr-4 font-medium">{cls}</td>
                    <td className="py-2 pr-4">{fmtUsdc(c.held)}</td>
                    <td className="py-2 pr-4">{fmtUsdc(c.owed)}</td>
                    <td className={`py-2 pr-4 font-medium ${c.shortfall ? "text-red-600" : "text-green-700"}`}>
                      {fmtBps(c.ratioBps)}
                      {c.shortfall ? " — SHORTFALL" : ""}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{YIELD_RULE[cls]}</td>
                    <td className="py-2">block {c.blockNumber.toString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Source: latest indexed <code>CoverageSnapshot</code> per class (subgraph). Yield setting is derived from the
          account class per CLAUDE.md invariant 4 / FR-11.2 — there is no separate per-account flag; only class
          determines it.
        </p>
      </section>

      {/* FR-6.4 — coverage over time */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Coverage over time</h2>
        <CoverageChart history={history} />
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-500">
            {history.length} indexed snapshot{history.length === 1 ? "" : "s"} — show raw data
          </summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b">
                  <th className="py-1 pr-3">Block</th>
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Class</th>
                  <th className="py-1 pr-3">Held</th>
                  <th className="py-1 pr-3">Owed</th>
                  <th className="py-1 pr-3">Coverage</th>
                  <th className="py-1 pr-3">Trigger</th>
                  <th className="py-1">Tx</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={`${row.blockNumber}-${row.class}-${row.txHash}`} className="border-b">
                    <td className="py-1 pr-3">{row.blockNumber.toString()}</td>
                    <td className="py-1 pr-3">{fmtTimestamp(row.timestamp)}</td>
                    <td className="py-1 pr-3">{row.class}</td>
                    <td className="py-1 pr-3">{fmtUsdc(row.held)}</td>
                    <td className="py-1 pr-3">{fmtUsdc(row.owed)}</td>
                    <td className="py-1 pr-3">{fmtBps(row.ratioBps)}</td>
                    <td className="py-1 pr-3">{row.trigger}</td>
                    <td className="py-1">
                      <a href={txUrl(row.txHash)} target="_blank" rel="noopener noreferrer" className="underline">
                        {shortHash(row.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* FR-6.3 — every account address */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Accounts</h2>
        {CLASS_ORDER.map((cls) => {
          const accounts = accountsByClass.get(cls) ?? [];
          if (accounts.length === 0) return null;
          return (
            <div key={cls} className="mb-6">
              <h3 className="font-medium mb-2">{cls}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="py-1 pr-3">Address</th>
                      <th className="py-1 pr-3">Label</th>
                      <th className="py-1 pr-3">Held</th>
                      <th className="py-1 pr-3">Owed</th>
                      <th className="py-1 pr-3">Policy hash</th>
                      <th className="py-1">Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className="border-b">
                        <td className="py-1 pr-3">
                          <a href={addressUrl(a.id)} target="_blank" rel="noopener noreferrer" className="underline font-mono">
                            {a.id}
                          </a>
                        </td>
                        <td className="py-1 pr-3">{a.label}</td>
                        <td className="py-1 pr-3">{fmtUsdc(a.held)}</td>
                        <td className="py-1 pr-3">{fmtUsdc(a.owed)}</td>
                        <td className="py-1 pr-3 font-mono">{shortHash(a.policyHash)}</td>
                        <td className="py-1">
                          block {a.registeredAtBlock.toString()}
                          {a.held === 0n && a.owed === 0n && a.totalIn === 0n ? (
                            <span className="text-gray-400"> (no activity)</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-gray-500">
          Every account ever registered under this business (<code>AccountRegistered</code> events, subgraph). Some
          show no activity — repeated registrations from development/testing runs; they are shown for completeness,
          not hidden.
        </p>
      </section>

      {/* FR-6.5 — unlock history */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Unlock history</h2>
        {unlocks.length === 0 ? (
          <p className="text-gray-500">
            No unlocks have been requested for this business yet. This section reads the subgraph&apos;s{" "}
            <code>Unlock</code>/<code>Approval</code> entities directly.
          </p>
        ) : (
          <div className="space-y-6">
            {unlocks.map((u) => {
              const known = unlockReasons.get(u.id.toLowerCase());
              return (
                <article key={u.id} className="border rounded p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-medium">
                      {fmtUsdc(u.amount)} from {u.account.label}
                    </h3>
                    <span className="text-xs uppercase tracking-wide text-gray-600">{u.status}</span>
                  </div>

                  {/* FR-5.1 / FR-5.6 — the reason, and how to check it yourself. */}
                  <p className="mt-2">{known ? known.reason : <em className="text-gray-500">Reason text not published here — only its hash is on chain.</em>}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500 break-all">
                    keccak256(reason) = {u.reasonHash}
                    {known ? (known.matches ? " · matches" : " · MISMATCH") : ""}
                  </p>

                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Destination</dt>
                      <dd className="font-mono">
                        <a href={addressUrl(u.destination)} target="_blank" rel="noopener noreferrer" className="underline">
                          {shortAddress(u.destination)}
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Requested</dt>
                      <dd>{fmtTimestamp(u.requestedAtTimestamp)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Requested in</dt>
                      <dd className="font-mono">
                        <a href={txUrl(u.requestedTx)} target="_blank" rel="noopener noreferrer" className="underline">
                          {shortHash(u.requestedTx)}
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Executed</dt>
                      <dd>
                        {u.executedAtTimestamp ? fmtTimestamp(u.executedAtTimestamp) : "—"}
                      </dd>
                    </div>
                  </dl>

                  {/* FR-5.3 — approver set, each with its World Selfie Check proof reference. */}
                  <h4 className="mt-4 font-medium text-xs uppercase tracking-wide text-gray-600">
                    Approvers ({u.approvals.length})
                  </h4>
                  {u.approvals.length === 0 ? (
                    <p className="text-xs text-gray-500 mt-1">No approvals recorded yet.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs mt-1">
                      <thead>
                        <tr className="border-b">
                          <th className="py-1 pr-3">Approver</th>
                          <th className="py-1 pr-3">World Selfie Check proof reference</th>
                          <th className="py-1">Recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.approvals.map((ap) => (
                          <tr key={ap.txHash} className="border-b">
                            <td className="py-1 pr-3 font-mono">
                              <a href={addressUrl(ap.approver)} target="_blank" rel="noopener noreferrer" className="underline">
                                {shortAddress(ap.approver)}
                              </a>
                            </td>
                            <td className="py-1 pr-3 font-mono break-all">{ap.humanProofRef}</td>
                            <td className="py-1">
                              <a href={txUrl(ap.txHash)} target="_blank" rel="noopener noreferrer" className="underline">
                                {shortHash(ap.txHash)}
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-3">
          Amounts, destinations, approvers, proof references and timestamps are all indexed{" "}
          <code>BoltRegistry</code> events. The proof reference is the World nullifier itself, not a
          hash of it — per-relying-party and per-action, so it identifies the same human across this
          business&apos;s approvals and reveals nothing else. The 24-hour delay between the final
          approval and executability is a constant compiled into{" "}
          <code>BoltUnlockTimer</code>; read <code>UNLOCK_DELAY</code> off the contract if you want
          to check that it has not been shortened.
        </p>
      </section>

      {/* FR-6.7 — beneficiary lookup */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Find your balance</h2>
        <BeneficiaryLookup slug={slug} explorerUrl={EXPLORER} />
      </section>
    </main>
  );
}
