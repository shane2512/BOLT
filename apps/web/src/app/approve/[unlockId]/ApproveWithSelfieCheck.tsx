"use client";

/**
 * FR-5.3 — the approver's half of the ceremony, on a phone.
 *
 * The button does nothing on its own. It opens IDKit, World runs the Selfie
 * Check, and the resulting proof is posted to `/api/unlock/[id]/approve`
 * **verbatim** — no field is remapped, no `verification_level` is hand-built,
 * nothing is trimmed. world-docs is blunt about this and it is the single
 * easiest way to break a working integration.
 *
 * The RP context comes from the server (`/api/world/rp-signature`) because the
 * RP signing key must never reach a browser: whoever holds it can forge proof
 * requests from BOLT, which here means forging the human half of an unlock.
 *
 * Worked from world-docs:
 *   /world-id/idkit/integrate.mdx        — steps 3–5, and the React widget shape
 *   /world-id/idkit/credentials.mdx      — `selfieCheckLegacy()`
 *   /world-id/sandbox/sandbox-access.mdx — environment: "sandbox" while testing
 */
import { useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";

interface RpSignatureResponse {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
  app_id: string;
  action: string;
  environment: string;
}

type Outcome =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "verifying" }
  | { kind: "approved"; approvals: number; threshold: number; humanProofRef: string; approvedTx: string }
  | { kind: "error"; message: string };

export default function ApproveWithSelfieCheck({
  unlockRequestId,
  approverId
}: {
  unlockRequestId: string;
  approverId: string;
}) {
  const [open, setOpen] = useState(false);
  const [rp, setRp] = useState<RpSignatureResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function start() {
    setOutcome({ kind: "preparing" });
    const response = await fetch("/api/world/rp-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "unlock-approval" })
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setOutcome({
        kind: "error",
        message:
          body?.error ??
          "World is not configured yet. The Developer Portal app, RP and action have to exist first."
      });
      return;
    }
    setRp((await response.json()) as RpSignatureResponse);
    setOutcome({ kind: "idle" });
    setOpen(true);
  }

  const rpContext: RpContext | null = rp
    ? {
        rp_id: rp.rp_id,
        nonce: rp.nonce,
        created_at: rp.created_at,
        expires_at: rp.expires_at,
        signature: rp.sig
      }
    : null;

  async function handleVerify(result: IDKitResult) {
    setOutcome({ kind: "verifying" });
    const response = await fetch(`/api/unlock/${unlockRequestId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Verbatim. Do not reshape this object.
      body: JSON.stringify({ approverId, idkitResult: result })
    });
    const body = (await response.json().catch(() => null)) as
      | { approved?: boolean; approvals?: number; threshold?: number; humanProofRef?: string; approvedTx?: string; error?: string }
      | null;

    if (!response.ok || !body?.approved) {
      // Throwing tells IDKit the verification did not land, so the widget does
      // not report success for an approval the backend refused.
      setOutcome({ kind: "error", message: body?.error ?? "approval refused" });
      throw new Error(body?.error ?? "approval refused");
    }

    setOutcome({
      kind: "approved",
      approvals: body.approvals ?? 0,
      threshold: body.threshold ?? 0,
      humanProofRef: body.humanProofRef ?? "",
      approvedTx: body.approvedTx ?? ""
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={start}
        disabled={outcome.kind === "preparing" || outcome.kind === "verifying" || outcome.kind === "approved"}
        className="w-full rounded-lg bg-black px-4 py-4 text-base font-medium text-white disabled:opacity-40"
      >
        {outcome.kind === "preparing"
          ? "Preparing…"
          : outcome.kind === "verifying"
            ? "Verifying with World…"
            : outcome.kind === "approved"
              ? "Approved"
              : "Approve with Selfie Check"}
      </button>

      <p className="text-xs text-gray-500">
        Your approval counts only once World confirms a completed Selfie Check. BOLT does not decide
        whether you are a person; World does, and the proof reference it returns is recorded with
        your approval and shown on the public page.
      </p>

      {rpContext && rp ? (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={rp.app_id as `app_${string}`}
          action={rp.action}
          rp_context={rpContext}
          allow_legacy_proofs
          environment={rp.environment as "production" | "staging" | "sandbox"}
          preset={selfieCheckLegacy({ signal: unlockRequestId })}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code) => setOutcome({ kind: "error", message: `IDKit error: ${code}` })}
        />
      ) : null}

      {outcome.kind === "approved" ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">
            Approval {outcome.approvals} of {outcome.threshold} recorded.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-green-700">
            proof {outcome.humanProofRef}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-green-700">tx {outcome.approvedTx}</p>
        </div>
      ) : null}

      {outcome.kind === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Not approved.</p>
          <p className="mt-1 break-words">{outcome.message}</p>
        </div>
      ) : null}
    </div>
  );
}
