import React from "react";

interface StatusChipProps {
  status: "covered" | "verified" | "signed" | "refused" | "severe" | "pending" | "unproven";
  label?: string;
  className?: string;
}

export function StatusChip({ status, label, className = "" }: StatusChipProps) {
  const isCovered = status === "covered" || status === "verified" || status === "signed";
  const isRefused = status === "refused" || status === "severe";

  const defaultLabel = {
    covered: "Covered",
    verified: "Verified",
    signed: "Signed",
    refused: "Refused",
    severe: "Severe Finding",
    pending: "Pending",
    unproven: "Not Yet Proven"
  }[status];

  const chipText = label || defaultLabel;

  if (isRefused) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold text-[#0A0A0A] bg-white border-2 border-[#0A0A0A] select-none ${className}`}
      >
        <span className="w-2 h-2 bg-[#0A0A0A] shrink-0" />
        <span>{chipText}</span>
      </span>
    );
  }

  if (isCovered) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold text-[#0A0A0A] bg-white border border-[#0A0A0A] select-none ${className}`}
      >
        <span className="w-2 h-2 rounded-full bg-[#0A0A0A] shrink-0" />
        <span>{chipText}</span>
      </span>
    );
  }

  // Pending / Not yet proven
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium text-[#7C7C7C] bg-[#F6F6F6] border border-dashed border-[#A0A0A0] select-none ${className}`}
    >
      <span className="w-2 h-2 rounded-full border border-[#7C7C7C] shrink-0" />
      <span>{chipText}</span>
    </span>
  );
}
