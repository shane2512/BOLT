"use client";

import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { LoadingState } from "@/components/ui/States";
import { fmtUsdc, titleiseClass } from "@/lib/format";
import { useOperatorData } from "@/lib/useOperatorData";

interface Account {
  id: string; // the account's own address
  class: "CLIENT_MONEY" | "OBLIGATION_RESERVE" | "OPERATING";
  label: string;
  held: string;
  owed: string;
}
interface BusinessData {
  found: boolean;
  business: { accounts: Account[] };
}

const CLASS_NOTE: Record<Account["class"], string> = {
  CLIENT_MONEY: "Locked by policy — can only pay verified beneficiaries or move on a 3-of-5 unlock.",
  OBLIGATION_RESERVE: "Locked by policy — can only settle the institution it's reserved for, or unlock.",
  OPERATING: "No policy attached. The business's own money, already spendable."
};

export default function OperatorAccountsPage() {
  const { data, loading, error } = useOperatorData<BusinessData>("/api/operator/business");

  if (loading) {
    return (
      <AppFrame showTabBar headerTitle="Accounts">
        <div className="p-4 flex-1 flex items-center justify-center">
          <LoadingState title="Reading accounts" detail="Fetching from the subgraph…" />
        </div>
      </AppFrame>
    );
  }
  if (error || !data?.found) {
    return (
      <AppFrame showTabBar headerTitle="Accounts">
        <div className="p-4">
          <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A]">
            <p className="text-[14px] font-semibold text-[#0A0A0A]">{error || "Not indexed yet."}</p>
          </ClayWell>
        </div>
      </AppFrame>
    );
  }

  const accounts = data.business.accounts;

  return (
    <AppFrame showTabBar headerTitle="Accounts" headerSubtitle={`${accounts.length} registered`}>
      <div className="p-4 flex-1 flex flex-col gap-5 pb-28">
        {accounts.map((acc) => {
          const locked = acc.class !== "OPERATING";
          const body = (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] ${
                      locked ? "bg-[#0A0A0A] text-white" : "bg-white border border-[#0A0A0A] text-[#0A0A0A]"
                    }`}
                  >
                    {locked ? "L" : "O"}
                  </span>
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#0A0A0A] leading-tight">{acc.label}</h2>
                    <span className="text-[11px] text-[#7C7C7C]">{titleiseClass(acc.class)}</span>
                  </div>
                </div>
                <StatusChip status={locked ? "covered" : "pending"} label={locked ? "Locked" : "Operating"} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-[13px] pt-1">
                <div>
                  <span className="text-[#7C7C7C] block text-[11px]">Held</span>
                  <span className="font-mono font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(acc.held))}</span>
                </div>
                <div>
                  <span className="text-[#7C7C7C] block text-[11px]">Owed</span>
                  <span className="font-mono font-bold text-[#0A0A0A]">{fmtUsdc(BigInt(acc.owed))}</span>
                </div>
              </div>

              <p className="text-[12px] text-[#5A5A5A] leading-normal">{CLASS_NOTE[acc.class]}</p>

              <div className="pt-2 border-t border-[#DCDCDC] flex items-center justify-between text-[12px]">
                <ExplorerLink type="address" value={acc.id} />
                <Link href={`/operator/accounts/${acc.id}`} className="font-semibold text-[#0A0A0A] underline">
                  Account detail
                </Link>
              </div>
            </>
          );
          return locked ? (
            <ClayWell key={acc.id} className="p-5 flex flex-col gap-3 border border-[#DCDCDC]">
              {body}
            </ClayWell>
          ) : (
            <ClaySlab key={acc.id} hero className="p-5 flex flex-col gap-3 border border-black/10">
              {body}
            </ClaySlab>
          );
        })}
      </div>
    </AppFrame>
  );
}
