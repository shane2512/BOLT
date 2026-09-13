import React from "react";
import { shortAddress, shortHash } from "@/lib/format";

interface ExplorerLinkProps {
  type?: "address" | "tx" | "block" | "hash";
  value: string;
  href?: string;
  label?: string;
  className?: string;
}

export function ExplorerLink({
  type = "address",
  value,
  href,
  label,
  className = ""
}: ExplorerLinkProps) {
  const displayValue = label || (type === "address" ? shortAddress(value) : type === "tx" || type === "hash" ? shortHash(value) : value);
  // The real Arc testnet explorer, confirmed against every tx/address cited in
  // this project's evidence files. `explorer.testnet.arc.io` does not exist.
  const targetUrl = href || `https://testnet.arcscan.app/${type === "hash" ? "tx" : type}/${value}`;

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-[12px] text-[#5A5A5A] hover:text-[#0A0A0A] hover:underline transition-colors ${className}`}
      title={value}
    >
      <span>{displayValue}</span>
      <svg
        className="w-3 h-3 text-[#A0A0A0] shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}
