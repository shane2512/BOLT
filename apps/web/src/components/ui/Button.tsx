import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "consequence" | "quiet";
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export function Button({
  children,
  variant = "primary",
  loading = false,
  fullWidth = true,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses =
    "min-h-[56px] px-6 rounded-full font-semibold text-[16px] tracking-tight flex items-center justify-center gap-2 select-none clay-press disabled:opacity-40 disabled:pointer-events-none";

  const variantClasses = {
    primary:
      "bg-[#0A0A0A] text-white shadow-[0_4px_12px_rgba(10,10,10,0.15)] active:bg-[#000000]",
    secondary:
      "bg-white text-[#0A0A0A] border border-[#DCDCDC] shadow-[2px_2px_6px_rgba(0,0,0,0.04),-2px_-2px_6px_rgba(255,255,255,0.9)] active:bg-[#F6F6F6]",
    consequence:
      "bg-white text-[#0A0A0A] border-2 border-[#0A0A0A] active:bg-[#F6F6F6]",
    quiet:
      "bg-transparent text-[#0A0A0A] hover:bg-[#F6F6F6] active:bg-[#EFEFEF]"
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${
        fullWidth ? "w-full" : "w-auto"
      } ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2 font-mono text-[14px]">
          <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          Processing...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
