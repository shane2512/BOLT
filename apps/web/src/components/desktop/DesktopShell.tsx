import React from "react";

interface DesktopShellProps {
  children: React.ReactNode;
  /** Custom top bar content — pass <DesktopTopNav/> for the operator section.
   * Omit for a simple default bar (BOLT wordmark, links home). */
  nav?: React.ReactNode;
  /** Content max-width. 1280px for dashboard-shaped pages (tables, grids),
   * narrower reads cramped once a sidebar-free top-nav layout is this wide. */
  maxWidth?: number;
}

/**
 * Shared wide-screen page shell for every bespoke desktop layout (homepage,
 * the public [slug] page, the operator dashboard, simulator, auditor, ask).
 * Same tokens as the mobile clay system — white ground, black ink, grey
 * clay shadows — just laid out for a real viewport instead of a phone frame.
 */
export function DesktopShell({ children, nav, maxWidth = 1280 }: DesktopShellProps) {
  return (
    <div className="min-h-screen bg-[#F6F6F6] text-[#0A0A0A] flex flex-col">
      <div className="bg-white border-b border-[#DCDCDC] sticky top-0 z-30">
        <div className="mx-auto px-8" style={{ maxWidth }}>
          {nav ?? (
            <div className="h-16 flex items-center">
              <a href="/" className="text-[19px] font-extrabold tracking-tight text-[#0A0A0A]">
                BOLT
              </a>
            </div>
          )}
        </div>
      </div>
      <main className="flex-1 w-full mx-auto px-8 py-10" style={{ maxWidth }}>
        {children}
      </main>
    </div>
  );
}
