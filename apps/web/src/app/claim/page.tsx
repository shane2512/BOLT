"use client";

import React, { useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult } from "@worldcoin/idkit";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { RawRefusalSpecimen } from "@/components/ui/RawRefusalSpecimen";
import { fmtUsdc } from "@/lib/format";
import { getDeviceId } from "@/lib/deviceId";

type ClaimStep = "signin" | "identity" | "balance" | "withdraw" | "confirmation";

interface BeneficiaryData {
  found: boolean;
  walletAddress?: string | null;
  withdrawalAddress?: string | null;
  outstanding?: string;
  obligations?: { id: string; amount: string }[];
  selfieCheck?: { required: boolean; reason?: string } | null;
  /** Server-computed — the exact signal this proof must be bound to. */
  signal?: string;
}

/** Raw shape of POST /api/world/rp-signature — world-docs' own backend
 * example names the signature field `sig`; IDKit's `RpContext` type needs it
 * renamed to `signature`, so this is deliberately not that type. */
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

export default function ClaimPage() {
  const [step, setStep] = useState<ClaimStep>("signin");

  const [emailInput, setEmailInput] = useState("");
  const [slug] = useState("acme-marketplace");
  const [beneficiaryData, setBeneficiaryData] = useState<BeneficiaryData | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // World Selfie Check — the real IDKitRequestWidget, which renders its own
  // QR/connect modal.
  const [rpSignature, setRpSignature] = useState<RpSignature | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [selfieStatus, setSelfieStatus] = useState<"idle" | "verifying" | "verified" | "rejected">("idle");
  const [selfieError, setSelfieError] = useState<unknown | null>(null);

  const [destinationAddress, setDestinationAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmationData, setConfirmationData] = useState<{
    paid: boolean;
    transferTx?: string;
    obligationSettledTx?: string;
    error?: string;
  } | null>(null);

  const fetchBeneficiaryData = async (email: string, address?: string) => {
    setLookupError(null);
    try {
      const qs = new URLSearchParams({ slug, email });
      if (address) qs.set("address", address);
      const deviceId = getDeviceId();
      if (deviceId) qs.set("deviceId", deviceId);
      const res = await fetch(`/api/beneficiary/claim?${qs}`);
      const json: BeneficiaryData = await res.json();
      if (json.found) {
        setBeneficiaryData(json);
        if (json.withdrawalAddress) setDestinationAddress(json.withdrawalAddress);
        // FR-8.8 — already verified for this address and device: skip the
        // check entirely rather than making them redo it (and, since the
        // same person always produces the same World nullifier for this
        // action, a forced redo would just hit the anti-replay guard and
        // fail).
        setSelfieStatus(json.selfieCheck?.required === false ? "verified" : "idle");
        setStep("identity");
      } else {
        setLookupError(`No beneficiary on record for ${email} at ${slug}.`);
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEmailSignIn = () => {
    const email = emailInput.trim().toLowerCase();
    // Validated here, at tap time, rather than via a `disabled` prop wired to
    // live input state — some mobile keyboards/autofill update the field's
    // visible value without firing the input event React tracks, which left
    // the button stuck looking disabled even once something was typed.
    if (!email) {
      setLookupError("Enter your email first.");
      return;
    }
    fetchBeneficiaryData(email);
  };

  const handleVerify = async (result: IDKitResult) => {
    const res = await fetch("/api/beneficiary/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "verify",
        slug,
        email: emailInput,
        address: destinationAddress,
        reason: "FIRST_CLAIM",
        deviceId: getDeviceId(),
        idkitResult: result
      })
    });
    const json = await res.json();
    if (!res.ok || !json.verified) {
      setSelfieError(json.world ?? json.error ?? `HTTP ${res.status}`);
      // handleVerify must throw for the widget to show its own failure state.
      throw new Error(json.error || "Selfie Check verification failed");
    }
  };

  const openSelfieCheck = async () => {
    setSelfieStatus("verifying");
    setSelfieError(null);
    try {
      const res = await fetch("/api/world/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "beneficiary-claim" })
      });
      const json: RpSignature = await res.json();
      if (!res.ok) throw new Error((json as unknown as { error?: string }).error || `HTTP ${res.status}`);
      setRpSignature(json);
      setWidgetOpen(true);
    } catch (err) {
      setSelfieStatus("rejected");
      setSelfieError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setConfirmationData(null);
    try {
      const res = await fetch("/api/beneficiary/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "withdraw",
          slug,
          email: emailInput,
          address: destinationAddress,
          obligationId: beneficiaryData?.obligations?.[0]?.id,
          deviceId: getDeviceId()
        })
      });
      const json = await res.json();
      if (res.ok && json.paid) {
        setConfirmationData(json);
        setStep("confirmation");
      } else if (json.selfieCheckRequired) {
        // FR-8.7 — a new/unrecognised destination needs its own fresh check.
        // Re-fetch the signal scoped to this address and send them back
        // through the real Selfie Check rather than pretending it went
        // through.
        await fetchBeneficiaryData(emailInput, destinationAddress);
        setSelfieStatus("idle");
        setStep("identity");
        setConfirmationData({ paid: false, error: json.error });
      } else {
        setConfirmationData({ paid: false, error: json.error || "Withdrawal failed" });
      }
    } catch (err) {
      setConfirmationData({ paid: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setWithdrawing(false);
    }
  };

  const outstandingAmount = beneficiaryData?.outstanding ? BigInt(beneficiaryData.outstanding) : 0n;
  const hasObligation = (beneficiaryData?.obligations?.length ?? 0) > 0;

  return (
    <AppFrame
      headerTitle="Beneficiary payout"
      headerSubtitle="No password — a Selfie Check proves you"
      showBack={step !== "signin"}
      onBack={() => {
        if (step === "identity") setStep("signin");
        if (step === "balance") setStep("identity");
        if (step === "withdraw") setStep("balance");
      }}
    >
      <div className="p-4 flex-1 flex flex-col justify-between pb-8">
        {step === "signin" && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[26px] font-semibold leading-[32px] text-[#0A0A0A]">
                Claim funds allocated to you
              </h1>
              <p className="text-[15px] text-[#5A5A5A]">
                Enter the email your obligation is recorded under. No password — a World Selfie
                Check proves it&apos;s really you before any money moves.
              </p>
              <InputWell
                label="Email"
                placeholder="you@example.com"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              {lookupError && (
                <ClayWell variant="deep" className="p-3 border-2 border-[#0A0A0A]">
                  <p className="text-[13px] font-semibold text-[#0A0A0A]">{lookupError}</p>
                </ClayWell>
              )}
            </div>
            <Button variant="primary" onClick={handleEmailSignIn}>
              Continue
            </Button>
          </div>
        )}

        {step === "identity" && beneficiaryData && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#7C7C7C]">World Selfie Check</span>
                <StatusChip
                  status={
                    selfieStatus === "verified" ? "verified" : selfieStatus === "rejected" ? "refused" : "pending"
                  }
                  label={
                    selfieStatus === "verified"
                      ? "Verified"
                      : selfieStatus === "rejected"
                      ? "Rejected"
                      : "Required"
                  }
                />
              </div>

              <h1 className="text-[26px] font-semibold leading-[32px] text-[#0A0A0A]">
                Verify you&apos;re a real person
              </h1>
              <p className="text-[15px] text-[#5A5A5A]">
                Money leaves a locked account only after a Selfie Check. It proves a human — not a
                script or a stolen session — started this claim.
              </p>

              <ClayWell className="p-4 flex flex-col gap-2 border border-[#DCDCDC]">
                <div className="flex justify-between text-[12px] font-mono">
                  <span className="text-[#7C7C7C]">Email</span>
                  <span className="font-bold text-[#0A0A0A]">{emailInput}</span>
                </div>
                <div className="flex justify-between text-[12px] font-mono">
                  <span className="text-[#7C7C7C]">Destination</span>
                  <span className="font-bold text-[#0A0A0A]">
                    {destinationAddress ? `${destinationAddress.slice(0, 10)}…` : "—"}
                  </span>
                </div>
              </ClayWell>

              {selfieStatus === "rejected" && Boolean(selfieError) && (
                <RawRefusalSpecimen error={selfieError} title="World Selfie Check refusal" />
              )}
            </div>

            <div className="flex flex-col gap-3">
              {selfieStatus !== "verified" && (
                <Button variant="primary" onClick={openSelfieCheck} loading={selfieStatus === "verifying" && !rpSignature}>
                  Verify with World Selfie Check
                </Button>
              )}
              {selfieStatus === "verified" && (
                <Button variant="primary" onClick={() => setStep("balance")}>
                  Continue
                </Button>
              )}
            </div>

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
                preset={selfieCheckLegacy({ signal: beneficiaryData.signal })}
                handleVerify={handleVerify}
                onSuccess={() => {
                  setSelfieStatus("verified");
                  setWidgetOpen(false);
                }}
                onError={(errorCode, debugReport) => {
                  setSelfieStatus("rejected");
                  setSelfieError({ errorCode, debugReport });
                  setWidgetOpen(false);
                }}
              />
            )}
          </div>
        )}

        {step === "balance" && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#7C7C7C]">Outstanding obligation</span>
                <StatusChip status={hasObligation ? "covered" : "unproven"} label={hasObligation ? "Owed" : "Nothing owed"} />
              </div>

              <ClaySlab hero className="p-6 flex flex-col gap-4">
                <ValueAndSource
                  amount={fmtUsdc(outstandingAmount)}
                  label="Your outstanding balance"
                  sourceType="address"
                  sourceValue={beneficiaryData?.walletAddress ?? undefined}
                  sourceLabel="Your pregenerated wallet"
                  size="hero"
                />
              </ClaySlab>

              <ClayWell className="p-4 flex flex-col gap-1 border border-[#DCDCDC]">
                <p className="text-[13px] text-[#5A5A5A] leading-normal">
                  This sits in a Privy-policy-locked account. Withdrawing sends the transfer
                  straight to the enclave — there is no application-side check on where it goes.
                </p>
              </ClayWell>
            </div>

            <Button variant="primary" onClick={() => setStep("withdraw")} disabled={!hasObligation}>
              {hasObligation ? `Withdraw ${fmtUsdc(outstandingAmount)}` : "Nothing to withdraw yet"}
            </Button>
          </div>
        )}

        {step === "withdraw" && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Withdraw {fmtUsdc(outstandingAmount)}
              </h1>

              <InputWell
                label="Destination address"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                isMono
                placeholder="0x..."
                caption="A new destination needs a fresh Selfie Check — an already-verified one doesn't (FR-8.8)."
              />

              {confirmationData?.error && (
                <ClayWell variant="deep" className="p-3 border-2 border-[#0A0A0A]">
                  <p className="font-mono text-[12px] font-bold text-[#0A0A0A]">{confirmationData.error}</p>
                </ClayWell>
              )}
            </div>

            <Button variant="primary" onClick={handleWithdraw} loading={withdrawing} disabled={!destinationAddress}>
              Withdraw {fmtUsdc(outstandingAmount)}
            </Button>
          </div>
        )}

        {step === "confirmation" && confirmationData?.paid && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#7C7C7C]">Payout executed</span>
                <StatusChip status="signed" label="Settled on-chain" />
              </div>

              <h1 className="text-[26px] font-semibold text-[#0A0A0A]">Withdrawal complete</h1>

              <ClaySlab hero className="p-5 flex flex-col gap-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[12px] font-medium text-[#7C7C7C]">Amount paid</span>
                  <span className="font-mono text-[20px] font-bold text-[#0A0A0A]">
                    {fmtUsdc(outstandingAmount)}
                  </span>
                </div>
                <div className="groove-line my-1" />
                <div className="flex flex-col gap-2 font-mono text-[12px]">
                  <div className="flex justify-between items-center">
                    <span className="text-[#7C7C7C]">Destination:</span>
                    <ExplorerLink type="address" value={destinationAddress} />
                  </div>
                  {confirmationData.transferTx && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#7C7C7C]">Transfer tx:</span>
                      <ExplorerLink type="tx" value={confirmationData.transferTx} />
                    </div>
                  )}
                  {confirmationData.obligationSettledTx && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#7C7C7C]">Settlement tx:</span>
                      <ExplorerLink type="tx" value={confirmationData.obligationSettledTx} />
                    </div>
                  )}
                </div>
              </ClaySlab>
            </div>

            <Button variant="secondary" onClick={() => setStep("signin")}>
              Done
            </Button>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
