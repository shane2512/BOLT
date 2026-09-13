"use client";

import React, { useEffect, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { RawRefusalSpecimen } from "@/components/ui/RawRefusalSpecimen";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc } from "@/lib/format";

interface AttackOption {
  id: string;
  label: string;
  expect: string;
  stoppedBy: string;
  usesDestination?: boolean;
}

interface SandboxAccount {
  name: string;
  address: string;
  permittedPayee: string;
  policyHash: string;
  policyId: string;
}

interface SimulatorState {
  sandbox: { account: SandboxAccount; usdcAddress: string; permittedPayee: string };
  attacks: AttackOption[];
  tally: { attempts: number; refusals: number; allowed: number };
  balanceWei: string | null;
}

export default function SimulatorPage() {
  const [data, setData] = useState<SimulatorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAttackId, setSelectedAttackId] = useState<string>("");
  const [destination, setDestination] = useState<string>("0x3C44CdD05aB50714653641C061C3f07a7E663B2e");
  const [executing, setExecuting] = useState(false);
  const [rawResult, setRawResult] = useState<unknown | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchState = async () => {
    try {
      const res = await fetch("/api/simulator");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.attacks && json.attacks.length > 0 && !selectedAttackId) {
        setSelectedAttackId(json.attacks[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  const handleExecuteAttack = async () => {
    if (!selectedAttackId) return;
    setExecuting(true);
    setErrorMsg(null);
    setRawResult(null);

    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attackId: selectedAttackId,
          destination
        })
      });

      const json = await res.json();
      if (!res.ok && !json.rawError) {
        setErrorMsg(json.error || `HTTP ${res.status}`);
      } else {
        setRawResult(json.rawError || json);
        if (json.tally && data) {
          setData({ ...data, tally: json.tally });
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <AppFrame headerTitle="Breach Simulator" showBack>
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Connecting to sandbox enclave" detail="Reading live account policy & balance..." />
        </div>
      </AppFrame>
    );
  }

  const account = data?.sandbox?.account;
  const permittedPayee = data?.sandbox?.permittedPayee;
  const tally = data?.tally || { attempts: 0, refusals: 0, allowed: 0 };
  // Arc's native USDC balance reads in 18-decimal wei; USDC itself is 6
  // decimals, so shift by the 12-decimal difference before formatting —
  // otherwise a real ~0.24 USDC balance renders as ~236 billion.
  const balanceUsdc = data?.balanceWei
    ? fmtUsdc(BigInt(data.balanceWei) / 1_000_000_000_000n)
    : null;

  return (
    <AppFrame headerTitle="Breach Simulator" headerSubtitle="Try to steal from a locked account" showBack>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-12">
        
        {/* Sandbox target account */}
        <ClayWell variant="standard" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#7C7C7C] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#0A0A0A]" />
              The account you are attacking
            </span>
            <span className="font-mono text-[11px] text-[#7C7C7C]">Arc testnet</span>
          </div>

          <div className="flex flex-col gap-2 font-mono text-[12px] pt-1">
            <div className="flex justify-between items-center">
              <span className="text-[#7C7C7C]">Account:</span>
              <ExplorerLink type="address" value={account?.address || "0x0000000000000000000000000000000000000000"} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#7C7C7C]">Permitted payee:</span>
              <ExplorerLink type="address" value={permittedPayee || "0x0000000000000000000000000000000000000000"} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#7C7C7C]">Policy hash:</span>
              <span className="font-mono text-[11px] text-[#0A0A0A] break-all">
                {account?.policyHash || "—"}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-[#DCDCDC]">
              <span className="text-[#7C7C7C] font-sans font-semibold">Live balance:</span>
              <span className="font-bold text-[#0A0A0A] font-mono text-[13px]">
                {balanceUsdc ?? "unavailable — Arc RPC did not answer"}
              </span>
            </div>
          </div>
        </ClayWell>

        {/* Free-Text Destination Input */}
        <div className="flex flex-col gap-1">
          <InputWell
            label="Unpermitted Destination Address (Free-Text)"
            caption="Passed straight to Privy enclave — no client allowlist, no sanity check."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            isMono
            placeholder="0x..."
          />
        </div>

        {/* Attack Vector List */}
        <div className="flex flex-col gap-3">
          <span className="text-[12px] font-medium text-[#7C7C7C] px-1">Pick an attack</span>

          <div className="flex flex-col gap-2">
            {data?.attacks.map((attack) => {
              const isSelected = selectedAttackId === attack.id;
              return (
                <button
                  key={attack.id}
                  type="button"
                  onClick={() => setSelectedAttackId(attack.id)}
                  className={`w-full text-left p-3.5 rounded-2xl transition-all duration-120 clay-press ${
                    isSelected
                      ? "clay-well-pressed bg-[#EFEFEF] border-2 border-[#0A0A0A]"
                      : "clay-slab bg-white border border-[#DCDCDC]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-[#0A0A0A]">{attack.label}</span>
                    <span className={`w-3.5 h-3.5 rounded-full border ${isSelected ? "border-4 border-[#0A0A0A] bg-white" : "border-[#A0A0A0]"}`} />
                  </div>
                  <p className="text-[12px] font-medium text-[#7C7C7C] mt-1 leading-tight">
                    <span className="font-bold text-[#5A5A5A]">Stopped by:</span> {attack.stoppedBy}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Execute Attack Button */}
        <Button
          variant="primary"
          onClick={handleExecuteAttack}
          loading={executing}
          disabled={!selectedAttackId || !destination}
        >
          Execute attack on enclave
        </Button>

        {/* Error message fallback */}
        {errorMsg && (
          <ClayWell variant="deep" className="p-3 border-2 border-[#0A0A0A]">
            <p className="font-mono text-[12px] font-bold text-[#0A0A0A]">{errorMsg}</p>
          </ClayWell>
        )}

        {/* Verbatim Enclave Refusal Specimen - The visual centerpiece */}
        {Boolean(rawResult) && <RawRefusalSpecimen error={rawResult} />}

        {/* Running tally */}
        <ClaySlab className="p-4 flex items-center justify-between border-t border-[#DCDCDC]">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-[#7C7C7C]">This session</span>
            <span className="text-[13px] font-mono font-semibold text-[#0A0A0A]">
              {tally.attempts} attempts · {tally.refusals} refusals · {tally.allowed} signed
            </span>
          </div>
          <button
            type="button"
            onClick={fetchState}
            className="text-[12px] font-semibold text-[#5A5A5A] hover:text-[#0A0A0A] underline"
          >
            Reset
          </button>
        </ClaySlab>

      </div>
    </AppFrame>
  );
}
