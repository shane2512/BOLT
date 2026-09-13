/**
 * The public solvency page — invariant 8: every figure here traces to an
 * on-chain event or an on-chain balance, never to BOLT's own database.
 *
 * Server component: reads the same `@bolt/core` subgraph queries the auditor
 * export uses, live, at request time. Nothing on this page is a placeholder.
 */
import {
  queryBusinessBySlug,
  queryCoverageHistory,
  queryLatestCoverage,
  queryUnlocks
} from "@bolt/core";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { ScrollSpyPillBar } from "@/components/ui/ScrollSpyPillBar";
import { BalanceLookup } from "./BalanceLookup";
import { fmtUsdc, fmtBps, fmtTimestamp, shortAddress, titleiseClass } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PublicSolvencyPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const subgraphUrl = process.env.SUBGRAPH_URL;

  if (!subgraphUrl) {
    return (
      <AppFrame headerTitle={slug} showBack>
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">SUBGRAPH_URL is not set.</p>
            <p className="text-[13px] text-[#5A5A5A] mt-1">
              This page has no other data source and cannot render without it.
            </p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const business = await queryBusinessBySlug(subgraphUrl, slug);

  if (!business) {
    return (
      <AppFrame headerTitle={slug} showBack>
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">
              &ldquo;{slug}&rdquo; is not indexed.
            </p>
            <p className="text-[13px] text-[#5A5A5A] mt-1">
              No BoltRegistry business with this slug has been observed on chain.
            </p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const [latestCoverage, coverageHistory, unlocks] = await Promise.all([
    queryLatestCoverage(subgraphUrl, business.id),
    queryCoverageHistory(subgraphUrl, business.id),
    queryUnlocks(subgraphUrl, business.id)
  ]);

  const indexedAtBlock = coverageHistory.at(-1)?.blockNumber ?? 0n;
  const totalHeld = latestCoverage.reduce((s, c) => s + c.held, 0n);
  const totalOwed = latestCoverage.reduce((s, c) => s + c.owed, 0n);
  const overallBps = totalOwed > 0n ? (totalHeld * 10000n) / totalOwed : 10000n;

  // Last ~30 points for the bar strip, oldest first, each normalised to its
  // own class's ratio so the 100% groove means the same thing at every bar.
  const recentHistory = coverageHistory.slice(-30);

  // The subgraph carries no display-name field, only the slug a business
  // registered with — title-case it rather than showing the raw hyphenated form.
  const displayName = business.slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <AppFrame
      headerTitle={displayName}
      headerSubtitle={`Live public solvency · block ${indexedAtBlock.toLocaleString("en-US")}`}
      showBack
    >
      <div className="p-4 flex-1 flex flex-col gap-6 pb-24">
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Public custody verification</span>
            <StatusChip
              status={overallBps >= 10000n ? "covered" : "refused"}
              label={`Block ${indexedAtBlock.toLocaleString("en-US")}`}
            />
          </div>
          <p className="text-[14px] text-[#5A5A5A] leading-normal">
            Every balance below is held in a Privy-policy-locked account on Arc testnet, read
            directly from the deployed BoltRegistry subgraph — not from our database.
          </p>
        </div>

        {/* Coverage ------------------------------------------------------ */}
        <section id="coverage" className="flex flex-col gap-4">
          <ClaySlab hero className="p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#7C7C7C]">Solvency ratio</span>
              <span className="font-mono text-[13px] font-bold text-[#0A0A0A]">
                {fmtBps(overallBps)} covered
              </span>
            </div>

            <ValueAndSource
              amount={fmtUsdc(totalHeld)}
              label="Total on-chain customer money held"
              sourceType="block"
              sourceValue={indexedAtBlock.toString()}
              sourceLabel="verified at block"
              size="hero"
            />

            {recentHistory.length > 0 && (
              <div className="w-full flex flex-col gap-2 pt-2">
                <div className="flex justify-between text-[11px] font-mono text-[#7C7C7C]">
                  <span>{recentHistory.length} indexed snapshots</span>
                  <span>target 100%</span>
                </div>
                <div className="w-full h-24 bg-[#EFEFEF] rounded-xl p-3 relative flex items-end justify-between border border-[#DCDCDC] overflow-hidden">
                  <div className="absolute inset-x-0 top-6 z-10">
                    <div className="groove-line w-full" />
                  </div>
                  {recentHistory.map((snap, i) => {
                    const pct = snap.owed > 0n ? Number((snap.ratioBps * 100n) / 10000n) : 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full z-0 px-0.5">
                        <div
                          className="w-full bg-[#0A0A0A] rounded-t-sm"
                          style={{ height: `${Math.min(100, pct) * 0.65}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {recentHistory.length === 0 && (
              <p className="text-[13px] text-[#7C7C7C]">
                No coverage snapshots indexed yet for this business.
              </p>
            )}
          </ClaySlab>
        </section>

        {/* Accounts -------------------------------------------------------- */}
        <section id="accounts" className="flex flex-col gap-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-semibold text-[#0A0A0A]">Account class breakdown</h2>
            <span className="text-[12px] text-[#7C7C7C] font-mono">
              {business.accounts.length} account{business.accounts.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {business.accounts.map((acc) => {
              const locked = acc.class !== "OPERATING";
              return (
                <ClayWell
                  key={acc.id}
                  variant={locked ? "standard" : "pressed"}
                  className="p-4 flex flex-col gap-3 border border-[#DCDCDC]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] ${
                          locked ? "bg-[#0A0A0A] text-white" : "bg-white border border-[#0A0A0A] text-[#0A0A0A]"
                        }`}
                      >
                        {locked ? "L" : "O"}
                      </span>
                      <span className="text-[15px] font-semibold text-[#0A0A0A]">{acc.label}</span>
                    </div>
                    <StatusChip
                      status={locked ? "covered" : "pending"}
                      label={locked ? "Enclave-locked" : "Operating"}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[13px] pt-1">
                    <div>
                      <span className="text-[#7C7C7C] block text-[11px]">Held</span>
                      <span className="font-mono font-bold text-[#0A0A0A]">{fmtUsdc(acc.held)}</span>
                    </div>
                    <div>
                      <span className="text-[#7C7C7C] block text-[11px]">Owed</span>
                      <span className="font-mono font-bold text-[#0A0A0A]">{fmtUsdc(acc.owed)}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#DCDCDC] flex items-center justify-between text-[12px]">
                    <span className="font-mono text-[#7C7C7C]">{shortAddress(acc.id)}</span>
                    <ExplorerLink type="address" value={acc.id} label="Verify on Arc explorer" />
                  </div>
                </ClayWell>
              );
            })}
          </div>

          <p className="text-[12px] font-medium text-[#7C7C7C] text-center pt-1">
            Don&apos;t trust this page — open any address on the block explorer and check its
            balance yourself.
          </p>
        </section>

        {/* Unlocks ---------------------------------------------------------- */}
        <section id="unlocks" className="flex flex-col gap-3 pt-2">
          <h2 className="text-[20px] font-semibold text-[#0A0A0A]">Unlock history</h2>

          {unlocks.length === 0 && (
            <ClayWell variant="standard" className="p-4">
              <p className="text-[13px] text-[#5A5A5A]">
                No locked money has ever been released early from this business.
              </p>
            </ClayWell>
          )}

          {unlocks.map((unl) => (
            <ClaySlab key={unl.id} className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#0A0A0A]">
                  {titleiseClass(unl.account.class)} · {unl.account.label}
                </span>
                <StatusChip
                  status={unl.status === "EXECUTED" ? "signed" : "pending"}
                  label={unl.status}
                />
              </div>
              <div className="flex items-baseline justify-between font-mono text-[13px] pt-1">
                <span className="text-[#7C7C7C]">Amount:</span>
                <span className="font-bold text-[#0A0A0A]">{fmtUsdc(unl.amount)}</span>
              </div>
              <div className="flex justify-between items-center text-[12px] text-[#7C7C7C] pt-1">
                <span>
                  {unl.approvalCount} approval{unl.approvalCount === 1 ? "" : "s"} ·{" "}
                  {fmtTimestamp(unl.requestedAtTimestamp)}
                </span>
                <ExplorerLink type="tx" value={unl.requestedTx} />
              </div>
            </ClaySlab>
          ))}
        </section>

        {/* Balance lookup — the one interactive part, real client component */}
        <section id="lookup" className="flex flex-col gap-3 pt-2">
          <BalanceLookup slug={slug} />
        </section>

        <footer className="mt-4 pt-6 border-t-2 border-[#0A0A0A] flex flex-col gap-3">
          <p className="text-[16px] leading-[24px] font-normal text-[#0A0A0A]">
            This page presents indexed facts from Arc testnet. BOLT provides technical enforcement
            and public verifiability. It is not regulated, is not insured, and does not make anyone
            compliant with any regulation. Testnet balances are simulated USDC.
          </p>
        </footer>
      </div>

      <ScrollSpyPillBar
        anchors={[
          { id: "coverage", label: "Coverage" },
          { id: "accounts", label: "Accounts" },
          { id: "unlocks", label: "Unlocks" },
          { id: "lookup", label: "Lookup" }
        ]}
      />
    </AppFrame>
  );
}
