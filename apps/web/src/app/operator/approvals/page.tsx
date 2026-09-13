"use client";

import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc, shortAddress } from "@/lib/format";
import { useOperatorData } from "@/lib/useOperatorData";

interface Approval {
  approver: string;
  humanProofRef: string;
  timestamp: string;
  txHash: string;
}
interface Unlock {
  id: string;
  account: { label: string };
  amount: string;
  destination: string;
  reasonHash: string;
  status: "REQUESTED" | "EXECUTED" | "CANCELLED";
  approvalCount: number;
  requestedAtBlock: string;
  requestedTx: string;
  approvals: Approval[];
}
interface BusinessData {
  found: boolean;
  unlocks: Unlock[];
}

// This deployment's key quorum is 3-of-5 — see operator/page.tsx for why this
// is a documented constant rather than a fetched value.
const QUORUM_THRESHOLD = 3;

export default function OperatorApprovalsPage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Approvals">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading ceremonies" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Approvals">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const open = data.unlocks.filter((u) => u.status === "REQUESTED");
  const past = data.unlocks.filter((u) => u.status !== "REQUESTED");

  return (
    <AppFrame showTabBar headerTitle="Approvals" headerSubtitle={`${open.length} open`}>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-28">
        <ClayWell className="p-3.5 border border-[#0A0A0A]">
          <p className="text-[12px] font-medium text-[#0A0A0A]">
            Every approval appears on the public page within a minute.
          </p>
        </ClayWell>

        {[...open, ...past].length === 0 && (
          <ClayWell className="p-4">
            <p className="text-[13px] text-[#5A5A5A]">No unlock ceremonies have ever been opened.</p>
          </ClayWell>
        )}

        {[...open, ...past].map((u) => (
          <ClaySlab
            key={u.id}
            hero={u.status === "REQUESTED"}
            className={`p-5 flex flex-col gap-4 ${u.status === "REQUESTED" ? "border-2 border-[#0A0A0A]" : "border border-black/10"}`}
          >
            <div className="flex items-center justify-between">
              <StatusChip
                status={u.status === "EXECUTED" ? "signed" : u.status === "CANCELLED" ? "refused" : "pending"}
                label={`${u.approvalCount}/${QUORUM_THRESHOLD} · ${u.status.toLowerCase()}`}
              />
            </div>

            <div className="flex justify-between items-baseline">
              <div>
                <span className="text-[12px] text-[#7C7C7C] block">Account</span>
                <h2 className="text-[16px] font-semibold text-[#0A0A0A]">{u.account.label}</h2>
              </div>
              <span className="font-mono text-[20px] font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(u.amount))}</span>
            </div>

            <div className="flex justify-between items-center text-[12px]">
              <span className="text-[#7C7C7C]">Destination:</span>
              <ExplorerLink type="address" value={u.destination} />
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-black/10">
              <span className="text-[12px] font-medium text-[#7C7C7C]">Approvals recorded on chain</span>
              {u.approvals.length === 0 && <p className="text-[12px] text-[#7C7C7C]">None yet.</p>}
              {u.approvals.map((a, i) => (
                <div key={i} className="p-3 rounded-xl flex items-center justify-between border border-[#0A0A0A] bg-[#EFEFEF]">
                  <div className="flex flex-col">
                    <span className="font-mono text-[12px] font-semibold text-[#0A0A0A]">{shortAddress(a.approver)}</span>
                    <span className="font-mono text-[10px] text-[#7C7C7C]">proof {a.humanProofRef.slice(0, 10)}…</span>
                  </div>
                  <ExplorerLink type="tx" value={a.txHash} label="tx" />
                </div>
              ))}
            </div>

            {u.status === "REQUESTED" && (
              <Link href={`/approve/${u.id}`} className="w-full">
                <Button variant="secondary">Open phone approval view</Button>
              </Link>
            )}
          </ClaySlab>
        ))}
      </div>
    </AppFrame>
  );
}
