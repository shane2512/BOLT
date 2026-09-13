import React from "react";

interface ClayWellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "standard" | "deep" | "pressed";
  className?: string;
}

export function ClayWell({
  children,
  variant = "standard",
  className = "",
  ...props
}: ClayWellProps) {
  const variantClasses = {
    standard: "clay-well bg-[#EFEFEF] border-[#DCDCDC]",
    deep: "clay-well-deep bg-[#E7E7E7] border-[#C4C4C4]",
    pressed: "clay-well-pressed bg-[#EFEFEF] border-[#DCDCDC]"
  };

  return (
    <div
      className={`rounded-2xl p-4 transition-all duration-120 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
