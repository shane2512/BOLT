/**
 * Phase 6 — the live unlock ceremony, with real World Selfie Checks (FR-5).
 *
 * `phase6-unlock.ts` proved everything that does not need a human: the 3-of-5
 * key quorum, the calldata-decoding policy, `UnlockRequested` on Arc, the
 * deployed 24-hour timer, and the World gate refusing an approval that has no
 * Selfie Check. This script is the other half — the *positive* path, which needs
 * a person with a phone, because that is precisely what Selfie Check attests.
 *
 * What it does, per approver, three times:
 *
 *   1. Mints an RP signature server-side with `WORLD_RP_SIGNING_KEY`
 *      (world-docs /world-id/idkit/integrate step 3 — `signRequest({
 *      signingKeyHex, action })` → `{ sig, nonce, createdAt, expiresAt }`).
 *   2. Opens a real IDKit request against the **sandbox** bridge, with the
 *      `selfieCheckLegacy()` preset and `signal` bound to this unlock's id, and
 *      prints the connect URL.
 *   3. Waits. A human opens that URL on a device running the sandbox World ID
 *      app and completes the Selfie Check. There is no way to skip this and no
 *      flag that pretends it happened (CLAUDE.md invariant 6).
 *   4. Hands the IDKit result to `approveUnlock` **verbatim**, which forwards it
 *      to `POST /api/v4/verify/{rp_id}`, and only then produces this member's
 *      quorum signature and records `UnlockApproved` on chain.
 *
 * The third approval arms `BoltUnlockTimer`. Execution is then attempted: Privy
 * signs (three real signatures, each behind a real Selfie Check) and the timer
 * refuses to release, because 24 hours have not passed. That refusal is the
 * correct outcome on the day of the run — the delay is real and is not
 * shortened for a demo.
 *
 * Requires: docs/evidence/phase6-state.json from `pnpm --filter @bolt/privy
 * phase6:unlock` (the quorum's keys and the provisioned business), and a device
 * with the sandbox World ID app (world-docs /world-id/sandbox/sandbox-access —
 * TestFlight on iOS, a private Google Play track on Android; there is no
 * headless Selfie Check).
 *
 *   pnpm --filter @bolt/privy phase6:ceremony
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { accounts as accountsTable, businesses, type BoltDb } from "@bolt/db";
import { eq } from "drizzle-orm";
import {
  businessIdOf,
  createRegistryWriter,
  createUnlockTimer,
  usdc
} from "@bolt/core";
import {
  approveUnlock,
  executeUnlock,
  rawErrorBody,
  requestUnlock,
  type ProvisionedBusiness,
  type UnlockCeremonyConfig
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase6-state.json");

loadEnv({ path: join(REPO, ".env") });

/**
 * idkit-core loads its WASM with `fetch(new URL("idkit_wasm_bg.wasm",
 * import.meta.url))`. Under Node that URL is `file://…`, which `fetch` refuses,
 * so `IDKit.request` cannot initialise at all outside a browser. Shimmed here
 * rather than worked around, and reported in docs/WORLD_FEEDBACK.md §(d).
 *
 * Scripts only. The product's own IDKit call is a client component, where the
 * bundler serves the asset over http and this does not arise.
 */
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

const RPC_URL = need("ARC_RPC_URL");
const CHAIN_ID = Number(need("ARC_CHAIN_ID"));
const USDC = need("USDC_ADDRESS");
const REGISTRY = getAddress(need("REGISTRY_ADDRESS"));
const TIMER = getAddress(need("UNLOCK_TIMER_ADDRESS"));
const EXPLORER = "https://testnet.arcscan.app";

const WORLD_APP_ID = need("WORLD_APP_ID") as `app_${string}`;
const WORLD_RP_ID = need("WORLD_RP_ID");
const WORLD_SIGNING_KEY = need("WORLD_RP_SIGNING_KEY");
const WORLD_ACTION = need("WORLD_ACTION_ID");
const WORLD_ENV = (process.env.WORLD_ENVIRONMENT ?? "sandbox") as
  | "production"
  | "staging"
  | "sandbox";

const SLUG = "bolt-unlock-demo";
const APPROVALS_WANTED = Number(process.env.PHASE6_APPROVALS ?? 3);
/** How long one approver has to pick up their phone. IDKit's own default is 15m. */
const POLL_TIMEOUT_MS = Number(process.env.PHASE6_POLL_TIMEOUT_MS ?? 900_000);
const UNLOCK_AMOUNT = usdc(25_000_000n);
const REASON =
  "Buyer confirmed delivery and waived the 14-day hold. Releasing the seller's " +
  "escrowed balance early, to the address already permitted by this account's policy.";

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

type State = {
  quorumMembers?: { label: string; publicKey: string; privateKey: string; address: string }[];
  permittedPayee?: string;
  provisioned?: ProvisionedBusiness;
};
if (!existsSync(STATE_FILE)) {
  throw new Error(
    `${STATE_FILE} is missing. Run \`pnpm --filter @bolt/privy phase6:unlock\` first — ` +
      `it provisions the business and the 3-of-5 key quorum this ceremony signs with.`
  );
}
const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
const members = state.quorumMembers;
const business = state.provisioned;
const PAYEE = state.permittedPayee;
if (!members || !business || !PAYEE) throw new Error("phase6-state.json is incomplete");
const locked = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY");
if (!locked) throw new Error("phase6-state.json has no CLIENT_MONEY account");

// ---------------------------------------------------------------------------

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});
const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});
const timer = createUnlockTimer({
  timerAddress: TIMER,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});
const onChainBusinessId = businessIdOf(SLUG);
const recorder = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address;

/**
 * The real Postgres if it can be reached, PGlite if not.
 *
 * It matters which: the public page reads the unlock's *free text* from
 * Postgres (its keccak is the on-chain commitment beside it — FR-5.6). On
 * PGlite the ceremony still completes and the page still renders the unlock,
 * its hash and its approvers from the subgraph, but the prose is missing, which
 * is the page's documented degradation and not what we want on a real run.
 * Direct Postgres ports are unreachable from some build sandboxes, hence the
 * fallback rather than a hard requirement.
 */
async function openDb(): Promise<{ db: BoltDb; driver: "postgres" | "pglite" }> {
  if (process.env.DATABASE_URL) {
    try {
      const { createDb } = await import("@bolt/db");
      const real = createDb();
      await real.select().from(businesses).limit(1);
      return { db: real as unknown as BoltDb, driver: "postgres" };
    } catch (error) {
      console.log(
        `  Postgres unreachable (${error instanceof Error ? error.message : String(error)}); ` +
          `falling back to PGlite — the unlock's reason text will not reach the public page.`
      );
    }
  }
  const pg = new PGlite();
  for (const file of [
    "0000_swift_cardiac.sql",
    "0001_organic_wendell_vaughn.sql",
    "0002_tense_ken_ellis.sql"
  ]) {
    const sql = readFileSync(join(REPO, "packages", "db", "drizzle", file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  return { db: drizzle(pg) as unknown as BoltDb, driver: "pglite" };
}
const { db, driver } = await openDb();
// Idempotent, because on the Postgres path these rows survive between runs.
const [existingBiz] = await db.select().from(businesses).where(eq(businesses.slug, SLUG));
const bizId =
  existingBiz?.id ??
  (
    await db
      .insert(businesses)
      .values({ slug: SLUG, name: business.name, adminAddress: recorder })
      .returning({ id: businesses.id })
  )[0]!.id;
const [existingAccount] = await db
  .select()
  .from(accountsTable)
  .where(eq(accountsTable.address, locked.address));
const accountId =
  existingAccount?.id ??
  (
    await db
      .insert(accountsTable)
      .values({
        businessId: bizId,
        address: locked.address,
        class: "CLIENT_MONEY",
        label: locked.label,
        policyId: locked.policyId,
        policyHash: locked.policyHash
      })
      .returning({ id: accountsTable.id })
  )[0]!.id;

console.log(`\nbusiness      : ${SLUG}  (${business.organizationId})`);
console.log(`locked account: ${locked.address}`);
console.log(`key quorum    : ${business.keyQuorumId}`);
console.log(`world         : app=${WORLD_APP_ID} rp=${WORLD_RP_ID} action=${WORLD_ACTION} env=${WORLD_ENV}`);

// 1. FR-5.1 — open the ceremony. Real UnlockRequested on Arc.
const cfg: UnlockCeremonyConfig = {
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET"),
  onChainBusinessId,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  world: { rpId: WORLD_RP_ID, action: WORLD_ACTION }
};

console.log("\nopening the unlock ceremony ...");
const request = await requestUnlock(privy, db, registry, timer, cfg, {
  businessId: bizId,
  accountId: accountId,
  walletId: locked.walletId,
  accountAddress: locked.address,
  amount: UNLOCK_AMOUNT,
  destination: PAYEE,
  reason: REASON
});
console.log(`  unlockId : ${request.unlockId}`);
console.log(`  intent   : ${request.intentId}  (threshold ${request.threshold} of ${request.quorumSize})`);
console.log(`  tx       : ${EXPLORER}/tx/${request.requestedTxHash}`);

// FR-5.3 — the proof must be bound to *this* unlock, not to unlocks in general.
// The widget signs `signal: unlockRequestId`; the proof carries only the hash,
// so the server recomputes it and compares.
const expectedSignalHash = hashSignal(request.id);

// 2. Three approvals, each gated on a real Selfie Check.
interface ApprovalEvidence {
  approver: string;
  address: string;
  connect_url: string;
  world_request_id: string;
  rp_signature: { nonce: string; created_at: number; expires_at: number };
  outcome: "APPROVED" | "IDKIT_FAILED" | "REFUSED";
  idkit_error?: string;
  approval_error?: unknown;
  idkit_result?: unknown;
  world_verification?: unknown;
  human_proof_ref?: string;
  approved_tx?: string;
  approvals_after?: number;
  armed?: { txHash: string; executableAt: string } | null;
}
const approvalEvidence: ApprovalEvidence[] = [];
let armedAt: { txHash: string; executableAt: bigint } | null = null;

for (let i = 0; i < APPROVALS_WANTED; i++) {
  const member = members[i]!;

  // world-docs /world-id/idkit/integrate step 3. A fresh nonce per request —
  // `duplicate_nonce` is a real IDKit error code and reuse is the way to hit it.
  const sig = signRequest({ signingKeyHex: WORLD_SIGNING_KEY, action: WORLD_ACTION });
  const worldRequest = await IDKit.request({
    app_id: WORLD_APP_ID,
    action: WORLD_ACTION,
    rp_context: {
      rp_id: WORLD_RP_ID,
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig
    },
    allow_legacy_proofs: true,
    environment: WORLD_ENV
  }).preset(selfieCheckLegacy({ signal: request.id }));

  const evidence: ApprovalEvidence = {
    approver: member.label,
    address: member.address,
    connect_url: worldRequest.connectorURI,
    world_request_id: worldRequest.requestId,
    rp_signature: { nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt },
    outcome: "IDKIT_FAILED"
  };
  approvalEvidence.push(evidence);

  console.log(`\n─── approver ${i + 1} of ${APPROVALS_WANTED}: ${member.label} (${member.address})`);
  console.log(`    Open this on a device running the sandbox World ID app and complete`);
  console.log(`    the Selfie Check. Waiting up to ${Math.round(POLL_TIMEOUT_MS / 60000)} minutes.\n`);
  console.log(`    ${worldRequest.connectorURI}\n`);

  const completion = await worldRequest.pollUntilCompletion({ timeout: POLL_TIMEOUT_MS });
  if (!completion.success) {
    evidence.idkit_error = completion.error;
    console.log(`    IDKit did not return a proof: ${completion.error}`);
    break;
  }

  // Verbatim from here on. No remapping, no re-encoding, no trimming — the
  // verifier is the thing that reads this, not us.
  const idkitResult = completion.result;
  evidence.idkit_result = idkitResult;

  try {
    const approved = await approveUnlock(
      privy,
      db,
      registry,
      timer,
      { ...cfg, world: { ...cfg.world, expectedSignalHash } },
      {
        unlockRequestId: request.id,
        approver: {
          id: member.label,
          address: member.address,
          authorizationPrivateKey: member.privateKey
        },
        idkitResult
      }
    );
    evidence.outcome = "APPROVED";
    evidence.world_verification = approved.world.raw;
    evidence.human_proof_ref = approved.humanProofRef;
    evidence.approved_tx = approved.approvedTxHash;
    evidence.approvals_after = approved.approvals;
    evidence.armed = approved.armed
      ? { txHash: approved.armed.txHash, executableAt: approved.armed.executableAt.toString() }
      : null;
    if (approved.armed) armedAt = approved.armed;
    console.log(
      `    APPROVED ${approved.approvals}/${approved.threshold} · proof ${approved.humanProofRef}` +
        `\n    UnlockApproved: ${EXPLORER}/tx/${approved.approvedTxHash}` +
        (approved.armed ? `\n    24h timer armed: ${EXPLORER}/tx/${approved.armed.txHash}` : "")
    );
  } catch (error) {
    evidence.outcome = "REFUSED";
    evidence.approval_error = rawErrorBody(error);
    console.log(`    REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    break;
  }
}

const approved = approvalEvidence.filter((a) => a.outcome === "APPROVED").length;

// 3. Execution. Privy signs on three real signatures; the timer refuses until
//    the 24 hours it published on chain have elapsed. Both halves are the
//    product working, and neither is faked.
let execution: unknown = null;
let executionError: unknown = null;
if (armedAt) {
  const remaining = await timer.secondsRemaining(request.unlockId);
  console.log(`\nattempting execution — ${remaining}s remain on the on-chain timer ...`);
  try {
    execution = await executeUnlock(privy, db, registry, timer, cfg, request.id);
    console.log("  EXECUTED");
  } catch (error) {
    executionError = rawErrorBody(error);
    console.log(`  BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const timerState = armedAt ? await timer.state(request.unlockId) : null;

writeEvidence("phase6-ceremony", {
  requirement: "FR-5.1 → FR-5.4 — the full unlock ceremony, with live World Selfie Checks",
  run: {
    at: new Date().toISOString(),
    approvers_attempted: APPROVALS_WANTED,
    poll_timeout_ms: POLL_TIMEOUT_MS,
    note:
      "PHASE6_APPROVALS and PHASE6_POLL_TIMEOUT_MS override these. A run with a short timeout " +
      "and fewer approvers is a wiring check, not a ceremony — read `outcome`."
  },
  off_chain_store:
    driver === "postgres"
      ? "postgres — the unlock's free-text reason will render on the public page beside its hash"
      : "pglite (Postgres unreachable) — the page renders the unlock and its reason HASH from the " +
        "subgraph, but not the prose. Re-run where DATABASE_URL is reachable for the full page.",
  world: {
    app_id: WORLD_APP_ID,
    rp_id: WORLD_RP_ID,
    action: WORLD_ACTION,
    environment: WORLD_ENV,
    verify_endpoint: `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`,
    preset: "selfieCheckLegacy (World ID 3.0)",
    signal: request.id,
    expected_signal_hash: expectedSignalHash,
    note:
      "Selfie Check has no headless path: a proof is produced by a person completing " +
      "a face capture in the sandbox World ID app, installed via TestFlight or a " +
      "private Google Play track (world-docs /world-id/sandbox/sandbox-access). " +
      "Nothing here simulates one."
  },
  unlock: {
    unlock_id: request.unlockId,
    db_row_id: request.id,
    reason: REASON,
    reason_hash: request.reasonHash,
    intent_id: request.intentId,
    threshold: request.threshold,
    quorum_size: request.quorumSize,
    account: locked.address,
    destination: PAYEE,
    amount_usdc_base_units: UNLOCK_AMOUNT.toString(),
    requested_tx: request.requestedTxHash,
    explorer: `${EXPLORER}/tx/${request.requestedTxHash}`
  },
  approvals: approvalEvidence,
  approvals_completed: approved,
  timer: timerState
    ? {
        contract: TIMER,
        armed_tx: armedAt?.txHash,
        armed_at: timerState.armedAt.toString(),
        executable_at: timerState.executableAt.toString(),
        seconds_remaining: (await timer.secondsRemaining(request.unlockId)).toString()
      }
    : null,
  execution,
  execution_error: executionError,
  outcome:
    approved >= request.threshold
      ? executionError
        ? "ARMED AND CORRECTLY GATED — three Selfie-Check-backed approvals accepted by the quorum; execution blocked by the real 24h timer"
        : "EXECUTED"
      : `INCOMPLETE — ${approved} of ${request.threshold} approvals completed`
});

console.log(
  `\napprovals: ${approved}/${request.threshold} · armed: ${armedAt !== null} · ` +
    `executed: ${execution !== null}`
);
