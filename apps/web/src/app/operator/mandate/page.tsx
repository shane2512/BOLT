"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { InputWell } from "@/components/ui/InputWell";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc, fmtBps, titleiseClass } from "@/lib/format";
import { useOperatorData, postOperator } from "@/lib/useOperatorData";

interface Account {
  id: string;
  class: "CLIENT_MONEY" | "OBLIGATION_RESERVE" | "OPERATING";
  label: string;
}
interface Mandate {
  version: string;
  rulesHash: string;
  blockNumber: string;
  txHash: string;
}
interface Deposit {
  amount: string;
}
interface BusinessData {
  found: boolean;
  business: { accounts: Account[] };
  mandates: Mandate[];
  deposits: Deposit[];
}
interface PreviewResult {
  ok: boolean;
  totalBps?: number;
  error?: string;
  allocations?: { destinationAccountId: string; amount: string }[];
}

export default function OperatorMandatePage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");
  const { getAccessToken } = usePrivy();
  const [bps, setBps] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const accounts = data?.business.accounts ?? [];
  const totalHistoricalVolume = (data?.deposits ?? []).reduce((s, d) => s + BigInt(d.amount), 0n);

  // Seed an even draft split once accounts load — this is a fresh draft, not
  // "the current rule": the current live ratios live in Postgres, which this
  // dev environment can't reach, and the subgraph only ever carries a
  // mandate's hash, never its ratios (deliberately — see packages/core's
  // monitor.ts comment on why).
  useEffect(() => {
    if (accounts.length > 0 && Object.keys(bps).length === 0) {
      const even = Math.floor(10000 / accounts.length);
      const seeded: Record<string, number> = {};
      accounts.forEach((a, i) => {
        seeded[a.id] = i === accounts.length - 1 ? 10000 - even * (accounts.length - 1) : even;
      });
      setBps(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length]);

  useEffect(() => {
    if (Object.keys(bps).length === 0) return;
    const rules = Object.entries(bps).map(([destinationAccountId, v]) => ({ destinationAccountId, bps: v }));
    postOperator<PreviewResult>(
      "/api/operator/mandate",
      { rules, sampleAmount: (totalHistoricalVolume > 0n ? totalHistoricalVolume : 1_000_000n).toString() },
      getAccessToken
    ).then(setPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bps]);

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Split rules">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading accounts" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Split rules">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const total = Object.values(bps).reduce((s, v) => s + v, 0);
  const is100 = total === 10000;

  return (
    <AppFrame showTabBar headerTitle="Split rules" headerSubtitle="Draft — validated live against the real splitter">
      <div className="p-4 flex-1 flex flex-col gap-6 pb-28">
        <div className="flex flex-col gap-3">
          {accounts.map((a) => (
            <InputWell
              key={a.id}
              label={`${a.label} (${titleiseClass(a.class)}) — %`}
              type="number"
              value={((bps[a.id] ?? 0) / 100).toFixed(2)}
              onChange={(e) => setBps((s) => ({ ...s, [a.id]: Math.round(Number(e.target.value) * 100) }))}
            />
          ))}
        </div>

        <ClaySlab hero className={`p-6 flex flex-col gap-3 border-2 ${is100 ? "border-[#0A0A0A]" : "border-dashed border-[#A0A0A0]"}`}>
          <div className="flex justify-between items-center">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Running total</span>
            <StatusChip status={is100 ? "verified" : "pending"} label={is100 ? "100% — valid" : "must equal 100%"} />
          </div>
          <span className="font-mono text-[36px] font-bold text-[#0A0A0A]">{(total / 100).toFixed(2)}%</span>
          {preview && !preview.ok && (
            <p className="text-[12px] font-semibold text-[#0A0A0A]">{preview.error}</p>
          )}
        </ClaySlab>

        {preview?.ok && preview.allocations && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-[#7C7C7C] px-1">
              Projected against {fmtUsdc(totalHistoricalVolume)} of real historical deposits
            </span>
            <ClayWell className="p-4 flex flex-col gap-2 border border-[#DCDCDC]">
              {preview.allocations.map((al) => {
                const acc = accounts.find((a) => a.id === al.destinationAccountId);
                return (
                  <div key={al.destinationAccountId} className="flex justify-between text-[13px] font-mono">
                    <span className="text-[#7C7C7C]">{acc?.label ?? al.destinationAccountId}</span>
                    <span className="font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(al.amount))}</span>
                  </div>
                );
              })}
            </ClayWell>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <span className="text-[12px] font-medium text-[#7C7C7C] px-1">Version history</span>
          {data.mandates.length === 0 && (
            <ClayWell className="p-4">
              <p className="text-[13px] text-[#5A5A5A]">No mandate has ever been published for this business.</p>
            </ClayWell>
          )}
          {[...data.mandates].reverse().map((m) => (
            <ClayWell key={m.version} className="p-3 flex items-center justify-between border border-[#DCDCDC]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-[#0A0A0A]">Version {m.version}</span>
                <span className="text-[11px] font-mono text-[#7C7C7C]">{m.rulesHash.slice(0, 14)}…</span>
              </div>
              <ExplorerLink type="tx" value={m.txHash} />
            </ClayWell>
          ))}
        </div>

        <ClayWell className="p-4">
          <p className="text-[13px] text-[#5A5A5A] leading-normal">
            Publishing needs three of five key-quorum signatures — a browser session can validate and
            preview a draft, exactly as above, but cannot produce those signatures itself.
          </p>
        </ClayWell>
      </div>
    </AppFrame>
  );
}
