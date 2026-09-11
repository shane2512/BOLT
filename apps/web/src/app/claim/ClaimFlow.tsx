"use client";

/**
 * FR-8.2 / FR-8.6 / FR-8.7 / FR-8.8 / FR-8.4 — the beneficiary flow.
 *
 * Four states, and the whole design goal is that only two of them are ever
 * visible to a returning seller:
 *
 *   1. email + code            (FR-8.2, `useLoginWithEmail`)
 *   2. balance + Withdraw      — no fresh check needed (FR-8.8)
 *   3. Selfie Check first      — first claim, changed address, or a device this
 *                                account has not withdrawn from before
 *                                (FR-8.6, FR-8.7)
 *   4. Withdraw to another chain (FR-8.4, Arc App Kit / Bridge Kit → CCTP)
 *
 * The device id is a random value kept in this browser's localStorage. It is
 * NOT an authentication factor — the server treats an absent or unknown device
 * as a reason to ask for *more* proof, never less, and a forged one still has
 * to get past the address rule above it.
 *
 * Worked from privy-docs /basics/react/quickstart.mdx (useLoginWithEmail) and
 * world-docs /world-id/idkit/integrate steps 3–5.
 */
import { useCallback, useEffect, useState } from "react";
import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import WithdrawToChain from "./WithdrawToChain";

interface Gate {
  required: boolean;
  reason: string;
}

interface Status {
  found: boolean;
  walletAddress?: string | null;
  withdrawalAddress?: string | null;
  outstanding?: string;
  obligations?: { id: string; amount: string }[];
  selfieCheck?: Gate | null;
  signal?: string;
  action?: string;
}

interface RpSignature {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
  app_id: string;
  action: string;
  environment: string;
}

const fmt = (base: string): string => {
  const n = BigInt(base || "0");
  return `${(n / 1_000_000n).toString()}.${(n % 1_000_000n).toString().padStart(6, "0")} USDC`;
};

/** Stable per-browser id. Continuity signal only — never an auth factor. */
function deviceId(): string {
  const KEY = "bolt.deviceId";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private window, or storage blocked. An unknown device means a fresh
    // Selfie Check, which is the safe direction to fail in.
    return "";
  }
}

export default function ClaimFlow({ slug }: { slug: string }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<Status | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [rp, setRp] = useState<RpSignature | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [paid, setPaid] = useState<{ amount: string; transferTx: string } | null>(null);

  const loginEmail =
    (user?.email?.address as string | undefined) ?? (authenticated ? email : "");

  const refresh = useCallback(
    async (address?: string) => {
      if (!loginEmail) return;
      const params = new URLSearchParams({ slug, email: loginEmail, deviceId: deviceId() });
      if (address) params.set("address", address);
      const res = await fetch(`/api/beneficiary/claim?${params}`);
      setStatus((await res.json()) as Status);
    },
    [loginEmail, slug]
  );

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);

  if (!ready) return <p className="text-sm text-gray-500">Loading…</p>;

  // ---- 1. Familiar login (FR-8.2) -----------------------------------------
  if (!authenticated) {
    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="claim-email">
          Email address
        </label>
        <input
          id="claim-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border px-3 py-3"
        />
        {codeSent ? (
          <>
            <label className="block text-sm font-medium" htmlFor="claim-code">
              Code we just emailed you
            </label>
            <input
              id="claim-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              className="w-full rounded-lg border px-3 py-3 font-mono tracking-widest"
            />
          </>
        ) : null}
        <button
          type="button"
          disabled={busy || (!codeSent && !email)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (!codeSent) {
                await sendCode({ email });
                setCodeSent(true);
              } else {
                await loginWithCode({ code });
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-40"
        >
          {busy ? "…" : codeSent ? "Sign in" : "Email me a code"}
        </button>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <p className="text-xs text-gray-500">
          No seed phrase, no wallet to install, no gas to buy. A wallet was created for you when
          the money was allocated; signing in is how you reach it.
        </p>
      </div>
    );
  }

  // ---- 2–4. Signed in ------------------------------------------------------
  if (!status) return <p className="text-sm text-gray-500">Loading your balance…</p>;

  if (!status.found) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          No balance is held for <span className="font-mono">{loginEmail}</span> at{" "}
          <span className="font-mono">{slug}</span>.
        </p>
        <button type="button" onClick={() => void logout()} className="text-sm underline">
          Sign out
        </button>
      </div>
    );
  }

  const address = newAddress || status.withdrawalAddress || status.walletAddress || "";
  const gate = status.selfieCheck;
  const obligation = status.obligations?.[0];

  async function startSelfieCheck() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/world/rp-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "beneficiary-claim" })
    });
    setBusy(false);
    if (!res.ok) {
      setError("World is not configured — the Developer Portal app, RP and action must exist.");
      return;
    }
    setRp((await res.json()) as RpSignature);
    setWidgetOpen(true);
  }

  async function handleVerify(result: IDKitResult) {
    const res = await fetch("/api/beneficiary/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "verify",
        slug,
        email: loginEmail,
        address,
        reason: gate?.reason ?? "FIRST_CLAIM",
        deviceId: deviceId() || null,
        // Verbatim. Do not reshape this object.
        idkitResult: result
      })
    });
    const body = (await res.json().catch(() => null)) as { verified?: boolean; error?: string } | null;
    if (!res.ok || !body?.verified) {
      setError(body?.error ?? "Selfie Check was not accepted");
      // Tell IDKit the verification did not land, so the widget does not report
      // success for something the backend refused.
      throw new Error(body?.error ?? "Selfie Check was not accepted");
    }
    await refresh(address);
  }

  async function withdraw() {
    if (!obligation) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/beneficiary/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "withdraw",
        slug,
        email: loginEmail,
        address,
        obligationId: obligation.id,
        deviceId: deviceId() || null
      })
    });
    const body = (await res.json().catch(() => null)) as
      | { paid?: boolean; amount?: string; transferTx?: string; error?: string }
      | null;
    setBusy(false);
    if (!res.ok || !body?.paid) {
      setError(body?.error ?? "withdrawal refused");
      await refresh(address);
      return;
    }
    setPaid({ amount: body.amount ?? "0", transferTx: body.transferTx ?? "" });
    await refresh(address);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">Held for you</p>
        <p className="mt-1 text-3xl font-semibold">{fmt(status.outstanding ?? "0")}</p>
        <p className="mt-2 break-all font-mono text-xs text-gray-500">{address}</p>
        <p className="mt-1 text-xs text-gray-500">
          Signed in as {loginEmail} ·{" "}
          <button type="button" onClick={() => void logout()} className="underline">
            sign out
          </button>
        </p>
      </section>

      {gate?.required ? (
        <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {gate.reason === "FIRST_CLAIM"
              ? "One-time check before your first withdrawal"
              : gate.reason === "ADDRESS_CHANGE"
                ? "You changed your withdrawal address — please confirm it is you"
                : "We do not recognise this device — please confirm it is you"}
          </p>
          <p className="text-xs text-amber-900">
            World runs a Selfie Check. BOLT does not decide whether you are a person; World does,
            and the proof reference is recorded against this address. After this, withdrawals to
            the same address from this device go straight through.
          </p>
          <button
            type="button"
            onClick={() => void startSelfieCheck()}
            disabled={busy}
            className="w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-40"
          >
            {busy ? "Preparing…" : "Confirm with Selfie Check"}
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => void withdraw()}
            disabled={busy || !obligation}
            className="w-full rounded-lg bg-black px-4 py-4 text-base font-medium text-white disabled:opacity-40"
          >
            {busy ? "Sending…" : obligation ? `Withdraw ${fmt(obligation.amount)}` : "Nothing to withdraw"}
          </button>
          <p className="text-xs text-gray-500">
            No further check — you have already confirmed this address from this device.
          </p>
          {/* FR-8.4 — one button, another chain. */}
          <WithdrawToChain address={address} />
        </section>
      )}

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm">Withdraw somewhere else</summary>
        <p className="mt-2 text-xs text-gray-500">
          Changing your withdrawal address needs a fresh Selfie Check. This is the control that
          stops a stolen session quietly redirecting your balance.
        </p>
        <input
          value={newAddress}
          onChange={(e) => setNewAddress(e.currentTarget.value)}
          placeholder="0x…"
          className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void refresh(newAddress)}
          disabled={!newAddress}
          className="mt-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
        >
          Use this address
        </button>
      </details>

      {paid ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">{fmt(paid.amount)} sent.</p>
          <p className="mt-1 break-all font-mono text-xs text-green-700">{paid.transferTx}</p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Not sent.</p>
          <p className="mt-1 break-words">{error}</p>
        </div>
      ) : null}

      {rp ? (
        <IDKitRequestWidget
          open={widgetOpen}
          onOpenChange={setWidgetOpen}
          app_id={rp.app_id as `app_${string}`}
          action={rp.action}
          rp_context={
            {
              rp_id: rp.rp_id,
              nonce: rp.nonce,
              created_at: rp.created_at,
              expires_at: rp.expires_at,
              signature: rp.sig
            } satisfies RpContext
          }
          allow_legacy_proofs
          environment={rp.environment as "production" | "staging" | "sandbox"}
          // Bound to (beneficiary, address) by the server. A proof minted to
          // authorise one address cannot be presented for another.
          preset={selfieCheckLegacy({ signal: status.signal ?? "" })}
          handleVerify={handleVerify}
          onSuccess={() => setWidgetOpen(false)}
          onError={(codeValue) => setError(`IDKit error: ${codeValue}`)}
        />
      ) : null}
    </div>
  );
}
