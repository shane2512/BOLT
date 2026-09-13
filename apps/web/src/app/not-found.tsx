import React from "react";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <AppFrame headerTitle="404 Not Found" showBack>
      <div className="p-4 flex-1 flex flex-col justify-center items-center gap-6 text-center">
        <ClayWell variant="deep" className="p-6 border-2 border-[#0A0A0A] w-full flex flex-col items-center gap-3">
          <div className="w-12 h-12 bg-[#0A0A0A] text-white flex items-center justify-center font-mono font-bold text-[16px] rounded-full">
            404
          </div>
          <h2 className="text-[20px] font-semibold text-[#0A0A0A] tracking-tight">
            Page Not Found
          </h2>
          <p className="text-[14px] text-[#5A5A5A] leading-normal max-w-[280px]">
            The requested page or route does not exist on this custody instrument interface.
          </p>
        </ClayWell>

        <Link href="/" className="w-full max-w-[280px]">
          <Button variant="primary">Return to Instrument Home</Button>
        </Link>
      </div>
    </AppFrame>
  );
}
