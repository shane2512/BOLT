"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

const SECTIONS = [
  { label: "Coverage", href: "/operator" },
  { label: "Accounts", href: "/operator/accounts" },
  { label: "Activity", href: "/operator/activity" },
  { label: "Approvals", href: "/operator/approvals" },
  { label: "Alerts", href: "/operator/alerts" }
];

/** Desktop replacement for the mobile BottomTabBar, used only inside the
 * operator dashboard. Same destinations, laid out as an inline top bar
 * instead of a floating bottom pill — the standard desktop-app pattern the
 * bottom-tab-in-a-phone-frame pattern doesn't translate to. */
export function DesktopTopNav() {
  const pathname = usePathname();
  const { user, logout } = usePrivy();

  return (
    <div className="h-16 flex items-center justify-between gap-6">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-[19px] font-extrabold tracking-tight text-[#0A0A0A] shrink-0">
          BOLT
        </Link>
        <nav className="flex items-center gap-1" aria-label="Operator dashboard navigation">
          {SECTIONS.map((s) => {
            const active = s.href === "/operator" ? pathname === "/operator" : pathname.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`px-3.5 py-2 rounded-full text-[14px] font-semibold transition-colors ${
                  active ? "bg-[#EFEFEF] text-[#0A0A0A]" : "text-[#5A5A5A] hover:text-[#0A0A0A] hover:bg-[#F6F6F6]"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          href="/ask"
          className="px-4 py-2 rounded-full bg-[#0A0A0A] text-white text-[13px] font-semibold flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Ask
        </Link>
        <Link
          href="/operator/settings"
          className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
            pathname === "/operator/settings" ? "bg-[#EFEFEF] border-[#0A0A0A]" : "border-[#DCDCDC] hover:border-[#0A0A0A]"
          }`}
          aria-label="Settings"
        >
          <svg className="w-4 h-4 text-[#0A0A0A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
        {user?.email?.address && (
          <button
            type="button"
            onClick={logout}
            className="text-[13px] font-semibold text-[#5A5A5A] hover:text-[#0A0A0A] underline"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
