import React from "react";
import { ClayWell } from "./ClayWell";

interface RawRefusalSpecimenProps {
  error: unknown;
  title?: string;
  className?: string;
}

export function RawRefusalSpecimen({
  error,
  title = "Returned by the enclave, unedited",
  className = ""
}: RawRefusalSpecimenProps) {
  const errorContent =
    typeof error === "string" ? error : JSON.stringify(error, null, 2) || String(error);

  return (
    <div className={`w-full flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-2 h-2 bg-[#0A0A0A] inline-block rounded-full" />
        <span className="text-[12px] font-medium text-[#7C7C7C]">{title}</span>
      </div>

      <ClayWell variant="deep" className="p-4 border-2 border-[#0A0A0A] relative overflow-hidden">
        <pre className="font-mono text-[13px] leading-[1.6] font-semibold text-[#0A0A0A] whitespace-pre-wrap break-all selection:bg-[#0A0A0A] selection:text-white">
          {errorContent}
        </pre>

        <div className="pt-3 mt-3 border-t border-[#C4C4C4] text-[12px] text-[#5A5A5A]">
          No signature was produced. There is nothing to broadcast.
        </div>
      </ClayWell>
    </div>
  );
}
