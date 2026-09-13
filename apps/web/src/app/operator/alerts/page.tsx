"use client";

import { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { LoadingState } from "@/components/ui/States";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { DesktopTopNav } from "@/components/desktop/DesktopTopNav";
import { useOperatorData } from "@/lib/useOperatorData";

interface Finding {
  kind: string;
  severity: "INFO" | "WARNING" | "SEVERE";
  title: string;
  message: string;
  fingerprint: string;
}
interface BusinessData {
  found: boolean;
  findings: Finding[];
  indexedAtBlock: string;
}

export default function OperatorAlertsPage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");
  const [investigated, setInvestigated] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Alerts">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Running checks" detail="Same checks the public page and the Monitor run…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Alerts">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  // Built once, laid out two ways below — stacked on mobile, a grid on desktop.
  const findingCards = data.findings.map((f) => {
    const done = investigated.has(f.fingerprint);
    return (
      <ClaySlab
        key={f.fingerprint}
        hero={!done}
        className={`p-4 flex flex-col gap-3 ${f.severity === "SEVERE" && !done ? "border-2 border-[#0A0A0A]" : ""}`}
      >
        <div className="flex items-center justify-between">
          <StatusChip
            status={done ? "verified" : f.severity === "SEVERE" ? "severe" : "pending"}
            label={done ? "Investigated" : f.severity === "SEVERE" ? "Severe" : f.severity === "WARNING" ? "Warning" : "Info"}
          />
        </div>
        <h3 className="text-[15px] font-semibold text-[#0A0A0A]">{f.title}</h3>
        <p className="text-[13px] text-[#5A5A5A] leading-normal">{f.message}</p>
        {!done && (
          <Button variant="secondary" onClick={() => setInvestigated((s) => new Set(s).add(f.fingerprint))}>
            Mark as investigated
          </Button>
        )}
      </ClaySlab>
    );
  });

  const desktop = (
    <DesktopShell nav={<DesktopTopNav />}>
      <div className="flex items-center justify-between pb-6">
        <h1 className="text-[26px] font-semibold text-[#0A0A0A]">Alerts</h1>
        <span className="text-[13px] text-[#7C7C7C]">As of block {data.indexedAtBlock}</span>
      </div>
      {findingCards.length === 0 && (
        <ClayWell className="p-4">
          <p className="text-[13px] text-[#5A5A5A]">
            Nothing to look at. Recomputed from indexed history on every load.
          </p>
        </ClayWell>
      )}
      <div className="grid grid-cols-2 gap-4">{findingCards}</div>
    </DesktopShell>
  );

  return (
    <AppFrame showTabBar headerTitle="Alerts" headerSubtitle={`As of block ${data.indexedAtBlock}`} desktop={desktop}>
      <div className="p-4 flex-1 flex flex-col gap-5 pb-28">
        {findingCards.length === 0 && (
          <ClayWell className="p-4">
            <p className="text-[13px] text-[#5A5A5A]">
              Nothing to look at. Recomputed from indexed history on every load.
            </p>
          </ClayWell>
        )}

        <div className="flex flex-col gap-4">{findingCards}</div>
      </div>
    </AppFrame>
  );
}
