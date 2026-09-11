"use client";

/**
 * FR-6.7 — a beneficiary enters their email and sees their own balance and the
 * address holding it. The email -> wallet-address lookup is a Postgres
 * directory operation (legitimate; it's not a figure). The balance this then
 * shows always comes back from `/api/beneficiary`, which reads it from the
 * subgraph or directly on chain — never from Postgres (invariant 8).
 */
import { useState } from "react";

type Result =
  | { found: false }
  | { found: true; address: string; held: string; source: "subgraph-account" | "onchain-balance" };

export default function BeneficiaryLookup({ slug, explorerUrl }: { slug: string; explorerUrl: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setResult(null);
    try {
      const res = await fetch("/api/beneficiary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email })
      });
      if (!res.ok) throw new Error(`lookup failed: HTTP ${res.status}`);
      const body: Result = await res.json();
      setResult(body);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 max-w-sm">
      <label htmlFor="beneficiary-email" className="text-sm text-gray-600">
        Beneficiary email
      </label>
      <div className="flex gap-2">
        <input
          id="beneficiary-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="border rounded px-2 py-1 text-sm flex-1"
        />
        <button type="submit" disabled={status === "loading"} className="border rounded px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200">
          {status === "loading" ? "Looking up…" : "Look up"}
        </button>
      </div>
      {status === "error" && <p className="text-sm text-red-600">Lookup failed. Try again.</p>}
      {result && !result.found && <p className="text-sm text-gray-600">No beneficiary found for that email on this business.</p>}
      {result && result.found && (
        <div className="text-sm border rounded p-3 bg-gray-50">
          <p>
            Address:{" "}
            <a href={`${explorerUrl}/address/${result.address}`} target="_blank" rel="noopener noreferrer" className="underline">
              {result.address}
            </a>
          </p>
          <p>Held: {result.held} USDC base units</p>
          <p className="text-xs text-gray-500 mt-1">
            source: {result.source === "subgraph-account" ? "indexed BOLT account (subgraph)" : "live on-chain balance (Arc RPC)"}
          </p>
        </div>
      )}
    </form>
  );
}
