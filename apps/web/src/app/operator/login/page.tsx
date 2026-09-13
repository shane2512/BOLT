"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AppFrame } from "@/components/AppFrame";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";

/**
 * Real Privy login, not a decorative form — `login()` opens Privy's own
 * hosted email-code flow. There is no password field anywhere in this
 * product; a session here proves a login happened, nothing more (see
 * lib/operator-session.ts for what it does and doesn't authorise).
 */
export default function OperatorLoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace("/operator");
  }, [ready, authenticated, router]);

  return (
    <AppFrame headerTitle="Operator sign in">
      <div className="p-4 flex-1 flex flex-col justify-center gap-6">
        <ClaySlab hero className="p-6 flex flex-col gap-4 items-center text-center">
          <h1 className="text-[20px] font-semibold text-[#0A0A0A]">Sign in to your business</h1>
          <p className="text-[14px] text-[#5A5A5A]">
            No password, no wallet to set up. Privy emails you a one-time code.
          </p>
          <Button variant="primary" onClick={login} disabled={!ready}>
            Continue
          </Button>
        </ClaySlab>
        <p className="text-[13px] text-[#7C7C7C] text-center">
          A session here proves you signed in. It does not let anything move client money — that&apos;s
          fixed by each account&apos;s Privy policy, and widening a lock needs your key quorum.
        </p>
      </div>
    </AppFrame>
  );
}
