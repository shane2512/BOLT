"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TabItem {
  id: string;
  label: string;
  href: string;
  icon: (active: boolean) => React.ReactNode;
}

const OPERATOR_TABS: TabItem[] = [
  {
    id: "coverage",
    label: "Coverage",
    href: "/operator",
    icon: (active) => (
      <svg className={`w-4 h-4 ${active ? "text-[#0A0A0A]" : "text-[#71717A]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )
  },
  {
    id: "accounts",
    label: "Accounts",
    href: "/operator/accounts",
    icon: (active) => (
      <svg className={`w-4 h-4 ${active ? "text-[#0A0A0A]" : "text-[#71717A]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.8} d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    )
  },
  {
    id: "activity",
    label: "Activity",
    href: "/operator/activity",
    icon: (active) => (
      <svg className={`w-4 h-4 ${active ? "text-[#0A0A0A]" : "text-[#71717A]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
  {
    id: "approvals",
    label: "Approvals",
    href: "/operator/approvals",
    icon: (active) => (
      <svg className={`w-4 h-4 ${active ? "text-[#0A0A0A]" : "text-[#71717A]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.8} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    )
  },
  {
    id: "alerts",
    label: "Alerts",
    href: "/operator/alerts",
    icon: (active) => (
      <svg className={`w-4 h-4 ${active ? "text-[#0A0A0A]" : "text-[#71717A]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    )
  }
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    /* ALWAYS VISIBLE PINNED FLOATING CONTAINER */
    <div className="absolute bottom-6 inset-x-3 z-40 mx-auto w-[calc(100%-24px)] max-w-[366px] flex items-center gap-2 select-none pointer-events-auto">
      
      {/* Main Pill Capsule Container */}
      <nav
        className="flex-1 h-[56px] bg-white/95 backdrop-blur-md rounded-full border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.12)] px-1.5 py-1 flex items-center justify-around transition-all"
        aria-label="Operator shell navigation"
      >
        {OPERATOR_TABS.map((tab) => {
          const isActive =
            tab.href === "/operator"
              ? pathname === "/operator" || pathname === "/operator/"
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex-1 h-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-all duration-120 clay-press ${
                isActive
                  ? "bg-[#F4F4F5] text-[#0A0A0A] shadow-inner font-bold"
                  : "text-[#71717A] hover:text-[#0A0A0A] font-medium"
              }`}
            >
              {tab.icon(isActive)}
              <span className="text-[10px] tracking-tight leading-tight">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Right Circular Quick Action Button (Ask Solvency Monitor) */}
      <Link
        href="/ask"
        className="w-14 h-[56px] rounded-full bg-[#0A0A0A] text-white shadow-[0_8px_20px_rgba(10,10,10,0.25)] flex flex-col items-center justify-center active:scale-95 transition-transform shrink-0 clay-press"
        title="Ask Solvency Monitor"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-[9px] font-mono font-bold tracking-tight text-white/90">ASK</span>
      </Link>
    </div>
  );
}
