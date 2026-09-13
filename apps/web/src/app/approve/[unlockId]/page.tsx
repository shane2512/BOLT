"use client";

import React, { use, useEffect, useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult } from "@worldcoin/idkit";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { RawRefusalSpecimen } from "@/components/ui/RawRefusalSpecimen";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc, titleiseClass } from "@/lib/format";

interface Ceremony {
  found: boolean;
  id: string;
  account: { label: string; class: string; address: string };
  amount: string;
  destination: string;
  reason: string;
  reasonHash: string;
  status: "REQUESTED" | "EXECUTED" | "CANCELLED";
  approvals: { approver: string; humanProofRef: string; txHash: string }[];
  approvalCount: number;
  requestedTx: string | null;
  quorum: { threshold: number; size: number } | null;
  approverIds: string[];
}

interface RpSignature {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging" | "sandbox";
}

interface UnlockApprovalPageProps {
  params: Promise<{ unlockId: string }>;
}

export default function UnlockApprovalPage({ params }: UnlockApprovalPageProps) {
  const { unlockId } = use(params);

  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<string>("");

  const [rpSignature, setRpSignature] = useState<RpSignature | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedResult, setApprovedResult] = useState<{
    approved: boolean;
    approvals?: number;
    threshold?: number;
    humanProofRef?: string;
    approvedTx?: string;
  } | null>(null);
  const [rawFailure, setRawFailure] = useState<unknown | null>(null);

  useEffect(() => {
    fetch(`/api/unlock/${unlockId}`)
      .then((r) => r.json())
      .then((json: Ceremony) => {
        if (!json.found) {
          setLoadError(`No unlock ceremony on record for ${unlockId}.`);
          return;
        }
        setCeremony(json);
        if (json.approverIds.length > 0) setApproverId(json.approverIds[0]!);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockId]);

  const openSelfieCheck = async () => {
    setApproving(true);
    setRawFailure(null);
    setApprovedResult(null);
    try {
      const rpRes = await fetch("/api/world/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "unlock-approval" })
      });
      const rpJson: RpSignature = await rpRes.json();
      if (!rpRes.ok) throw new Error((rpJson as unknown as { error?: string }).error || `HTTP ${rpRes.status}`);
      setRpSignature(rpJson);
      setWidgetOpen(true);
    } catch (err) {
      setRawFailure(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  const submitApproval = async (idkitResult: IDKitResult) => {
    const res = await fetch(`/api/unlock/${unlockId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approverId, idkitResult })
    });
    const json = await res.json();
    if (res.ok && json.approved) {
      setApprovedResult(json);
    } else {
      setRawFailure(json.error || json);
      // handleVerify must throw for the widget to show its own failure state.
      throw new Error(json.error || "Approval failed");
    }
  };

  if (loadError) {
    return (
      <AppFrame headerTitle="Unlock ceremony">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{loadError}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  if (!ceremony) {
    return (
      <AppFrame headerTitle="Unlock ceremony">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading the ceremony" detail="Fetching from the workflow store and the subgraph…" />
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <div className="p-4 flex-1 flex flex-col justify-between pb-8">
        <div className="flex flex-col gap-5 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Quorum authorization</span>
            <StatusChip
              status={ceremony.status === "EXECUTED" ? "signed" : "pending"}
              label={ceremony.status === "EXECUTED" ? "Executed" : "Decision required"}
            />
          </div>

          <h1 className="text-[26px] font-semibold leading-[32px] text-[#0A0A0A]">
            Authorize early release
          </h1>

          <ClaySlab hero className="p-5 flex flex-col gap-3">
            <ValueAndSource amount={fmtUsdc(BigInt(ceremony.amount))} label="Release amount" size="hero" />
            <div className="groove-line my-1" />
            <div className="flex flex-col gap-2">
              <ClayWell className="p-3 flex justify-between items-center text-[12px] border border-[#DCDCDC]">
                <span className="text-[#7C7C7C] font-medium">From ({titleiseClass(ceremony.account.class)})</span>
                <ExplorerLink type="address" value={ceremony.account.address} />
              </ClayWell>
              <ClayWell className="p-3 flex justify-between items-center text-[12px] border border-[#DCDCDC]">
                <span className="text-[#7C7C7C] font-medium">To</span>
                <ExplorerLink type="address" value={ceremony.destination} />
              </ClayWell>
            </div>
          </ClaySlab>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[#7C7C7C] px-1">Reason, and its on-chain hash</span>
            <ClayWell className="p-4 border border-[#0A0A0A] flex flex-col gap-2">
              <p className="text-[14px] font-medium text-[#0A0A0A] leading-relaxed">{ceremony.reason}</p>
              <div className="pt-2 border-t border-[#DCDCDC] flex justify-between items-center text-[11px] font-mono">
                <span className="text-[#7C7C7C]">hash</span>
                <span className="font-bold text-[#0A0A0A]">{ceremony.reasonHash.slice(0, 16)}…</span>
              </div>
            </ClayWell>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-[#7C7C7C] px-1">
              {ceremony.quorum
                ? `Approvals — ${ceremony.approvalCount} of ${ceremony.quorum.threshold} needed`
                : `Approvals so far — ${ceremony.approvalCount}`}
            </span>
            {ceremony.approvals.length === 0 && (
              <ClayWell className="p-3 border border-[#DCDCDC]">
                <p className="text-[13px] text-[#5A5A5A]">No approvals recorded yet.</p>
              </ClayWell>
            )}
            {ceremony.approvals.map((a) => (
              <div key={a.txHash} className="p-3 rounded-xl bg-[#EFEFEF] border border-[#DCDCDC] flex items-center justify-between text-[13px]">
                <ExplorerLink type="address" value={a.approver} />
                <StatusChip status="signed" label="Approved" />
              </div>
            ))}
          </div>

          {ceremony.approverIds.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[#7C7C7C] px-1">Approving as</span>
              <div className="grid grid-cols-2 gap-2">
                {ceremony.approverIds.map((aid) => (
                  <button
                    key={aid}
                    type="button"
                    onClick={() => setApproverId(aid)}
                    className={`p-3 rounded-2xl text-left border ${
                      approverId === aid ? "clay-well-pressed bg-[#EFEFEF] border-2 border-[#0A0A0A]" : "clay-slab bg-white border-[#DCDCDC]"
                    }`}
                  >
                    <span className="text-[13px] font-bold text-[#0A0A0A]">{aid}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {Boolean(rawFailure) && <RawRefusalSpecimen error={rawFailure} title="Selfie Check or quorum refusal" />}

          {approvedResult?.approved && (
            <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A] flex flex-col gap-2">
              <StatusChip status="signed" label="Signature recorded" />
              <p className="text-[14px] font-bold text-[#0A0A0A]">
                Recorded on-chain
                {typeof approvedResult.approvals === "number" && typeof approvedResult.threshold === "number"
                  ? ` — ${approvedResult.approvals} of ${approvedResult.threshold}.`
                  : "."}
              </p>
              {approvedResult.approvedTx && <ExplorerLink type="tx" value={approvedResult.approvedTx} label="View on Arc" />}
            </ClayWell>
          )}
        </div>

        {!approvedResult?.approved && (
          <Button
            variant="primary"
            onClick={openSelfieCheck}
            loading={approving && !rpSignature}
            disabled={!approverId || ceremony.status !== "REQUESTED"}
          >
            Verify with Selfie Check & approve
          </Button>
        )}

        {rpSignature && (
          <IDKitRequestWidget
            open={widgetOpen}
            onOpenChange={setWidgetOpen}
            app_id={rpSignature.app_id}
            action={rpSignature.action}
            environment={rpSignature.environment}
            rp_context={{
              rp_id: rpSignature.rp_id,
              nonce: rpSignature.nonce,
              created_at: rpSignature.created_at,
              expires_at: rpSignature.expires_at,
              signature: rpSignature.sig
            }}
            allow_legacy_proofs
            preset={selfieCheckLegacy({ signal: unlockId })}
            handleVerify={submitApproval}
            onSuccess={() => {
              setWidgetOpen(false);
              setApproving(false);
            }}
            onError={(errorCode, debugReport) => {
              setRawFailure({ errorCode, debugReport });
              setWidgetOpen(false);
              setApproving(false);
            }}
          />
        )}
      </div>
    </AppFrame>
  );
}
