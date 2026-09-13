"use client";

import React, { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";

export default function OperatorSetupPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Form states
  const [businessName, setBusinessName] = useState("Acme Marketplace Inc.");
  const [businessSlug, setBusinessSlug] = useState("acme-marketplace");

  // Splits (in basis points, 10000 = 100%)
  const [clientBps, setClientBps] = useState(7000); // 70%
  const [reserveBps, setReserveBps] = useState(3000); // 30%
  const totalBps = clientBps + reserveBps;
  const is100Percent = totalBps === 10000;

  // Approvers
  const [approvers, setApprovers] = useState([
    "Alice Vance (CEO)",
    "Bob Chen (CFO)",
    "Carol Reed (Head of Risk)",
    "David Miller (General Counsel)",
    "Eva Santos (Auditor Lead)"
  ]);

  return (
    <AppFrame headerTitle="Instrument Provisioning" headerSubtitle={`Setup Step 0${step} of 05`} showBack={step > 1} onBack={() => setStep((s) => Math.max(1, s - 1) as typeof step)}>
      <div className="p-4 flex-1 flex flex-col justify-between pb-8">
        
        {/* STEP 1: BUSINESS NAME & SLUG */}
        {step === 1 && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Register Business Entity
              </h1>
              <p className="text-[14px] text-[#5A5A5A]">
                Name the business and choose the public URL slug. Every solvency metric will publish under this slug.
              </p>

              <InputWell
                label="Business Name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
              <InputWell
                label="Public Page Slug"
                value={businessSlug}
                onChange={(e) => setBusinessSlug(e.target.value)}
                isMono
                caption={`Public page will be at /${businessSlug}`}
              />
            </div>

            <Button variant="primary" onClick={() => setStep(2)}>
              Continue to Account Classes
            </Button>
          </div>
        )}

        {/* STEP 2: ACCOUNT CLASSES */}
        {step === 2 && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Configure Account Classes
              </h1>

              <div className="flex flex-col gap-3">
                <ClayWell variant="deep" className="p-4 flex flex-col gap-1 border-2 border-[#0A0A0A]">
                  <div className="flex justify-between items-center font-mono text-[12px]">
                    <span className="font-bold text-[#0A0A0A]">Client money</span>
                    <span>Locked</span>
                  </div>
                  <p className="text-[13px] text-[#5A5A5A]">
                    Customer escrow funds. Yield disabled (Invariant 4). Business cannot spend without beneficiary claim or 3-of-5 quorum unlock.
                  </p>
                </ClayWell>

                <ClayWell variant="deep" className="p-4 flex flex-col gap-1 border-2 border-[#0A0A0A]">
                  <div className="flex justify-between items-center font-mono text-[12px]">
                    <span className="font-bold text-[#0A0A0A]">Obligation reserve</span>
                    <span>Locked</span>
                  </div>
                  <p className="text-[13px] text-[#5A5A5A]">
                    Tax & payroll obligations. Yield permitted. Locked inside Privy TEE policy enclave.
                  </p>
                </ClayWell>

                <ClaySlab className="p-4 flex flex-col gap-1">
                  <div className="flex justify-between items-center font-mono text-[12px]">
                    <span className="font-bold text-[#0A0A0A]">Operating</span>
                    <span>Spendable</span>
                  </div>
                  <p className="text-[13px] text-[#5A5A5A]">
                    Company discretionary operating account. Unlocked and spendable by business operators.
                  </p>
                </ClaySlab>
              </div>
            </div>

            <Button variant="primary" onClick={() => setStep(3)}>
              Continue to Mandate Split Rules
            </Button>
          </div>
        )}

        {/* STEP 3: SPLIT RULE (RUNNING TOTAL VALIDATOR HERO) */}
        {step === 3 && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Deposit Allocation Mandate
              </h1>

              {/* RUNNING-TOTAL VALIDATOR HERO OBJECT */}
              <ClaySlab hero className={`p-6 flex flex-col gap-2 border-2 ${is100Percent ? "border-[#0A0A0A]" : "border-dashed border-[#A0A0A0]"}`}>
                <span className="text-[12px] font-semibold text-[#7C7C7C]">MANDATE SPLIT VALIDATOR</span>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[36px] font-bold text-[#0A0A0A]">
                    {(totalBps / 100).toFixed(2)}%
                  </span>
                  <span className="font-mono text-[13px] font-bold text-[#0A0A0A]">
                    {is100Percent ? "VALID (100.00%)" : "MUST EQUAL EXACTLY 100.00%"}
                  </span>
                </div>
                <div className="w-full h-3 bg-[#EFEFEF] rounded-full overflow-hidden flex border border-[#DCDCDC] mt-1">
                  <div style={{ width: `${(clientBps / 10000) * 100}%` }} className="h-full bg-[#0A0A0A]" />
                  <div style={{ width: `${(reserveBps / 10000) * 100}%` }} className="h-full bg-[#7C7C7C]" />
                </div>
              </ClaySlab>

              <div className="flex flex-col gap-3 pt-2">
                <InputWell
                  label="Client Money Allocation (%)"
                  type="number"
                  value={clientBps / 100}
                  onChange={(e) => setClientBps(Math.round(Number(e.target.value) * 100))}
                />
                <InputWell
                  label="Obligation Reserve Allocation (%)"
                  type="number"
                  value={reserveBps / 100}
                  onChange={(e) => setReserveBps(Math.round(Number(e.target.value) * 100))}
                />
              </div>
            </div>

            <Button variant="primary" onClick={() => setStep(4)} disabled={!is100Percent}>
              Continue to Quorum Approvers
            </Button>
          </div>
        )}

        {/* STEP 4: APPROVERS (5 PEOPLE, QUORUM SENTENCE) */}
        {step === 4 && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Register 5 Quorum Approvers
              </h1>

              {/* Quorum Threshold Stated as a Sentence (Not a Badge) */}
              <ClayWell variant="standard" className="p-4 border border-[#0A0A0A]">
                <p className="text-[15px] font-semibold text-[#0A0A0A] leading-relaxed">
                  Three of five registered quorum members must provide cryptographically verified signatures to execute any policy change or early unlock request.
                </p>
              </ClayWell>

              <div className="flex flex-col gap-2 pt-1">
                {approvers.map((name, idx) => (
                  <InputWell
                    key={idx}
                    label={`Approver Seat 0${idx + 1}`}
                    value={name}
                    onChange={(e) => {
                      const updated = [...approvers];
                      updated[idx] = e.target.value;
                      setApprovers(updated);
                    }}
                  />
                ))}
              </div>
            </div>

            <Button variant="primary" onClick={() => setStep(5)}>
              Review Setup & Provisioning
            </Button>
          </div>
        )}

        {/* STEP 5: REVIEW & HONEST DIRECTIVE */}
        {step === 5 && (
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-[24px] font-semibold text-[#0A0A0A]">
                Review Setup Specification
              </h1>

              <ClayWell variant="standard" className="p-4 flex flex-col gap-2 font-mono text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Business:</span>
                  <span className="font-bold text-[#0A0A0A]">{businessName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Slug:</span>
                  <span className="font-bold text-[#0A0A0A]">{businessSlug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Client / Reserve Split:</span>
                  <span className="font-bold text-[#0A0A0A]">{clientBps/100}% / {reserveBps/100}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Quorum Seats:</span>
                  <span className="font-bold text-[#0A0A0A]">5 Members (Threshold: 3)</span>
                </div>
              </ClayWell>

              {/* HONEST CLI DIRECTIVE (NEVER A FAKE PUBLISH BUTTON) */}
              <ClayWell variant="deep" className="p-5 border-2 border-[#0A0A0A] flex flex-col gap-3">
                <span className="text-[12px] font-medium text-[#7C7C7C]">
                  This step can't happen in a browser
                </span>
                <p className="text-[14px] text-[#0A0A0A] leading-normal">
                  A key quorum&apos;s authorization signing keys cannot be generated securely from a web browser. Run the following command in your secure CLI workspace to generate quorum keys and deploy Privy policies to Arc:
                </p>
                <div className="bg-white p-3 rounded-xl border border-[#C4C4C4]">
                  <code className="font-mono text-[13px] font-bold text-[#0A0A0A] select-all">
                    pnpm --filter @bolt/privy setup-quorum --slug {businessSlug}
                  </code>
                </div>
              </ClayWell>
            </div>

            <Button variant="secondary" onClick={() => window.location.href = "/operator"}>
              Return to Operator Dashboard
            </Button>
          </div>
        )}

      </div>
    </AppFrame>
  );
}
