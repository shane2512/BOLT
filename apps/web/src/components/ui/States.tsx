import React from "react";
import { ClayWell } from "./ClayWell";

interface StateProps {
  title: string;
  detail: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, detail, action, className = "" }: StateProps) {
  return (
    <ClayWell className={`p-6 flex flex-col items-center text-center gap-3 ${className}`}>
      <div className="w-10 h-10 rounded-full bg-white border border-[#DCDCDC] flex items-center justify-center text-[#7C7C7C] font-mono text-[14px]">
        [Ø]
      </div>
      <div className="flex flex-col gap-1 max-w-[280px]">
        <h3 className="text-[15px] font-semibold text-[#0A0A0A] tracking-tight">{title}</h3>
        <p className="text-[13px] font-medium text-[#7C7C7C] leading-normal">{detail}</p>
      </div>
      {action && <div className="pt-2 w-full max-w-[240px]">{action}</div>}
    </ClayWell>
  );
}

export function LoadingState({ title = "Querying arc indexer", detail = "Reading latest on-chain block state...", className = "" }: Partial<StateProps>) {
  return (
    <ClayWell className={`p-6 flex flex-col items-center text-center gap-3 ${className}`}>
      <div className="w-8 h-8 rounded-full border-2 border-[#0A0A0A] border-t-transparent animate-spin" />
      <div className="flex flex-col gap-1 max-w-[280px]">
        <h3 className="text-[14px] font-mono font-semibold text-[#0A0A0A]">{title}</h3>
        <p className="text-[12px] font-medium text-[#7C7C7C]">{detail}</p>
      </div>
    </ClayWell>
  );
}

export function ErrorState({ title, detail, action, className = "" }: StateProps) {
  return (
    <ClayWell variant="deep" className={`p-6 flex flex-col items-center text-center gap-3 border-2 border-[#0A0A0A] ${className}`}>
      <div className="w-8 h-8 bg-[#0A0A0A] text-white flex items-center justify-center font-mono font-bold text-[14px]">
        !
      </div>
      <div className="flex flex-col gap-1 max-w-[280px]">
        <h3 className="text-[15px] font-semibold text-[#0A0A0A] tracking-tight">{title}</h3>
        <p className="text-[13px] font-medium text-[#5A5A5A] leading-normal">{detail}</p>
      </div>
      {action && <div className="pt-2 w-full max-w-[240px]">{action}</div>}
    </ClayWell>
  );
}
