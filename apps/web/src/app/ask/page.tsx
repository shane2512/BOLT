"use client";

import React, { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

interface MonitorEvidence {
  blockNumber?: string | number;
  txHash?: string;
  account?: string;
  detail?: string;
}

interface AskResponse {
  answer?: string;
  evidence?: MonitorEvidence[];
  error?: string;
  detail?: string;
  monitorUrl?: string;
}

export default function AskMonitorPage() {
  const [question, setQuestion] = useState(
    "Is Acme's client money fully backed by USDC reserves at the current block?"
  );
  const [business] = useState("acme-marketplace");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [degradedState, setDegradedState] = useState<"unreachable" | "degraded" | null>(null);

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setResult(null);
    setDegradedState(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business, question })
      });

      const json: AskResponse = await res.json();

      if (res.status === 502 && json.error === "monitor_unreachable") {
        setDegradedState("unreachable");
        setResult(json);
      } else if (res.status === 503) {
        setDegradedState("degraded");
        setResult(json);
      } else {
        setResult(json);
      }
    } catch (err) {
      setDegradedState("unreachable");
      setResult({
        error: "monitor_unreachable",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppFrame headerTitle="Ask the Monitor" headerSubtitle="Live LLM-backed Solvency Monitor" showBack>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-12">
        
        {/* Intro Instrument Header */}
        <ClayWell variant="standard" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#0A0A0A]" />
            <span className="text-[12px] font-medium text-[#5A5A5A]">
              Reads the same indexed history the public page does
            </span>
          </div>
          <p className="text-[14px] text-[#5A5A5A] leading-normal">
            Queries indexed Arc block events to answer natural-language solvency questions. Every response cites verifiable on-chain block evidence.
          </p>
        </ClayWell>

        {/* Question Input Form */}
        <div className="flex flex-col gap-3">
          <InputWell
            label="Question for Solvency Monitor"
            caption="Ask about account reserves, coverage ratios, past unlocks or policy events."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Is client money 100% covered?"
          />

          <Button
            variant="primary"
            onClick={handleAsk}
            loading={loading}
            disabled={!question.trim()}
          >
            Ask Solvency Monitor
          </Button>
        </div>

        {/* Answer Output */}
        {result && (
          <div className="flex flex-col gap-4">
            
            {/* Degraded State 1: Monitor Unreachable (502) */}
            {degradedState === "unreachable" && (
              <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A] flex flex-col gap-3">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#0A0A0A]">
                  <span className="font-bold">STATUS: MONITOR_UNREACHABLE</span>
                  <span>502 BAD GATEWAY</span>
                </div>
                <p className="text-[14px] font-medium text-[#0A0A0A] leading-normal">
                  The Solvency Monitor agent process is not currently reachable at <code className="font-mono text-[12px] font-bold bg-white px-1 py-0.5 border border-[#C4C4C4]">{result.monitorUrl || "http://localhost:4000"}</code>.
                </p>
                <div className="bg-white p-3 rounded-xl border border-[#C4C4C4] flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-[#7C7C7C] font-semibold">TO START THE MONITOR PROCESS:</span>
                  <code className="font-mono text-[13px] font-bold text-[#0A0A0A]">pnpm monitor:dev</code>
                </div>
              </ClayWell>
            )}

            {/* Degraded State 2: Reasoning Unavailable but Evidence Bundle Returned (503) */}
            {degradedState === "degraded" && (
              <ClayWell variant="standard" className="p-4 border border-[#0A0A0A] flex flex-col gap-3">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#5A5A5A]">
                  <span className="font-semibold text-[#0A0A0A]">STATUS: REASONING_UNAVAILABLE</span>
                  <span>503 MODEL_KEY_UNSET</span>
                </div>
                <p className="text-[14px] text-[#5A5A5A]">
                  LLM reasoning API key is not configured, but the raw on-chain evidence bundle was retrieved directly from the indexer:
                </p>
              </ClayWell>
            )}

            {/* Normal Prose Answer */}
            {result.answer && (
              <ClaySlab hero className="p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#EFEFEF] pb-2">
                  <span className="text-[12px] font-semibold text-[#0A0A0A] tracking-tight">
                    MONITOR ANSWER
                  </span>
                  <span className="font-mono text-[11px] text-[#7C7C7C]">CITED_FROM_ARC_BLOCKS</span>
                </div>

                <div className="text-[15px] leading-[24px] font-normal text-[#0A0A0A] whitespace-pre-wrap">
                  {result.answer}
                </div>
              </ClaySlab>
            )}

            {/* Cited On-Chain Evidence List */}
            {result.evidence && result.evidence.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-[#7C7C7C] tracking-tight px-1">
                  CITED ON-CHAIN EVIDENCE ({result.evidence.length})
                </span>

                <div className="flex flex-col gap-2">
                  {result.evidence.map((ev, idx) => (
                    <ClayWell key={idx} variant="standard" className="p-3 flex flex-col gap-1 border border-[#DCDCDC]">
                      <div className="flex items-center justify-between font-mono text-[12px]">
                        {ev.blockNumber && (
                          <div className="flex items-center gap-1">
                            <span className="text-[#7C7C7C]">Block:</span>
                            <ExplorerLink type="block" value={String(ev.blockNumber)} />
                          </div>
                        )}
                        {ev.txHash && (
                          <div className="flex items-center gap-1">
                            <span className="text-[#7C7C7C]">Tx:</span>
                            <ExplorerLink type="tx" value={ev.txHash} />
                          </div>
                        )}
                      </div>
                      {ev.detail && (
                        <p className="text-[13px] text-[#5A5A5A] leading-normal pt-1 font-sans">
                          {ev.detail}
                        </p>
                      )}
                    </ClayWell>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </AppFrame>
  );
}
