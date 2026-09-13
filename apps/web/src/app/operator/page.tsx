"use client";

import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { StatusChip } from "@/components/ui/StatusChip";
import { LoadingState } from "@/components/ui/States";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { DesktopTopNav } from "@/components/desktop/DesktopTopNav";
import { fmtUsdc, fmtBps, titleiseClass } from "@/lib/format";
import { useOperatorData } from "@/lib/useOperatorData";

interface CoverageRow {
  class: "CLIENT_MONEY" | "OBLIGATION_RESERVE" | "OPERATING";
  held: string;
  owed: string;
  ratioBps: string;
}
interface Finding {
  severity: "INFO" | "WARNING" | "SEVERE";
  title: string;
  message: string;
}
interface Unlock {
  id: string;
  account: { label: string };
  amount: string;
  status: "REQUESTED" | "EXECUTED" | "CANCELLED";
  approvalCount: number;
}
interface BusinessData {
  found: boolean;
  indexedAtBlock: string;
  latestCoverage: CoverageRow[];
  unlocks: Unlock[];
  findings: Finding[];
}

// The demo's key quorum is 3-of-5 throughout this project; the subgraph
// carries each unlock's approval count but not its threshold, so this is a
// documented constant for this deployment, not a fetched value.
const QUORUM_THRESHOLD = 3;

export default function OperatorCoveragePage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Coverage">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading indexed history" detail="Fetching coverage from the subgraph…" />
        </div>
      </AppFrame>
    );
  }

  if (error) {
    return (
      <AppFrame showTabBar headerTitle="Coverage">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  if (!data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Coverage">
        <div className="p-4">
          <ClayWell variant="standard" className="p-4">
            <p className="text-[13px] text-[#5A5A5A]">This business is not indexed yet.</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const totalHeld = data.latestCoverage.reduce((s, c) => s + BigInt(c.held), 0n);
  const totalOwed = data.latestCoverage.reduce((s, c) => s + BigInt(c.owed), 0n);
  const overallBps = totalOwed > 0n ? (totalHeld * 10000n) / totalOwed : 10000n;
  const severeFinding = data.findings.find((f) => f.severity === "SEVERE");
  const openCeremony = data.unlocks.find((u) => u.status === "REQUESTED");
  const block = Number(data.indexedAtBlock).toLocaleString("en-US");

  const desktop = (
    <DesktopShell nav={<DesktopTopNav />}>
      <div className="flex items-center justify-between pb-6">
        <div>
          <h1 className="text-[26px] font-semibold text-[#0A0A0A]">Coverage</h1>
          <p className="text-[13px] text-[#7C7C7C] mt-1">Block {block}</p>
        </div>
        <StatusChip status={overallBps >= 10000n ? "covered" : "refused"} label={`${fmtBps(overallBps)} covered`} />
      </div>

      {severeFinding && (
        <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A] flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <StatusChip status="severe" label="Severe finding" />
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{severeFinding.title}</p>
          </div>
          <Link href="/operator/alerts" className="text-[12px] font-semibold text-[#0A0A0A] underline shrink-0">
            Investigate in alerts
          </Link>
        </ClayWell>
      )}

      <ClaySlab hero className="p-6 mb-6">
        <ValueAndSource
          amount={fmtUsdc(totalHeld)}
          label="Total held across all classes"
          sourceType="block"
          sourceValue={data.indexedAtBlock}
          sourceLabel="indexed at block"
          size="hero"
        />
      </ClaySlab>

      {openCeremony && (
        <ClaySlab className="p-4 flex items-center justify-between gap-4 border-2 border-[#0A0A0A] mb-6">
          <div className="flex items-center gap-4">
            <span className="w-2 h-2 rounded-full bg-[#0A0A0A]" />
            <span className="text-[13px] font-semibold text-[#0A0A0A]">{openCeremony.account.label}</span>
            <span className="font-mono text-[15px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(openCeremony.amount))}</span>
            <StatusChip status="pending" label={`${openCeremony.approvalCount}/${QUORUM_THRESHOLD} approved`} />
          </div>
          <Link href="/operator/approvals" className="text-[12px] font-semibold text-[#0A0A0A] underline shrink-0">
            View ceremony
          </Link>
        </ClaySlab>
      )}

      <span className="text-[13px] font-medium text-[#7C7C7C]">By account class</span>
      <div className="grid grid-cols-3 gap-4 mt-3">
        {data.latestCoverage.map((row) => {
          const locked = row.class !== "OPERATING";
          const Surface = locked ? ClayWell : ClaySlab;
          return (
            <Surface key={row.class} className="p-5 flex flex-col gap-3 border border-[#DCDCDC]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${locked ? "bg-[#0A0A0A]" : "border border-[#0A0A0A]"}`} />
                  <span className="text-[14px] font-semibold text-[#0A0A0A]">{titleiseClass(row.class)}</span>
                </div>
                <StatusChip status={locked ? "covered" : "pending"} label={locked ? "Locked" : "Spendable"} />
              </div>
              <div>
                <span className="text-[12px] text-[#7C7C7C] block">Held</span>
                <span className="font-mono text-[20px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(row.held))}</span>
              </div>
              <div>
                <span className="text-[12px] text-[#7C7C7C] block">Owed</span>
                <span className="font-mono text-[15px] text-[#5A5A5A]">{fmtUsdc(BigInt(row.owed))}</span>
              </div>
            </Surface>
          );
        })}
      </div>
    </DesktopShell>
  );

  return (
    <AppFrame showTabBar headerTitle="Coverage" headerSubtitle={`Block ${block}`} desktop={desktop}>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-28">
        {severeFinding && (
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <StatusChip status="severe" label="Severe finding" />
            </div>
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{severeFinding.title}</p>
            <Link href="/operator/alerts" className="pt-1">
              <span className="text-[12px] font-semibold text-[#0A0A0A] underline">Investigate in alerts</span>
            </Link>
          </ClayWell>
        )}

        <ClaySlab hero className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Solvency ratio</span>
            <StatusChip status={overallBps >= 10000n ? "covered" : "refused"} label={`${fmtBps(overallBps)} covered`} />
          </div>
          <ValueAndSource
            amount={fmtUsdc(totalHeld)}
            label="Total held across all classes"
            sourceType="block"
            sourceValue={data.indexedAtBlock}
            sourceLabel="indexed at block"
            size="hero"
          />
        </ClaySlab>

        {openCeremony && (
          <ClaySlab className="p-4 flex flex-col gap-3 border-2 border-[#0A0A0A]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#7C7C7C] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#0A0A0A]" />
                Open unlock ceremony
              </span>
              <StatusChip status="pending" label={`${openCeremony.approvalCount}/${QUORUM_THRESHOLD} approved`} />
            </div>
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-[13px] font-semibold text-[#0A0A0A]">{openCeremony.account.label}</span>
              <span className="text-[16px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(openCeremony.amount))}</span>
            </div>
            <Link href="/operator/approvals" className="text-[12px] font-semibold text-[#0A0A0A] underline">
              View ceremony
            </Link>
          </ClaySlab>
        )}

        <div className="flex flex-col gap-3">
          <span className="text-[12px] font-medium text-[#7C7C7C] px-1">By account class</span>
          {data.latestCoverage.map((row) => {
            const locked = row.class !== "OPERATING";
            const rowContent = (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${locked ? "bg-[#0A0A0A]" : "border border-[#0A0A0A]"}`} />
                    <span className="text-[14px] font-semibold text-[#0A0A0A]">{titleiseClass(row.class)}</span>
                  </div>
                  <StatusChip status={locked ? "covered" : "pending"} label={locked ? "Locked" : "Spendable"} />
                </div>
                <div className="flex justify-between items-baseline pt-1">
                  <span className="text-[12px] text-[#7C7C7C]">Held:</span>
                  <span className="font-mono text-[16px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(row.held))}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[12px] text-[#7C7C7C]">Owed:</span>
                  <span className="font-mono text-[14px] text-[#5A5A5A]">{fmtUsdc(BigInt(row.owed))}</span>
                </div>
              </>
            );
            return locked ? (
              <ClayWell key={row.class} className="p-4 flex flex-col gap-2 border border-[#DCDCDC]">
                {rowContent}
              </ClayWell>
            ) : (
              <ClaySlab key={row.class} className="p-4 flex flex-col gap-2 border border-black/10">
                {rowContent}
              </ClaySlab>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
