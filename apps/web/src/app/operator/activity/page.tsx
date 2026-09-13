"use client";

import type { ReactNode } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { DesktopTopNav } from "@/components/desktop/DesktopTopNav";
import { fmtUsdc, fmtBps, titleiseClass } from "@/lib/format";
import { useOperatorData } from "@/lib/useOperatorData";

interface Split {
  amount: string;
  account: { class: string };
}
interface Deposit {
  id: string;
  amount: string;
  splitTotal: string;
  blockNumber: string;
  txHash: string;
  splits: Split[];
}
interface Unlock {
  id: string;
  amount: string;
  requestedAtBlock: string;
  requestedTx: string;
  status: string;
  account: { label: string };
}
interface BusinessData {
  found: boolean;
  deposits: Deposit[];
  unlocks: Unlock[];
}

export default function OperatorActivityPage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Activity">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading activity" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Activity">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  type Row = { kind: "deposit" | "unlock"; block: string; el: ReactNode };
  const rows: Row[] = [
    ...data.deposits.map((d) => {
      const unallocated = BigInt(d.amount) - BigInt(d.splitTotal);
      return {
        kind: "deposit" as const,
        block: d.blockNumber,
        el: (
          <ClayWell key={d.id} className="p-4 flex flex-col gap-2 border border-[#DCDCDC]">
            <div className="flex justify-between items-start">
              <h3 className="text-[14px] font-semibold text-[#0A0A0A]">Deposit received &amp; split</h3>
              <span className="font-mono text-[14px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(d.amount))}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#7C7C7C]">
              {d.splits.map((s, i) => (
                <span key={i}>
                  {titleiseClass(s.account.class)}: {fmtBps((BigInt(s.amount) * 10000n) / BigInt(d.amount))}
                </span>
              ))}
            </div>
            {unallocated !== 0n && (
              <p className="text-[12px] font-semibold text-[#0A0A0A]">
                {fmtUsdc(unallocated)} unallocated — the chain says this, not the splitter&apos;s own report.
              </p>
            )}
            <div className="pt-2 border-t border-[#DCDCDC] flex justify-between items-center text-[12px]">
              <span className="font-mono text-[#7C7C7C]">Block {d.blockNumber}</span>
              <ExplorerLink type="tx" value={d.txHash} />
            </div>
          </ClayWell>
        )
      };
    }),
    ...data.unlocks.map((u) => ({
      kind: "unlock" as const,
      block: u.requestedAtBlock,
      el: (
        <ClayWell key={u.id} className="p-4 flex flex-col gap-2 border border-[#DCDCDC]">
          <div className="flex justify-between items-start">
            <h3 className="text-[14px] font-semibold text-[#0A0A0A]">
              Unlock requested — {u.account.label}
            </h3>
            <span className="font-mono text-[14px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(u.amount))}</span>
          </div>
          <span className="text-[11px] text-[#7C7C7C]">{u.status.toLowerCase()}</span>
          <div className="pt-2 border-t border-[#DCDCDC] flex justify-between items-center text-[12px]">
            <span className="font-mono text-[#7C7C7C]">Block {u.requestedAtBlock}</span>
            <ExplorerLink type="tx" value={u.requestedTx} />
          </div>
        </ClayWell>
      )
    }))
  ].sort((a, b) => Number(b.block) - Number(a.block));

  const desktop = (
    <DesktopShell nav={<DesktopTopNav />}>
      <div className="flex items-center justify-between pb-6">
        <h1 className="text-[26px] font-semibold text-[#0A0A0A]">Activity</h1>
        <span className="text-[13px] text-[#7C7C7C]">{rows.length} indexed events</span>
      </div>
      {rows.length === 0 && (
        <ClayWell className="p-4">
          <p className="text-[13px] text-[#5A5A5A]">No deposits or unlocks indexed yet.</p>
        </ClayWell>
      )}
      {/* Same card elements the mobile column uses, laid out two-up instead of stacked. */}
      <div className="grid grid-cols-2 gap-4">{rows.map((r) => r.el)}</div>
    </DesktopShell>
  );

  return (
    <AppFrame showTabBar headerTitle="Activity" headerSubtitle={`${rows.length} indexed events`} desktop={desktop}>
      <div className="p-4 flex-1 flex flex-col gap-4 pb-28">
        {rows.length === 0 && (
          <ClayWell className="p-4">
            <p className="text-[13px] text-[#5A5A5A]">No deposits or unlocks indexed yet.</p>
          </ClayWell>
        )}
        <div className="flex flex-col gap-2.5">{rows.map((r) => r.el)}</div>
      </div>
    </AppFrame>
  );
}
