"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export interface AnchorItem {
  id: string;
  label: string;
}

interface ScrollSpyPillBarProps {
  anchors: AnchorItem[];
  className?: string;
}

export function ScrollSpyPillBar({ anchors, className = "" }: ScrollSpyPillBarProps) {
  const [activeId, setActiveId] = useState<string>(anchors[0]?.id || "");

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200;

      for (let i = anchors.length - 1; i >= 0; i--) {
        const el = document.getElementById(anchors[i].id);
        if (el && el.offsetTop <= scrollPosition) {
          setActiveId(anchors[i].id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [anchors]);

  const scrollToAnchor = (id: string) => {
    setActiveId(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    /* ALWAYS VISIBLE PINNED FLOATING CONTAINER */
    <div className={`absolute bottom-6 inset-x-3 z-40 mx-auto w-[calc(100%-24px)] max-w-[366px] flex items-center gap-2 select-none pointer-events-auto ${className}`}>
      
      {/* Main Segmented Pill Capsule */}
      <nav
        className="flex-1 h-[56px] bg-white/95 backdrop-blur-md rounded-full border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.12)] p-1.5 flex items-center justify-around"
        aria-label="Public page scroll-spy navigation"
      >
        {anchors.map((anchor) => {
          const isActive = activeId === anchor.id;
          return (
            <button
              key={anchor.id}
              type="button"
              onClick={() => scrollToAnchor(anchor.id)}
              className={`flex-1 h-full rounded-full text-[12px] font-semibold tracking-tight transition-all duration-120 flex items-center justify-center clay-press ${
                isActive
                  ? "bg-[#F4F4F5] text-[#0A0A0A] shadow-inner font-bold"
                  : "text-[#71717A] hover:text-[#0A0A0A]"
              }`}
            >
              {anchor.label}
            </button>
          );
        })}
      </nav>

      {/* Right Circular Quick Action Button (Breach Simulator) */}
      <Link
        href="/simulator"
        className="w-14 h-[56px] rounded-full bg-[#0A0A0A] text-white shadow-[0_8px_20px_rgba(10,10,10,0.25)] flex flex-col items-center justify-center active:scale-95 transition-transform shrink-0 clay-press"
        title="Breach Simulator"
      >
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="text-[9px] font-mono font-bold tracking-tight text-white/90">TEST</span>
      </Link>
    </div>
  );
}
