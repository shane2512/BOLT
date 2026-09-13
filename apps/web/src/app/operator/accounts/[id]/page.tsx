"use client";

import { use, useState } from "react";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { ValueAndSource } from "@/components/ui/ValueAndSource";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc, titleiseClass } from "@/lib/format";
import { useOperatorData } from "@/lib/useOperatorData";

interface Account {
  id: string;
  class: "CLIENT_MONEY" | "OBLIGATION_RESERVE" | "OPERATING";
  label: string;
  held: string;
  owed: string;
  policyHash: string;
  registeredAtBlock: string;
  registeredTx: string;
}
interface Split {
  amount: string;
  blockNumber: string;
  txHash: string;
  account: { id: string };
}
interface Deposit {
  id: string;
  splits: Split[];
}
interface Unlock {
  account: { id: string };
  amount: string;
  requestedTx: string;
  requestedAtBlock: string;
  status: string;
}
interface BusinessData {
  found: boolean;
  business: { accounts: Account[] };
  deposits: Deposit[];
  unlocks: Unlock[];
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [showPolicy, setShowPolicy] = useState(false);
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  if (loading) {
    return (
      <AppFrame headerTitle="Account" showBack>
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading account" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame headerTitle="Account" showBack>
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const account = data.business.accounts.find((a) => a.id.toLowerCase() === id.toLowerCase());
  if (!account) {
    return (
      <AppFrame headerTitle="Account" showBack>
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">No account with this address.</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const locked = account.class !== "OPERATING";

  // Real activity for this account: incoming splits from every deposit, plus
  // any unlock ever requested against it, plus its own on-chain registration.
  const incoming = data.deposits
    .flatMap((d) => d.splits.filter((s) => s.account.id.toLowerCase() === id.toLowerCase()))
    .map((s) => ({ kind: "Deposit split" as const, amount: s.amount, tx: s.txHash, block: s.blockNumber }));
  const outgoing = data.unlocks
    .filter((u) => u.account.id.toLowerCase() === id.toLowerCase())
    .map((u) => ({ kind: `Unlock (${u.status.toLowerCase()})` as const, amount: `-${u.amount}`, tx: u.requestedTx, block: u.requestedAtBlock }));
  const history = [...incoming, ...outgoing].sort((a, b) => Number(b.block) - Number(a.block));

  return (
    <AppFrame headerTitle={account.label} headerSubtitle={titleiseClass(account.class)} showBack>
      <div className="p-4 flex-1 flex flex-col gap-6 pb-12">
        <ClaySlab hero className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Held vs owed</span>
            <StatusChip status={locked ? "covered" : "pending"} label={locked ? "Locked" : "Operating"} />
          </div>
          <ValueAndSource
            amount={fmtUsdc(BigInt(account.held))}
            label="Held"
            sourceType="address"
            sourceValue={account.id}
            sourceLabel="account"
            size="hero"
          />
          <div className="groove-line my-1" />
          <div className="flex justify-between items-baseline font-mono text-[13px]">
            <span className="text-[#7C7C7C]">Owed:</span>
            <span className="font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(account.owed))}</span>
          </div>
        </ClaySlab>

        {locked ? (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-[#7C7C7C] px-1">What this account may do</span>
            <ClayWell className="p-4 flex flex-col gap-3 border border-[#DCDCDC]">
              <p className="text-[13px] text-[#5A5A5A] leading-normal">
                Every locked account&apos;s policy is the same shape: it may send USDC, only to the
                one destination it was provisioned with, only with zero native value riding along,
                and never via <code className="font-mono">approve</code> or{" "}
                <code className="font-mono">transferFrom</code>. The specific permitted destination
                is committed in this account&apos;s policy hash, not something this app decodes.
              </p>
              <div className="pt-2 border-t border-[#DCDCDC] flex items-center justify-between">
                <span className="text-[12px] font-mono text-[#7C7C7C]">{account.policyHash.slice(0, 14)}…</span>
                <button
                  type="button"
                  onClick={() => setShowPolicy(!showPolicy)}
                  className="text-[12px] font-semibold text-[#0A0A0A] underline"
                >
                  {showPolicy ? "Hide hash" : "Show full hash"}
                </button>
              </div>
              {showPolicy && (
                <pre className="font-mono text-[11px] text-[#0A0A0A] bg-[#E7E7E7] p-3 rounded-xl border border-[#C4C4C4] whitespace-pre-wrap break-all">
                  {account.policyHash}
                </pre>
              )}
            </ClayWell>
          </div>
        ) : (
          <ClayWell className="p-4">
            <p className="text-[13px] text-[#5A5A5A]">
              This account carries no policy. It holds the business&apos;s own money and is already
              spendable.
            </p>
          </ClayWell>
        )}

        <div className="flex flex-col gap-3">
          <span className="text-[12px] font-medium text-[#7C7C7C] px-1">History</span>
          {history.length === 0 && (
            <ClayWell className="p-4">
              <p className="text-[13px] text-[#5A5A5A]">No indexed activity on this account yet.</p>
            </ClayWell>
          )}
          {history.map((h, i) => (
            <ClayWell key={i} className="p-3 flex items-center justify-between border border-[#DCDCDC]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-[#0A0A0A]">{h.kind}</span>
                <span className="text-[11px] text-[#7C7C7C]">block {h.block}</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-[14px] font-bold text-[#0A0A0A]">
                  {fmtUsdc(BigInt(h.amount))}
                </span>
                <ExplorerLink type="tx" value={h.tx} />
              </div>
            </ClayWell>
          ))}
        </div>

        <div className="pt-4 border-t border-[#DCDCDC]">
          {locked ? (
            <>
              <Link href={`/operator/unlock/request?account=${account.id}`} className="w-full block">
                <Button variant="secondary">Request an early unlock</Button>
              </Link>
              <span className="text-[11px] font-medium text-[#7C7C7C] text-center block pt-2">
                Needs 3-of-5 key quorum signatures and a 24-hour on-chain delay.
              </span>
            </>
          ) : (
            <ClayWell className="p-4">
              <p className="text-[13px] text-[#5A5A5A]">
                This account carries no policy. It holds the business&apos;s own money and is
                already spendable.
              </p>
            </ClayWell>
          )}
        </div>
      </div>
    </AppFrame>
  );
}
