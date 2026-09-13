import React from "react";

interface InputWellProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  caption?: string;
  error?: string;
  isMono?: boolean;
}

export function InputWell({
  label,
  caption,
  error,
  isMono = false,
  className = "",
  id,
  ...props
}: InputWellProps) {
  const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="w-full flex flex-col gap-1">
      <div className="clay-well bg-[#EFEFEF] rounded-2xl p-3.5 border border-[#DCDCDC] focus-within:border-[#0A0A0A] focus-within:ring-1 focus-within:ring-[#0A0A0A] transition-all">
        <label
          htmlFor={inputId}
          className="block text-[12px] font-medium text-[#7C7C7C] leading-tight select-none"
        >
          {label}
        </label>
        <input
          id={inputId}
          className={`w-full bg-transparent text-[#0A0A0A] text-[15px] font-medium leading-tight outline-none placeholder-[#A0A0A0] mt-1 ${
            isMono ? "font-mono text-[13px]" : ""
          } ${className}`}
          {...props}
        />
      </div>
      {caption && !error && (
        <span className="text-[12px] font-medium text-[#7C7C7C] px-1">
          {caption}
        </span>
      )}
      {error && (
        <span className="text-[12px] font-semibold text-[#0A0A0A] px-1 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 bg-[#0A0A0A]" />
          {error}
        </span>
      )}
    </div>
  );
}
