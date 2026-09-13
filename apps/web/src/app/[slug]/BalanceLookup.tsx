"use client";

import { useState } from "react";
import { ClayWell } from "@/components/ui/ClayWell";
import { InputWell } from "@/components/ui/InputWell";
import { Button } from "@/components/ui/Button";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { fmtUsdc } from "@/lib/format";

/** The one interactive element on the public page — a real call to the
 * beneficiary lookup route, not a placeholder. */
export function BalanceLookup({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    found: boolean;
    address?: string;
    held?: string;
    error?: string;
  } | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/beneficiary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email })
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ found: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ClayWell variant="standard" className="p-5 flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-[#0A0A0A]">Find my beneficiary balance</h2>
      <p className="text-[13px] text-[#5A5A5A]">
        Enter the email registered with this business to look up your on-chain balance.
      </p>

      <form onSubmit={handleLookup} className="flex flex-col gap-3 pt-1">
        <InputWell
          label="Email"
          placeholder="you@company.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="primary" type="submit" loading={loading} disabled={!email.trim()}>
          Find my balance
        </Button>
      </form>

      {result && (
        <div className="mt-2 pt-3 border-t border-[#DCDCDC]">
          {result.found ? (
            <ClayWell variant="deep" className="p-3 flex flex-col gap-1 border border-[#0A0A0A]">
              <span className="text-[11px] font-medium text-[#7C7C7C]">Balance found</span>
              <span className="text-[18px] font-mono font-bold text-[#0A0A0A]">
                {result.held ? fmtUsdc(BigInt(result.held)) : "0.00 USDC"}
              </span>
              {result.address && (
                <div className="pt-1 flex items-center justify-between text-[12px]">
                  <span className="text-[#7C7C7C]">Wallet:</span>
                  <ExplorerLink type="address" value={result.address} />
                </div>
              )}
            </ClayWell>
          ) : (
            <p className="text-[13px] font-medium text-[#7C7C7C]">
              {result.error || "No balance found for that email at this business."}
            </p>
          )}
        </div>
      )}
    </ClayWell>
  );
}
