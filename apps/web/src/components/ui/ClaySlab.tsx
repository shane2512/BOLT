import React from "react";

interface ClaySlabProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hero?: boolean;
  interactive?: boolean;
  className?: string;
}

export function ClaySlab({
  children,
  hero = false,
  interactive = false,
  className = "",
  ...props
}: ClaySlabProps) {
  return (
    <div
      className={`rounded-2xl p-5 transition-all duration-120 ${
        hero ? "clay-slab-hero bg-white border-black/10" : "clay-slab bg-white border-black/5"
      } ${interactive ? "clay-press cursor-pointer hover:border-black/20" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
