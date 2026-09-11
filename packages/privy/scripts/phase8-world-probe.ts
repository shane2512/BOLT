/**
 * Phase 8 — is `bolt-beneficiary-claim` usable without a Developer Portal step?
 *
 * Phase 6 established the one credential test that works with no device attached
 * (WORLD_FEEDBACK.md (c)3): if `request.pollOnce()` returns
 * `waiting_for_connection`, then `app_id`, `rp_id`, the RP signing key and the
 * action are all correct *together* — the sandbox bridge would not hold the
 * request otherwise.
 *
 * Phase 8 needs a second action. world-docs is clear that an action is a
 * per-purpose scope, not a per-app constant:
 *   /world-id/concepts            — "An app can have one or more actions
 *                                    depending on your use case"
 *   /world-id/SKILL     Phase 3   — "switching later means a new action"
 *   /world-id/4-0-migration       — "These apps create multiple one-time actions"
 * and the nullifier is scoped to it, so reusing `bolt-unlock-approval` for a
 * beneficiary claim would put a beneficiary's nullifier in the same scope as a
 * quorum approver's.
 *
 * What is *not* documented anywhere is whether an action string must be created
 * in the Developer Portal before the bridge will accept a request for it. This
 * script answers that empirically: same app, same RP, same signing key, only the
 * action changes.
 *
 *   pnpm --filter @bolt/privy phase8:world-probe
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
loadEnv({ path: join(REPO, ".env") });

// WORLD_FEEDBACK.md (d)6 — idkit-core loads its WASM from a file:// URL under
// Node, which fetch() refuses. Same shim as Phase 6.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("file://")) {
    return new Response(await readFile(new URL(url)), {
      headers: { "content-type": "application/wasm" }
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { IDKit, selfieCheckLegacy } = await import("@worldcoin/idkit-core");
const { signRequest } = await import("@worldcoin/idkit-core/signing");
const { hashSignal } = await import("@worldcoin/idkit-core/hashing");

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in ${join(REPO, ".env")}`);
  return v;
};

const APP_ID = need("WORLD_APP_ID") as `app_${string}`;
const RP_ID = need("WORLD_RP_ID");
const SIGNING_KEY = need("WORLD_RP_SIGNING_KEY");
const UNLOCK_ACTION = need("WORLD_ACTION_ID");
const CLAIM_ACTION = process.env.WORLD_BENEFICIARY_ACTION_ID ?? "bolt-beneficiary-claim";
const ENVIRONMENT = process.env.WORLD_ENVIRONMENT ?? "sandbox";

// The signal a beneficiary claim binds: the beneficiary and the exact withdrawal
// address the check is authorising. Probed here so the shape is proven before
// the flow depends on it.
const PROBE_SIGNAL = "phase8-probe:0x0000000000000000000000000000000000000001";

interface Probe {
  action: string;
  purpose: string;
  rp_signature_ok: boolean;
  request_id?: string;
  connect_url?: string;
  poll_once?: unknown;
  accepted: boolean;
  error?: string;
}

const probes: Probe[] = [];

for (const [action, purpose] of [
  [UNLOCK_ACTION, "Phase 6 control — an action that exists in the Developer Portal"],
  [CLAIM_ACTION, "Phase 8 — beneficiary first claim / address change"]
] as const) {
  const probe: Probe = { action, purpose, rp_signature_ok: false, accepted: false };
  try {
    const sig = signRequest({ signingKeyHex: SIGNING_KEY, action });
    probe.rp_signature_ok = Boolean(sig.sig);
    const request = await IDKit.request({
      app_id: APP_ID,
      action,
      rp_context: {
        rp_id: RP_ID,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig
      },
      allow_legacy_proofs: true,
      environment: ENVIRONMENT
    }).preset(selfieCheckLegacy({ signal: PROBE_SIGNAL }));

    const status = await request.pollOnce();
    probe.request_id = request.requestId;
    probe.connect_url = request.connectorURI;
    probe.poll_once = status;
    probe.accepted =
      typeof status === "object" &&
      status !== null &&
      (status as { type?: string }).type === "waiting_for_connection";
  } catch (e) {
    probe.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  console.log(
    `${action.padEnd(26)} rp_sig=${probe.rp_signature_ok} accepted=${probe.accepted}` +
      (probe.error ? ` error=${probe.error}` : "")
  );
  probes.push(probe);
}

const control = probes[0]!;
const claim = probes[1]!;

const verdict = !control.accepted
  ? "INCONCLUSIVE — the Phase 6 control action was not accepted either, so the bridge is not answering normally right now."
  : claim.accepted
    ? "NO PORTAL STEP NEEDED — the sandbox bridge holds a Selfie Check request for the new " +
      "action with the same app, RP and signing key. Actions are request-scoped strings, " +
      "not Portal-registered objects."
    : "PORTAL STEP NEEDED — the control action was accepted and the new one was not, so " +
      `"${CLAIM_ACTION}" has to be created in the Developer Portal by hand.`;

console.log(`\n${verdict}`);

if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  join(EVIDENCE, "phase8-world-action-probe.json"),
  JSON.stringify(
    {
      question:
        "Phase 8 needs a second World action for the beneficiary gates (FR-8.6/8.7). Does an " +
        "action string have to be created in the Developer Portal before World's bridge will " +
        "accept a proof request for it?",
      why_a_second_action:
        "world-docs /world-id/concepts: 'An app can have one or more actions depending on your " +
        "use case'; /world-id/SKILL Phase 3: 'switching later means a new action'. The nullifier " +
        "is scoped to (RP, action), so reusing bolt-unlock-approval would put a beneficiary's " +
        "nullifier in the same scope as a quorum approver's and make the two gates' " +
        "one-human-one-slot reasoning read across each other.",
      credentials: { app_id: APP_ID, rp_id: RP_ID, environment: ENVIRONMENT },
      signal_shape: {
        example: PROBE_SIGNAL,
        hashed: hashSignal(PROBE_SIGNAL),
        note:
          "A beneficiary claim binds the proof to (beneficiary, withdrawal address) so a proof " +
          "minted to authorise one address cannot be presented for another."
      },
      probes,
      verdict
    },
    null,
    2
  ) + "\n"
);
console.log("   -> docs/evidence/phase8-world-action-probe.json");
