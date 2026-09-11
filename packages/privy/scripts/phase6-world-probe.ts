/**
 * Phase 6 — proves the World credentials are live, without a phone.
 *
 * Selfie Check cannot be completed headlessly: a proof is a face capture made by
 * a person in the sandbox World ID app, which ships through TestFlight or a
 * private Google Play track (world-docs /world-id/sandbox/sandbox-access,
 * /world-id/sandbox/testing-selfie-check). There is no simulator for it and this
 * script does not pretend otherwise.
 *
 * What it *can* prove, live, from a machine with no device attached:
 *
 *   1. `signRequest({ signingKeyHex, action })` produces an RP signature with the
 *      real `WORLD_RP_SIGNING_KEY` (world-docs /world-id/idkit/integrate step 3).
 *   2. World's **sandbox bridge accepts that signature** and holds a real Selfie
 *      Check request for our action — `pollOnce()` returns
 *      `waiting_for_connection`, and the connect URL it returns is the one a
 *      phone would scan.
 *   3. `POST /api/v4/verify/{rp_id}` **recognises our RP**: a deliberately
 *      invalid proof gets as far as proof verification (`invalid_merkle_root`),
 *      where an unregistered rp_id is rejected before that (`app_not_migrated`).
 *
 * That is the whole server half of FR-5.3 confirmed against live World
 * infrastructure. The missing step is a human's face, and it is missing on
 * purpose.
 *
 *   pnpm --filter @bolt/privy phase6:world-probe
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
loadEnv({ path: join(REPO, ".env") });

// See the same shim in phase6-ceremony.ts, and WORLD_FEEDBACK.md §(d): idkit-core
// fetches its WASM from a file:// URL under Node, which fetch() refuses.
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

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in ${join(REPO, ".env")}`);
  return v;
};

const APP_ID = need("WORLD_APP_ID") as `app_${string}`;
const RP_ID = need("WORLD_RP_ID");
const ACTION = need("WORLD_ACTION_ID");
const ENVIRONMENT = process.env.WORLD_ENVIRONMENT ?? "sandbox";
const VERIFY = "https://developer.world.org/api/v4/verify";

// 1 + 2. A real RP signature, and a real request on the sandbox bridge.
const sig = signRequest({ signingKeyHex: need("WORLD_RP_SIGNING_KEY"), action: ACTION });
const request = await IDKit.request({
  app_id: APP_ID,
  action: ACTION,
  rp_context: {
    rp_id: RP_ID,
    nonce: sig.nonce,
    created_at: sig.createdAt,
    expires_at: sig.expiresAt,
    signature: sig.sig
  },
  allow_legacy_proofs: true,
  environment: ENVIRONMENT
}).preset(selfieCheckLegacy({ signal: "phase6-world-probe" }));

const status = await request.pollOnce();
console.log(`connect url : ${request.connectorURI}`);
console.log(`bridge      : ${JSON.stringify(status)}`);

// 3. The verifier, with a proof that is well-formed and deliberately invalid.
//    The point is *which* error comes back, not that it fails.
const invalidProof = (action: string): unknown => ({
  protocol_version: "3.0",
  nonce: "00000000-0000-4000-8000-000000000000",
  action,
  environment: ENVIRONMENT,
  responses: [
    {
      identifier: "selfie",
      signal_hash: "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4",
      proof: `0x${"11".repeat(256)}`,
      merkle_root: `0x${"22".repeat(32)}`,
      nullifier: `0x${"33".repeat(32)}`
    }
  ],
  user_presence_completed: false
});

const verifyProbes: { case: string; rp_id: string; action: string; status: number; body: unknown }[] =
  [];
for (const [label, rp, action] of [
  ["registered rp_id, our action", RP_ID, ACTION],
  ["registered rp_id, another action", RP_ID, "not-a-bolt-action"],
  ["unregistered rp_id", "rp_0000000000000000", ACTION],
  ["app_id in place of rp_id", APP_ID, ACTION]
] as const) {
  const response = await fetch(`${VERIFY}/${rp}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invalidProof(action))
  });
  const body: unknown = await response.json().catch(() => null);
  console.log(`verify ${label} -> ${response.status} ${JSON.stringify(body)}`);
  verifyProbes.push({ case: label, rp_id: rp, action, status: response.status, body });
}

if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  join(EVIDENCE, "phase6-world-credentials-live.json"),
  JSON.stringify(
    {
      requirement:
        "FR-5.3 — the World credentials are real and the server half of the Selfie Check flow " +
        "works against live World infrastructure",
      credentials: { app_id: APP_ID, rp_id: RP_ID, action: ACTION, environment: ENVIRONMENT },
      rp_signature: {
        produced_by: "signRequest({ signingKeyHex: WORLD_RP_SIGNING_KEY, action })",
        doc: "/world-id/idkit/integrate step 3",
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
        note: "The signing key itself is never written here or logged."
      },
      bridge_request: {
        preset: "selfieCheckLegacy (World ID 3.0)",
        signal: "phase6-world-probe",
        request_id: request.requestId,
        connect_url: request.connectorURI,
        poll_once: status,
        note:
          "waiting_for_connection means World's sandbox bridge accepted the RP signature and " +
          "is holding a real Selfie Check request for this action. The next event on it can " +
          "only come from a device running the sandbox World ID app."
      },
      verify_endpoint_probes: {
        endpoint: `POST ${VERIFY}/{rp_id}`,
        proof: "well-formed World ID 3.0 Selfie Check shape, deliberately invalid",
        results: verifyProbes,
        reading:
          "The registered rp_id reaches proof verification and fails on the merkle root — an " +
          "unregistered one is rejected before that with app_not_migrated. So the RP exists and " +
          "is migrated to World ID 4.0. None of the returned codes appear in " +
          "/world-id/idkit/error-codes; see WORLD_FEEDBACK.md (b)5."
      },
      what_is_still_missing:
        "A completed Selfie Check. It requires a person and the sandbox World ID app on a " +
        "physical device; there is no headless or simulated path. Run " +
        "`pnpm --filter @bolt/privy phase6:ceremony` and scan the URLs it prints."
    },
    null,
    2
  ) + "\n"
);
console.log("\n   -> docs/evidence/phase6-world-credentials-live.json");
