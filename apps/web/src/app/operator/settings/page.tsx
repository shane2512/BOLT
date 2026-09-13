"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { Button } from "@/components/ui/Button";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { DesktopTopNav } from "@/components/desktop/DesktopTopNav";

// Real, public network constants for this deployment — copied from
// CLAUDE.md and .env.example, not invented. Chain-level facts, not
// per-business config, so this page needs no API call.
const SETTINGS = [
  { label: "BoltRegistry contract", value: "0x654713c0554cf3286e140c876e49f15b3f9da0cd", type: "address" as const },
  { label: "BoltUnlockTimer contract", value: "0xda6528d75e1c576e36c17f7012a7f0ffad49b82e", type: "address" as const },
  { label: "USDC on Arc", value: "0x3600000000000000000000000000000000000000", type: "address" as const },
  { label: "Arc chain ID", value: "5042002", type: "text" as const },
  { label: "Arc RPC", value: "https://rpc.testnet.arc.io", type: "text" as const }
];

export default function OperatorSettingsPage() {
  const { user, logout } = usePrivy();

  const desktop = (
    <DesktopShell nav={<DesktopTopNav />} maxWidth={760}>
      <h1 className="text-[26px] font-semibold text-[#0A0A0A] pb-6">Settings</h1>
      <ClayWell className="p-4 border border-[#0A0A0A] flex flex-col gap-1 mb-5">
        <p className="text-[13px] text-[#5A5A5A] leading-normal">
          Enforcement lives in Privy policies and the on-chain contracts below, not in this app.
          Nothing here is a toggle — a value you can&apos;t change isn&apos;t shown as one.
        </p>
      </ClayWell>
      <div className="grid grid-cols-2 gap-3">
        {SETTINGS.map((s) => (
          <ClayWell key={s.label} className="p-3.5 flex flex-col gap-1 border border-[#DCDCDC]">
            <span className="text-[12px] font-medium text-[#7C7C7C]">{s.label}</span>
            {s.type === "address" ? (
              <ExplorerLink type="address" value={s.value} />
            ) : (
              <span className="font-mono text-[13px] font-bold text-[#0A0A0A]">{s.value}</span>
            )}
          </ClayWell>
        ))}
        <ClayWell className="p-3.5 flex flex-col gap-1 border border-[#DCDCDC]">
          <span className="text-[12px] font-medium text-[#7C7C7C]">Client money yield</span>
          <span className="text-[13px] font-semibold text-[#0A0A0A]">
            Earns nothing — fixed by the account class, not a setting anyone can flip.
          </span>
        </ClayWell>
      </div>
      <Link href="/claim" className="block mt-5">
        <Button variant="secondary">Open beneficiary claim page</Button>
      </Link>
      {user?.email?.address && (
        <ClayWell className="p-3.5 flex items-center justify-between border border-[#DCDCDC] mt-5">
          <div className="flex flex-col">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Signed in as</span>
            <span className="text-[13px] font-semibold text-[#0A0A0A]">{user.email.address}</span>
          </div>
          <button type="button" onClick={logout} className="text-[13px] font-semibold text-[#0A0A0A] underline">
            Sign out
          </button>
        </ClayWell>
      )}
    </DesktopShell>
  );

  return (
    <AppFrame showTabBar headerTitle="Settings" desktop={desktop}>
      <div className="p-4 flex-1 flex flex-col gap-5 pb-28">
        <ClayWell className="p-4 border border-[#0A0A0A] flex flex-col gap-1">
          <p className="text-[13px] text-[#5A5A5A] leading-normal">
            Enforcement lives in Privy policies and the on-chain contracts below, not in this app.
            Nothing here is a toggle — a value you can&apos;t change isn&apos;t shown as one.
          </p>
        </ClayWell>

        <div className="flex flex-col gap-3">
          {SETTINGS.map((s) => (
            <ClayWell key={s.label} className="p-3.5 flex flex-col gap-1 border border-[#DCDCDC]">
              <span className="text-[12px] font-medium text-[#7C7C7C]">{s.label}</span>
              {s.type === "address" ? (
                <ExplorerLink type="address" value={s.value} />
              ) : (
                <span className="font-mono text-[13px] font-bold text-[#0A0A0A]">{s.value}</span>
              )}
            </ClayWell>
          ))}

          <ClayWell className="p-3.5 flex flex-col gap-1 border border-[#DCDCDC]">
            <span className="text-[12px] font-medium text-[#7C7C7C]">Client money yield</span>
            <span className="text-[13px] font-semibold text-[#0A0A0A]">
              Earns nothing — fixed by the account class, not a setting anyone can flip.
            </span>
          </ClayWell>
        </div>

        <Link href="/claim" className="w-full">
          <Button variant="secondary">Open beneficiary claim page</Button>
        </Link>

        {user?.email?.address && (
          <ClayWell className="p-3.5 flex items-center justify-between border border-[#DCDCDC]">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-[#7C7C7C]">Signed in as</span>
              <span className="text-[13px] font-semibold text-[#0A0A0A]">{user.email.address}</span>
            </div>
            <button type="button" onClick={logout} className="text-[13px] font-semibold text-[#0A0A0A] underline">
              Sign out
            </button>
          </ClayWell>
        )}
      </div>
    </AppFrame>
  );
}
