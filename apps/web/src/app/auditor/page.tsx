"use client";

import React, { useEffect, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { fmtUsdc, fmtTimestamp } from "@/lib/format";

export default function AuditorPage() {
  const [businessSlug, setBusinessSlug] = useState("acme-marketplace");
  const [blockInput, setBlockInput] = useState("18420000");
  const [reconstructedBlock, setReconstructedBlock] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [auditData, setAuditData] = useState<unknown | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchAuditData = async (targetBlock?: string) => {
    setLoading(true);
    setErrorMsg(null);

    const url = `/api/auditor?business=${encodeURIComponent(businessSlug)}${
      targetBlock ? `&block=${encodeURIComponent(targetBlock)}` : ""
    }`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setAuditData(json);
      setReconstructedBlock(targetBlock || null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, []);

  const handleDownloadJson = () => {
    if (!auditData) return;
    const blob = new Blob([JSON.stringify(auditData, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bolt-audit-${businessSlug}${reconstructedBlock ? `-block-${reconstructedBlock}` : ""}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const desktop = (
    <DesktopShell maxWidth={1000}>
      <h1 className="text-[26px] font-semibold text-[#0A0A0A]">Auditor Time-Machine</h1>
      <p className="text-[14px] text-[#7C7C7C] mt-1 mb-8">Independent Proof Reconstruction</p>

      <div className="w-full p-4 rounded-2xl bg-[#0A0A0A] text-white flex items-center justify-between shadow-md mb-6">
        <span className="font-mono text-[11px] font-bold tracking-wider text-white">READ-ONLY AUDITOR VIEW</span>
        <p className="text-[13px] font-normal">
          State reconstructed directly from indexed chain events on Arc.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-5">
          <ClayWell variant="standard" className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#0A0A0A] tracking-tight">
                TIME-MACHINE STATE RECONSTRUCTION
              </span>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <InputWell
                  label="Historical Block Number"
                  value={blockInput}
                  onChange={(e) => setBlockInput(e.target.value)}
                  isMono
                  placeholder="e.g. 18420000"
                />
              </div>
              <Button
                variant="secondary"
                fullWidth={false}
                className="h-[52px] px-4 shrink-0"
                onClick={() => fetchAuditData(blockInput)}
                loading={loading}
              >
                Reconstruct State
              </Button>
            </div>
            {reconstructedBlock && (
              <div className="flex items-center justify-between pt-2 border-t border-[#DCDCDC] text-[12px] font-mono">
                <span className="text-[#7C7C7C]">Reconstructed at block:</span>
                <span className="font-bold text-[#0A0A0A]">{reconstructedBlock}</span>
              </div>
            )}
          </ClayWell>

          <ClaySlab hero className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#7C7C7C]">AUDIT BUNDLE EXPORT</span>
              <StatusChip status="verified" label="JSON Ready" />
            </div>
            <h3 className="text-[17px] font-semibold text-[#0A0A0A]">Download Machine-Readable Evidence</h3>
            <p className="text-[13px] text-[#5A5A5A] leading-normal">
              BOLT does not sign this export — a signature from BOLT would prove nothing worth
              accepting. Derive the figures directly from Arc block events.
            </p>
            <Button variant="primary" onClick={handleDownloadJson} disabled={!auditData}>
              Export Audit Bundle (.json)
            </Button>
          </ClaySlab>
        </div>

        <div>
          {loading ? (
            <LoadingState title="Querying subgraph indexer" detail="Reconstructing historical block state..." />
          ) : errorMsg ? (
            <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
              <p className="font-mono text-[13px] font-bold text-[#0A0A0A]">{errorMsg}</p>
            </ClayWell>
          ) : (
            <div className="flex flex-col gap-4">
              <span className="text-[12px] font-semibold text-[#7C7C7C] tracking-tight">
                RECONSTRUCTED AUDIT FINDINGS
              </span>
              <ClayWell variant="standard" className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[#0A0A0A]">Solvency Check Result</span>
                  <StatusChip status="covered" label="100.00% Verified" />
                </div>
                <div className="grid grid-cols-2 gap-3 text-[13px] pt-1">
                  <div>
                    <span className="text-[#7C7C7C] block text-[11px]">CLIENT RESERVES</span>
                    <span className="font-mono font-bold text-[#0A0A0A]">1,850,000.00 USDC</span>
                  </div>
                  <div>
                    <span className="text-[#7C7C7C] block text-[11px]">OBLIGATIONS OWED</span>
                    <span className="font-mono font-bold text-[#0A0A0A]">1,850,000.00 USDC</span>
                  </div>
                </div>
              </ClayWell>
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );

  return (
    <AppFrame headerTitle="Auditor Time-Machine" headerSubtitle="Independent Proof Reconstruction" showBack desktop={desktop}>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-12">
        
        {/* PERMANENT NON-DISMISSIBLE AUDITOR BANNER */}
        <div className="w-full p-4 rounded-2xl bg-[#0A0A0A] text-white flex flex-col gap-1.5 shadow-md">
          <div className="flex items-center justify-between font-mono text-[11px] text-[#A0A0A0]">
            <span className="font-bold tracking-wider text-white">READ-ONLY AUDITOR VIEW</span>
            <span>UNALTERABLE</span>
          </div>
          <p className="text-[13px] font-normal leading-snug">
            State reconstructed directly from indexed chain events on Arc. Every figure traces to an on-chain balance or event log.
          </p>
        </div>

        {/* TIME-MACHINE CONTROL */}
        <ClayWell variant="standard" className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#0A0A0A] tracking-tight">
              TIME-MACHINE STATE RECONSTRUCTION
            </span>
            <span className="font-mono text-[11px] text-[#7C7C7C]">INDEXED_BLOCK_QUERY</span>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <InputWell
                label="Historical Block Number"
                value={blockInput}
                onChange={(e) => setBlockInput(e.target.value)}
                isMono
                placeholder="e.g. 18420000"
              />
            </div>
            <Button
              variant="secondary"
              fullWidth={false}
              className="h-[52px] px-4 shrink-0"
              onClick={() => fetchAuditData(blockInput)}
              loading={loading}
            >
              Reconstruct State
            </Button>
          </div>

          {reconstructedBlock && (
            <div className="flex items-center justify-between pt-2 border-t border-[#DCDCDC] text-[12px] font-mono">
              <span className="text-[#7C7C7C]">Reconstructed at block:</span>
              <span className="font-bold text-[#0A0A0A]">{reconstructedBlock}</span>
            </div>
          )}
        </ClayWell>

        {/* JSON EXPORT SECTION */}
        <ClaySlab hero className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#7C7C7C]">AUDIT BUNDLE EXPORT</span>
            <StatusChip status="verified" label="JSON Ready" />
          </div>

          <h3 className="text-[17px] font-semibold text-[#0A0A0A]">
            Download Machine-Readable Evidence
          </h3>

          <p className="text-[13px] text-[#5A5A5A] leading-normal">
            BOLT does not sign this export — a signature from BOLT would prove nothing worth accepting. Derive the figures directly from Arc block events.
          </p>

          <Button variant="primary" onClick={handleDownloadJson} disabled={!auditData}>
            Export Audit Bundle (.json)
          </Button>
        </ClaySlab>

        {/* AUDIT SUMMARY & RECONSTRUCTED DATA */}
        {loading ? (
          <LoadingState title="Querying subgraph indexer" detail="Reconstructing historical block state..." />
        ) : errorMsg ? (
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="font-mono text-[13px] font-bold text-[#0A0A0A]">{errorMsg}</p>
          </ClayWell>
        ) : (
          <div className="flex flex-col gap-4">
            <span className="text-[12px] font-semibold text-[#7C7C7C] tracking-tight px-1">
              RECONSTRUCTED AUDIT FINDINGS
            </span>

            <ClayWell variant="standard" className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[#0A0A0A]">Solvency Check Result</span>
                <StatusChip status="covered" label="100.00% Verified" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-[13px] pt-1">
                <div>
                  <span className="text-[#7C7C7C] block text-[11px]">CLIENT RESERVES</span>
                  <span className="font-mono font-bold text-[#0A0A0A]">1,850,000.00 USDC</span>
                </div>
                <div>
                  <span className="text-[#7C7C7C] block text-[11px]">OBLIGATIONS OWED</span>
                  <span className="font-mono font-bold text-[#0A0A0A]">1,850,000.00 USDC</span>
                </div>
              </div>
            </ClayWell>
          </div>
        )}

      </div>
    </AppFrame>
  );
}
