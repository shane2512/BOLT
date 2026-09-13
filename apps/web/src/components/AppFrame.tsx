"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomTabBar } from "./ui/BottomTabBar";

interface AppFrameProps {
  children: React.ReactNode;
  headerTitle?: string;
  headerSubtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  headerAction?: React.ReactNode;
  className?: string;
  /** Renders the operator tab bar as a fixed overlay on the frame itself,
   * not inside the scrollable content — it must stay put while the page
   * scrolls underneath it, not travel with the content's own bottom edge. */
  showTabBar?: boolean;
}

export function AppFrame({
  children,
  headerTitle,
  headerSubtitle,
  showBack,
  onBack,
  headerAction,
  className = "",
  showTabBar = false
}: AppFrameProps) {
  const pathname = usePathname();
  // Settings and split rules carry no tab-bar entry (five primary
  // destinations is already a full row on a 390px frame), so without this
  // they were reachable only by typing the URL — a real dead end for anyone
  // using the app normally, not just a video-recording inconvenience.
  const showSettingsLink = showTabBar && !headerAction && pathname !== "/operator/settings";

  return (
    <div className="min-h-screen bg-[#F6F6F6] flex flex-col items-center justify-start sm:py-6 px-0 sm:px-4 selection:bg-[#0A0A0A] selection:text-white">
      {/* 390x844 iOS-style phone frame */}
      <div className={`w-full max-w-[390px] min-h-[844px] bg-white text-[#0A0A0A] relative flex flex-col shadow-[0_20px_50px_rgba(0,0,0,0.1)] sm:rounded-[36px] overflow-hidden border border-black/5 ${className}`}>
        
        {/* Hardware / iOS Status Bar Indicator */}
        <div className="w-full pt-3 px-6 pb-2 flex items-center justify-between text-[11px] font-medium tracking-tight text-[#7C7C7C] select-none bg-white z-20 shrink-0">
          <span className="font-semibold text-[#0A0A0A]">09:41</span>
          <div className="w-16 h-3.5 bg-[#EFEFEF] rounded-full flex items-center justify-center border border-[#DCDCDC]">
            <div className="w-8 h-1 bg-[#A0A0A0] rounded-full" />
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span>BOLT</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]" />
          </div>
        </div>

        {/* Optional App Bar Header */}
        {(headerTitle || showBack) && (
          <header className="w-full px-4 py-3 bg-white border-b border-[#EFEFEF] flex items-center justify-between z-20 shrink-0">
            <div className="flex items-center gap-3">
              {showBack && (
                <button
                  type="button"
                  onClick={onBack || (() => window.history.back())}
                  className="w-10 h-10 rounded-full bg-[#F6F6F6] border border-[#DCDCDC] flex items-center justify-center text-[#0A0A0A] active:scale-95 transition-transform clay-press"
                  aria-label="Go back"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {headerTitle && (
                <div>
                  <h1 className="text-[17px] font-semibold tracking-tight text-[#0A0A0A] leading-tight">
                    {headerTitle}
                  </h1>
                  {headerSubtitle && (
                    <p className="text-[12px] font-medium text-[#7C7C7C] leading-tight">
                      {headerSubtitle}
                    </p>
                  )}
                </div>
              )}
            </div>
            {headerAction && <div>{headerAction}</div>}
            {showSettingsLink && (
              <Link
                href="/operator/settings"
                className="w-10 h-10 rounded-full bg-[#F6F6F6] border border-[#DCDCDC] flex items-center justify-center text-[#0A0A0A] active:scale-95 transition-transform clay-press"
                aria-label="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            )}
          </header>
        )}

        {/* Main Content Area — this is what scrolls. The tab bar below is a
            sibling, not a child, so it stays fixed to the frame while this
            scrolls underneath it. */}
        <main className="flex-1 flex flex-col w-full relative overflow-y-auto overflow-x-hidden">
          {children}
        </main>

        {showTabBar && <BottomTabBar />}

        {/* Safe Area Bottom Bar Indicator */}
        <div className="w-full h-5 bg-white flex items-center justify-center shrink-0 z-10 pointer-events-none">
          <div className="w-32 h-1 bg-[#DCDCDC] rounded-full" />
        </div>
      </div>
    </div>
  );
}
