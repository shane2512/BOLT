import React from "react";
import { ExplorerLink } from "./ExplorerLink";

interface ValueAndSourceProps {
  amount: string;
  label?: string;
  sourceType?: "address" | "tx" | "block" | "hash";
  sourceValue?: string;
  sourceLabel?: string;
  size?: "hero" | "large" | "standard";
  className?: string;
}

export function ValueAndSource({
  amount,
  label,
  sourceType = "block",
  sourceValue,
  sourceLabel,
  size = "hero",
  className = ""
}: ValueAndSourceProps) {
  const sizeClasses = {
    hero: "text-[40px] leading-[44px] tracking-[-0.02em] font-semibold",
    large: "text-[28px] leading-[34px] tracking-[-0.01em] font-semibold",
    standard: "text-[20px] leading-[26px] font-semibold"
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <span className="text-[13px] font-medium text-[#7C7C7C] tracking-tight">
          {label}
        </span>
      )}
      <div className={`text-[#0A0A0A] num-tabular ${sizeClasses[size]}`}>
        {amount}
      </div>
      {sourceValue && (
        <div className="flex items-center gap-1.5 text-[12px] text-[#7C7C7C] pt-0.5">
          <span className="font-medium">{sourceLabel || "Verified at"}:</span>
          <ExplorerLink type={sourceType} value={sourceValue} />
        </div>
      )}
    </div>
  );
}
