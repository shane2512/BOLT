"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { InputWell } from "@/components/ui/InputWell";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc } from "@/lib/format";
import { useOperatorData, postOperator, OPERATOR_BUSINESS_SLUG } from "@/lib/useOperatorData";

interface Account {
  id: string;
  class: "CLIENT_MONEY" | "OBLIGATION_RESERVE" | "OPERATING";
  label: string;
  held: string;
}
interface BusinessData {
  found: boolean;
  business: { accounts: Account[] };
}
interface UnlockResult {
  ok: boolean;
  error?: string;
  id?: string;
  approvalLinkBase?: string;
}

export default function RequestUnlockPage() {
  return (
    <Suspense fallback={null}>
      <RequestUnlockForm />
    </Suspense>
  );
}

function RequestUnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preselected = params.get("account");
  const { getAccessToken } = usePrivy();
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  const [accountId, setAccountId] = useState(preselected ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UnlockResult | null>(null);

  if (loading) {
    return (
      <AppFrame headerTitle="Request unlock" showBack>
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading accounts" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame headerTitle="Request unlock" showBack>
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const lockedAccounts = data.business.accounts.filter((a) => a.class !== "OPERATING");
  const selected = lockedAccounts.find((a) => a.id === accountId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    const body = await postOperator<UnlockResult>(
      "/api/operator/unlock",
      { business: OPERATOR_BUSINESS_SLUG, accountAddress: accountId, amount: amountInput, destination, reason },
      getAccessToken
    );
    setResult(body);
    setSubmitting(false);
    if (body.ok && body.id) router.push("/operator/approvals");
  };

  return (
    <AppFrame headerTitle="Request unlock" headerSubtitle="Opens a 3-of-5 quorum ceremony" showBack>
      <form onSubmit={handleSubmit} className="p-4 flex-1 flex flex-col justify-between pb-12 gap-5">
        <div className="flex flex-col gap-5">
          <p className="text-[14px] text-[#5A5A5A]">
            Needs three of five quorum signatures. Once approved, a 24-hour on-chain timer runs before
            funds can move.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-[#7C7C7C] px-1">Which account</label>
            <div className="grid grid-cols-2 gap-2">
              {lockedAccounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountId(a.id)}
                  className={`p-3 rounded-2xl text-left border transition-all ${
                    accountId === a.id ? "clay-well-pressed bg-[#EFEFEF] border-2 border-[#0A0A0A]" : "clay-slab bg-white border-[#DCDCDC]"
                  }`}
                >
                  <span className="block text-[13px] font-bold text-[#0A0A0A]">{a.label}</span>
                  <span className="block text-[11px] text-[#7C7C7C] font-mono">{fmtUsdc(BigInt(a.held))} held</span>
                </button>
              ))}
            </div>
          </div>

          <InputWell label="Amount (USDC base units)" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} isMono placeholder="150000000" />

          <InputWell
            label="Destination address"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            isMono
            placeholder="0x..."
            caption="Not checked here — the enclave refuses it at execution if it isn't already permitted."
          />

          <InputWell
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Write it for someone reading it in two years."
            caption="Its hash is committed on chain and verified when a quorum member approves."
          />

          {selected && (
            <ClaySlab hero className="p-5 flex flex-col gap-3">
              <ValueAndSource amount={amountInput ? fmtUsdc(BigInt(amountInput || "0")) : "—"} label="Requested release" size="large" />
              <div className="groove-line my-1" />
              <div className="flex flex-col gap-1 font-mono text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Account:</span>
                  <span className="font-bold text-[#0A0A0A]">{selected.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7C7C7C]">Quorum:</span>
                  <span className="font-bold text-[#0A0A0A]">3 of 5</span>
                </div>
              </div>
            </ClaySlab>
          )}

          {result && !result.ok && (
            <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
              <p className="text-[13px] font-semibold text-[#0A0A0A]">{result.error}</p>
            </ClayWell>
          )}
        </div>

        <Button variant="primary" type="submit" loading={submitting} disabled={!accountId || !amountInput || !destination || reason.length < 10}>
          Send to your approvers
        </Button>
      </form>
    </AppFrame>
  );
}
