"use client";

/**
 * The operator's console. FR-9.1 (any visitor, full privileges), FR-9.2 (the raw
 * enclave error, unedited), FR-9.3 (the running tally).
 *
 * There is no client-side destination validation beyond "can this be encoded as
 * an address", and no friendly error mapping. What the enclave said is printed
 * as JSON, in full, because a refusal is the product working and a paraphrase of
 * it would be us asking to be believed instead of showing the receipt.
 */
import { useCallback, useEffect, useState } from "react";

type Attack = {
  id: string;
  label: string;
  expect: "ALLOW" | "REFUSE";
  stoppedBy: string;
  usesDestination: boolean;
};

type Tally = {
  attempts: number;
  refusals: number;
  allowed: number;
  recent: {
    at: string;
    attackId: string;
    label: string;
    expect: string;
    destination: string;
    outcome: string;
    policyViolation: boolean;
  }[];
};

type AttemptResponse = {
  attack: Attack;
  destination: string;
  outcome: "ALLOWED" | "REFUSED";
  policyViolation: boolean;
  rawError?: unknown;
  signedTransaction?: unknown;
  transaction?: Record<string, unknown>;
  tally: Tally;
  error?: string;
};

const EMPTY_TALLY: Tally = { attempts: 0, refusals: 0, allowed: 0, recent: [] };

/** 18 decimals: on Arc the native token is USDC itself. */
function fmtNative(wei: string | null): string {
  if (wei === null) return "unavailable";
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac} USDC`;
}

export default function SimulatorConsole() {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [balanceWei, setBalanceWei] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/simulator");
    const body = (await res.json()) as { attacks: Attack[]; tally: Tally; balanceWei: string | null };
    setAttacks(body.attacks);
    setTally(body.tally);
    setBalanceWei(body.balanceWei);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function attempt(attack: Attack) {
    setBusy(attack.id);
    setResult(null);
    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attackId: attack.id, destination: destination.trim() })
      });
      const body = (await res.json()) as AttemptResponse;
      setResult(body);
      if (body.tally) setTally(body.tally);
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  const canAttempt = /^0x[0-9a-fA-F]{40}$/.test(destination.trim());

  return (
    <section className="space-y-6">
      <div className="border rounded p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Steal it</h2>
          <span className="text-xs text-gray-500">
            account holds {fmtNative(balanceWei)} · read live from Arc
          </span>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Your address — where the money should go
          </span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="0x…"
            className="mt-1 w-full border rounded px-3 py-2 font-mono text-xs"
            spellCheck={false}
          />
        </label>
        {!canAttempt && destination.trim().length > 0 && (
          <p className="text-xs text-amber-700">
            That is not a 20-byte EVM address, so there is no calldata to build. This is the
            only thing on this page that stops you — and it is an encoder limit, not a check on
            where you are sending it.
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          {attacks.map((a) => (
            <button
              key={a.id}
              onClick={() => void attempt(a)}
              disabled={!canAttempt || busy !== null}
              className={`text-left border rounded p-3 transition-colors disabled:opacity-40 ${
                a.expect === "ALLOW"
                  ? "border-green-300 bg-green-50 hover:bg-green-100"
                  : "hover:bg-gray-50"
              }`}
            >
              <span className="block font-medium text-xs">{a.label}</span>
              <span className="block text-[11px] text-gray-500 mt-1 font-mono break-all">
                {busy === a.id ? "asking the enclave…" : a.stoppedBy}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* FR-9.3 — the running tally */}
      <div className="border rounded p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Tally</h2>
          <span className="text-xs text-gray-500">
            counts requests this server has handled since it started
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-4 mt-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Attempts</dt>
            <dd className="text-2xl font-semibold">{tally.attempts}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Refused</dt>
            <dd className="text-2xl font-semibold text-green-700">{tally.refusals}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Signed</dt>
            <dd className="text-2xl font-semibold">{tally.allowed}</dd>
          </div>
        </dl>
        {tally.recent.length > 0 && (
          <ul className="mt-4 space-y-1 text-[11px] font-mono">
            {tally.recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-wrap gap-2">
                <span className="text-gray-400">{r.at.slice(11, 19)}</span>
                <span className={r.outcome === "REFUSED" ? "text-green-700" : "text-red-700"}>
                  {r.outcome}
                </span>
                <span className="text-gray-600">{r.attackId}</span>
                <span className="text-gray-400 break-all">→ {r.destination}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* FR-9.2 — the raw enclave error, exactly as Privy threw it */}
      {result && (
        <div className="border rounded p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {result.error
                ? "Request rejected before it reached Privy"
                : result.outcome === "REFUSED"
                  ? "Refused by the enclave — no signature was produced"
                  : "Signed"}
            </h2>
            {result.policyViolation && (
              <span className="text-xs uppercase tracking-wide text-green-700">
                policy_violation
              </span>
            )}
          </div>

          {result.outcome === "ALLOWED" && result.attack?.expect === "REFUSE" && (
            <p className="text-sm text-red-700 font-medium">
              The enclave signed this. That is a broken lock, and the signed transaction below is
              spendable. Please tell us.
            </p>
          )}

          {result.transaction && (
            <details>
              <summary className="cursor-pointer text-xs text-gray-500">
                what was sent to Privy
              </summary>
              <pre className="mt-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-all bg-gray-50 p-3 rounded border">
                {JSON.stringify(result.transaction, null, 2)}
              </pre>
            </details>
          )}

          <div>
            <p className="text-xs text-gray-500 mb-1">
              {result.outcome === "REFUSED"
                ? "Privy's error, verbatim. Not reworded, not summarised, not caught and replaced."
                : "The enclave's response."}
            </p>
            <pre className="text-[11px] overflow-x-auto whitespace-pre-wrap break-all bg-gray-50 p-3 rounded border">
              {JSON.stringify(
                result.rawError ?? result.signedTransaction ?? result.error ?? result,
                null,
                2
              )}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
