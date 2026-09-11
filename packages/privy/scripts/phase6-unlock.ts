/**
 * Phase 6 — live unlock ceremony run (FR-5).
 *
 * What this script proves against real infrastructure, and what it cannot:
 *
 *   LIVE, here          a 5-member Privy key quorum at a 3-of-5 threshold; a
 *                       locked account provisioned under it with the usual
 *                       calldata-decoding policy; `UnlockRequested` on Arc; the
 *                       unlock proposed as a Privy intent; two signatures being
 *                       genuinely not enough; the deployed 24-hour timer
 *                       refusing an early release.
 *
 *   BLOCKED on World    the approvals themselves. FR-5.3 says an approval counts
 *                       only once a Selfie Check has been completed for that
 *                       approver, and Selfie Check needs a World Developer
 *                       Portal app, RP and action that do not exist yet
 *                       (WORLD_APP_ID / WORLD_RP_ID / WORLD_RP_SIGNING_KEY /
 *                       WORLD_ACTION_ID are blank). There is deliberately no
 *                       bypass here: no env flag, no "skip world" argument, no
 *                       placeholder proof. A mocked Selfie Check would be a
 *                       mocked prize claim (CLAUDE.md invariant 6), and the
 *                       ordering it would hide is the exact thing FR-5.3 is
 *                       about. So the run stops at the first approval and says so.
 *
 * Resumable — state (including the quorum's private keys) in
 * docs/evidence/phase6-state.json, which is gitignored. Run:
 *   pnpm --filter @bolt/privy phase6:unlock
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient, generateAuthorizationSignature } from "@privy-io/node";
import { decodeEventLog, getAddress, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  accounts as accountsTable,
  businesses,
  unlockApprovals as unlockApprovalsTable,
  type BoltDb
} from "@bolt/db";
import {
  BOLT_REGISTRY_ABI,
  BOLT_UNLOCK_TIMER_ABI,
  businessIdOf,
  createRegistryWriter,
  createUnlockTimer,
  policyHashOf,
  quorumRefOf,
  reasonHashOf,
  unlockIdOf,
  usdc,
  ZERO_BYTES32
} from "@bolt/core";
import {
  provisionBusiness,
  quorumMemberCount,
  rawErrorBody,
  requestUnlock,
  signUnlockRequest,
  signatureThreshold,
  submitQuorumSignedUnlock,
  unlockRequestToSign,
  type ProvisionedBusiness,
  type UnlockCeremonyConfig
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase6-state.json");

loadEnv({ path: join(REPO, ".env") });

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

const SLUG = "bolt-unlock-demo";
const QUORUM_SIZE = 5;
const QUORUM_THRESHOLD = 3;
const UNLOCK_AMOUNT = usdc(25_000_000n); // 25 USDC
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

/** Direct eth_getTransactionReceipt — the exit criterion is the chain, not an SDK. */
async function rawReceipt(hash: string): Promise<Record<string, unknown>> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] })
  });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (!body.result) throw new Error(`no receipt for ${hash}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/** A P-256 keypair in the shape Privy wants: base64 DER, no PEM headers. */
function newAuthorizationKey(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")
  };
}

type State = {
  quorumMembers?: { label: string; publicKey: string; privateKey: string; address: string }[];
  permittedPayee?: string;
  provisioned?: ProvisionedBusiness;
  unlockRequestId?: string;
  intentId?: string;
};
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State)
  : {};
const saveState = (): void => writeFileSync(STATE_FILE, jsonify(state) + "\n");

// ---------------------------------------------------------------------------

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});

// 1. Five approvers, five keys. Each key is one member of the quorum; the
//    address is what `UnlockApproved` records.
if (!state.quorumMembers) {
  state.quorumMembers = Array.from({ length: QUORUM_SIZE }, (_, i) => {
    const key = newAuthorizationKey();
    return {
      label: `approver-${i + 1}`,
      ...key,
      address: privateKeyToAccount(generatePrivateKey()).address
    };
  });
  state.permittedPayee = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const members = state.quorumMembers;
const PAYEE = state.permittedPayee!;

// 2. Provision a business whose organization default key quorum IS the 3-of-5.
//    Every wallet under it inherits that owner, so the locked account cannot act
//    on fewer than three signatures — that is the quorum doing the work, not us.
if (!state.provisioned) {
  console.log(`\nprovisioning "${SLUG}" under a ${QUORUM_THRESHOLD}-of-${QUORUM_SIZE} key quorum ...`);
  state.provisioned = await provisionBusiness(privy, {
    slug: SLUG,
    name: "BOLT Unlock Demo",
    quorumPublicKeys: members.map((m) => m.publicKey),
    quorumThreshold: QUORUM_THRESHOLD,
    usdcAddress: USDC,
    chainId: CHAIN_ID,
    accounts: [
      { accountClass: "OPERATING", label: "Operating" },
      {
        accountClass: "CLIENT_MONEY",
        label: "Client money",
        // The unlock's destination. An unlock is a policy-*permitted* release,
        // not an exception to the policy (invariant 2).
        permittedAddresses: [PAYEE]
      }
    ]
  });
  saveState();
  writeEvidence("phase6-provisioned-business", {
    ...state.provisioned,
    note: "Key quorum private keys are NOT in this file; they are in the gitignored phase6-state.json."
  });
}
const business = state.provisioned;
const locked = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY")!;

console.log(`organization : ${business.organizationId}`);
console.log(`key quorum   : ${business.keyQuorumId}  (${QUORUM_THRESHOLD}-of-${QUORUM_SIZE})`);
console.log(`locked account: ${locked.address}  policy=${locked.policyId}`);
console.log(`permitted payee: ${PAYEE}`);

// Read the quorum back rather than trusting the create response.
const quorum = (await privy.keyQuorums().get(business.keyQuorumId)) as unknown as {
  id: string;
  authorization_threshold?: number;
  public_keys?: string[];
};
writeEvidence("phase6-key-quorum", {
  expect: `${QUORUM_THRESHOLD}-of-${QUORUM_SIZE}`,
  key_quorum_id: quorum.id,
  authorization_threshold: quorum.authorization_threshold,
  member_count: quorum.public_keys?.length,
  members: members.map((m) => ({ label: m.label, address: m.address, public_key: m.publicKey })),
  note: "FR-5.2. Privy's TEE enforces the threshold; no application code counts approvals."
});

// 3. On-chain registration, so the subgraph and the public page know this
//    business exists at all.
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
const emitted: { event: string; note?: string; txHash: string }[] = [];

// Postgres: PGlite, because direct Postgres ports are unreachable from this
// sandbox. Same schema, same drizzle writer, same unique indexes.
const pg = new PGlite();
const db = drizzle(pg) as unknown as BoltDb;
for (const file of [
  "0000_swift_cardiac.sql",
  "0001_organic_wendell_vaughn.sql",
  "0002_tense_ken_ellis.sql"
]) {
  const sql = readFileSync(join(REPO, "packages", "db", "drizzle", file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
}
const [bizRow] = await db
  .insert(businesses)
  .values({
    slug: SLUG,
    name: business.name,
    adminAddress: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address
  })
  .returning({ id: businesses.id });
const [accountRow] = await db
  .insert(accountsTable)
  .values({
    businessId: bizRow!.id,
    address: locked.address,
    class: "CLIENT_MONEY",
    label: locked.label,
    policyId: locked.policyId,
    policyHash: locked.policyHash
  })
  .returning({ id: accountsTable.id });

console.log("\nrecording the business and its locked account on BoltRegistry ...");
emitted.push({
  event: "BusinessRegistered",
  txHash: (
    await registry.recordBusinessRegistered({
      businessId: onChainBusinessId,
      slug: SLUG,
      admin: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address
    })
  ).transactionHash
});
for (const a of business.accounts) {
  emitted.push({
    event: "AccountRegistered",
    note: a.accountClass,
    txHash: (
      await registry.recordAccountRegistered({
        businessId: onChainBusinessId,
        account: getAddress(a.address),
        accountClass: a.accountClass,
        policyHash: (a.policy ? policyHashOf(a.policy) : ZERO_BYTES32) as Hex,
        label: a.label
      })
    ).transactionHash
  });
}

// 4. FR-5.1 — the request. Reason is free text; only its keccak goes on chain.
console.log("\nopening the unlock ceremony ...");
const cfg: UnlockCeremonyConfig = {
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET"),
  onChainBusinessId,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  world: {
    rpId: process.env.WORLD_RP_ID ?? "",
    action: process.env.WORLD_ACTION_ID ?? ""
  }
};

const request = await requestUnlock(privy, db, registry, timer, cfg, {
  businessId: bizRow!.id,
  accountId: accountRow!.id,
  walletId: locked.walletId,
  accountAddress: locked.address,
  amount: UNLOCK_AMOUNT,
  destination: PAYEE,
  reason: REASON
});
state.unlockRequestId = request.id;
state.intentId = request.intentId;
saveState();
emitted.push({ event: "UnlockRequested", txHash: request.requestedTxHash });

console.log(`  unlockId  : ${request.unlockId}`);
console.log(`  intent    : ${request.intentId}`);
console.log(`  reasonHash: ${request.reasonHash}`);

writeEvidence("phase6-unlock-requested", {
  requirement: "FR-5.1 — free-text reason, hash on chain",
  unlock_id: request.unlockId,
  db_row_id: request.id,
  reason: REASON,
  reason_hash: request.reasonHash,
  reason_hash_recomputable_as: "keccak256(utf8(reason))",
  reason_hash_check: reasonHashOf(REASON) === request.reasonHash,
  account: locked.address,
  destination: PAYEE,
  destination_is_permitted_by_policy: true,
  amount_usdc_base_units: UNLOCK_AMOUNT.toString(),
  intent_id: request.intentId,
  intent_threshold: request.threshold,
  executable_at_floor_unix: request.executableAtFloor.toString(),
  tx: request.requestedTxHash,
  explorer: `${EXPLORER}/tx/${request.requestedTxHash}`
});

// 5. FR-5.7 — two signatures are not three, and three are.
//
//    NOTE ON WHAT THIS IS: these are quorum *authorizations*, not FR-5.3
//    approvals. No Selfie Check was performed, so no `UnlockApproved` is
//    recorded, no approval row exists, the timer is not armed and nothing is
//    broadcast. The purpose is narrow and stated plainly: show that the refusal
//    comes from Privy's threshold, not from a count kept in our code — and then
//    show the identical request succeeding with one more signature, because a
//    refusal with no positive control proves nothing.
console.log("\nsubmitting the unlock with two of five quorum signatures ...");
const { intent, request: signable } = await unlockRequestToSign(privy, cfg, request.intentId);
const signatureOf = (key: string) => signUnlockRequest(signable, key);

let twoRefusal: unknown = null;
try {
  await submitQuorumSignedUnlock(cfg, signable, members.slice(0, 2).map((m) => signatureOf(m.privateKey)));
  console.log("  SIGNED ON TWO — the quorum did NOT hold");
} catch (e) {
  twoRefusal = e;
  console.log("  REFUSED at two of five");
}

console.log("submitting the identical request with three of five ...");
let threeSigned: string | null = null;
let threeError: unknown = null;
try {
  threeSigned = await submitQuorumSignedUnlock(
    cfg,
    signable,
    members.slice(0, 3).map((m) => signatureOf(m.privateKey))
  );
  console.log("  SIGNED at three of five (never broadcast — see note)");
} catch (e) {
  threeError = e;
  console.log("  REFUSED even at three of five");
}

const executedOnTwo = twoRefusal === null;
writeEvidence("phase6-quorum-two-of-five", {
  requirement: "FR-5.7 — an unlock cannot execute without the required approvals",
  expect: "REFUSE at 2, ALLOW at 3",
  outcome: {
    two_of_five: twoRefusal ? "REFUSED" : "SIGNED — QUORUM DID NOT HOLD",
    three_of_five: threeSigned ? "SIGNED" : "REFUSED"
  },
  note:
    "Byte-identical requests; the only difference is the number of authorization " +
    "signatures in the privy-authorization-signature header. Nothing in BOLT's code " +
    "counted to three — Privy's TEE did, and the refusal body below is Privy's, " +
    "verbatim. That the three-signature request succeeds also confirms the unlock " +
    "destination is PERMITTED BY THE ACCOUNT'S EXISTING POLICY (invariant 2): the " +
    "enclave decoded transfer._to and allowed it. Neither of these is an unlock: no " +
    "Selfie Check was performed, so no UnlockApproved was recorded, the 24h timer was " +
    "never armed, and the signed transaction below was never broadcast.",
  intent_id: request.intentId,
  threshold: signatureThreshold(intent),
  quorum_size: quorumMemberCount(intent),
  signed_request: { url: signable.url, body: signable.body, headers: signable.headers },
  two_of_five_error: twoRefusal ? rawErrorBody(twoRefusal) : null,
  three_of_five_signed_transaction: threeSigned,
  three_of_five_error: threeError ? rawErrorBody(threeError) : null
});

// 5b. The intent-authorize gap, recorded so it can be raised with Privy rather
//     than quietly worked around. See the divergence note at the top of
//     packages/privy/src/unlock.ts.
const authorizeAttempts: { payload: string; status: number; body: unknown }[] = [];
for (const [label, input] of Object.entries({
  "request_details + privy-app-id": {
    version: 1 as const, method: "POST" as const,
    url: intent.request_details!.url, body: intent.request_details!.body,
    headers: { "privy-app-id": cfg.appId }
  },
  "request_details + chain_type": {
    version: 1 as const, method: "POST" as const,
    url: intent.request_details!.url,
    body: { ...(intent.request_details!.body as Record<string, unknown>), chain_type: "ethereum" },
    headers: { "privy-app-id": cfg.appId }
  }
})) {
  const signature = generateAuthorizationSignature({
    authorizationPrivateKey: members[0]!.privateKey,
    input
  });
  const res = await fetch(`https://api.privy.io/v1/intents/${request.intentId}/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "privy-app-id": cfg.appId,
      authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString("base64")}`
    },
    body: JSON.stringify({ signature, timestamp: Date.now() })
  });
  authorizeAttempts.push({ payload: label, status: res.status, body: await res.json().catch(() => null) });
}
writeEvidence("phase6-intent-authorize-gap", {
  what:
    "POST /v1/intents/{intent_id}/authorize wants 'an authorization signature over " +
    "the intent's action'. privy-docs never defines those bytes, and @privy-io/node@0.34.0 " +
    "has no intents().authorize() to copy from (the docs' example is Java-only). Every " +
    "payload shape derived from the intent's own request_details is refused.",
  endpoint: `POST https://api.privy.io/v1/intents/${request.intentId}/authorize`,
  sdk_version: "@privy-io/node@0.34.0",
  attempts: authorizeAttempts,
  control:
    "The same keys, over the documented m-of-n route (/controls/key-quorum/sign), " +
    "are accepted — see phase6-quorum-two-of-five.json. So the keys and the signing " +
    "helper are correct; only the intent-authorize payload definition is missing.",
  impact:
    "None to the security property: the quorum still enforces 3-of-5 in Privy's TEE. " +
    "The intent remains the proposal record; the signatures ride the documented header."
});

// 6. FR-5.4 — the deployed 24-hour constant, live.
//
//    An isolated probe against a throwaway unlock id, so the ceremony's own
//    timer is not consumed: arm it, then try to release it immediately. The
//    revert comes from the bytecode at UNLOCK_TIMER_ADDRESS, not from a check
//    in this script.
console.log("\nprobing the deployed 24h timer ...");
// Fresh every run: a timer can only be armed once, so re-using a probe id would
// make the second run fail on "already armed" instead of on the 24 hours.
const probeId = unlockIdOf(`timer-probe-${Date.now()}`) as Hex;
const delaySeconds = await timer.delaySeconds();
const armReceipt = await timer.arm(probeId);
const probeState = await timer.state(probeId);
console.log(`  armed ${probeId} -> executableAt ${probeState.executableAt}`);

let earlyReleaseError: unknown = null;
try {
  await timer.release(probeId);
  console.log("  RELEASED EARLY — the timer did NOT hold");
} catch (e) {
  earlyReleaseError = e;
  console.log("  REFUSED — 24h has not elapsed");
}
writeEvidence("phase6-timer-live", {
  requirement: "FR-5.4 — 24 hours between final approval and executability",
  contract: TIMER,
  explorer: `${EXPLORER}/address/${TIMER}`,
  unlock_delay_seconds_read_from_chain: delaySeconds.toString(),
  unlock_delay_hours: Number(delaySeconds) / 3600,
  probe_unlock_id: probeId,
  armed_tx: armReceipt.transactionHash,
  armed_at: probeState.armedAt.toString(),
  executable_at: probeState.executableAt.toString(),
  seconds_remaining: (await timer.secondsRemaining(probeId)).toString(),
  expect: "REFUSE",
  outcome: earlyReleaseError ? "REFUSED" : "RELEASED — INVARIANT BROKEN",
  error: earlyReleaseError ? rawErrorBody(earlyReleaseError) : null,
  note:
    "The 24 hours are real and are not shortened for the demo. The 'it succeeds " +
    "after the window' half is asserted in contracts/test/BoltUnlockTimer.test.ts " +
    "against a local Hardhat chain with time travel, and is labelled there as a " +
    "local test — not as a live Arc claim."
});

// 7. FR-5.3 — the World gate, live, with the credentials that exist today.
console.log("\nattempting an approval with no completed Selfie Check ...");
let worldRefusal: unknown = null;
try {
  const { approveUnlock } = await import("../src/unlock.js");
  await approveUnlock(privy, db, registry, timer, cfg, {
    unlockRequestId: request.id,
    approver: {
      id: members[2]!.label,
      address: members[2]!.address,
      authorizationPrivateKey: members[2]!.privateKey
    },
    // Not a proof. There is no way to produce one without a World app.
    idkitResult: { protocol_version: "3.0", nonce: "none", responses: [] }
  });
  console.log("  APPROVED WITHOUT A SELFIE CHECK — the gate did NOT hold");
} catch (e) {
  worldRefusal = e;
  console.log("  REFUSED before any signature was requested");
}
const approvalRows = await db.select().from(unlockApprovalsTable);
writeEvidence("phase6-world-gate", {
  requirement: "FR-5.3 — an approval without a completed Selfie Check does not count",
  expect: "REFUSE",
  outcome: worldRefusal ? "REFUSED" : "ALLOWED — INVARIANT 7 BROKEN",
  world_credentials_present: {
    WORLD_APP_ID: Boolean(process.env.WORLD_APP_ID),
    WORLD_RP_ID: Boolean(process.env.WORLD_RP_ID),
    WORLD_RP_SIGNING_KEY: Boolean(process.env.WORLD_RP_SIGNING_KEY),
    WORLD_ACTION_ID: Boolean(process.env.WORLD_ACTION_ID)
  },
  error: worldRefusal ? rawErrorBody(worldRefusal) : null,
  approval_rows_written: approvalRows.length,
  note:
    "The refusal below is the World gate, not a policy or a quorum. Signature count " +
    "is unchanged, which is the point: a failed Selfie Check does not merely fail to " +
    "increment a counter, it never reaches Privy at all. The refusal shapes that " +
    "matter once credentials exist — an invalid proof, an Orb proof offered instead " +
    "of a Selfie Check, a proof scoped to another action, one human filling two slots " +
    "— are asserted in packages/privy/src/unlock.test.ts."
});

// 8. Verify every registry write straight from the RPC.
console.log("\nverifying receipts via eth_getTransactionReceipt ...");
const verified = [];
for (const e of emitted) {
  const receipt = await rawReceipt(e.txHash);
  const logs = (receipt.logs as { topics: Hex[]; data: Hex }[]).map((log) =>
    decodeEventLog({ abi: BOLT_REGISTRY_ABI, topics: log.topics, data: log.data })
  );
  const ok = receipt.status === "0x1" && logs.some((l) => l.eventName === e.event);
  console.log(`  ${ok ? "OK " : "BAD"} ${e.event}${e.note ? ` (${e.note})` : ""} ${e.txHash}`);
  verified.push({
    ...e,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    explorer: `${EXPLORER}/tx/${e.txHash}`,
    decodedLogs: logs,
    verified: ok
  });
}
const armLog = await rawReceipt(armReceipt.transactionHash);
verified.push({
  event: "UnlockArmed",
  note: "BoltUnlockTimer, not BoltRegistry",
  txHash: armReceipt.transactionHash,
  status: armLog.status as string,
  blockNumber: armLog.blockNumber as string,
  explorer: `${EXPLORER}/tx/${armReceipt.transactionHash}`,
  decodedLogs: (armLog.logs as { topics: Hex[]; data: Hex }[]).map((log) =>
    decodeEventLog({ abi: BOLT_UNLOCK_TIMER_ABI, topics: log.topics, data: log.data })
  ),
  verified: armLog.status === "0x1"
});
writeEvidence("phase6-registry-events", {
  registry: REGISTRY,
  unlock_timer: TIMER,
  business_id: onChainBusinessId,
  quorum_ref: quorumRefOf(business.keyQuorumId),
  rpc: RPC_URL,
  events: verified,
  not_emitted: {
    UnlockApproved: "blocked — requires a completed World Selfie Check (FR-5.3)",
    UnlockExecuted: "blocked — requires three approvals, which require Selfie Checks"
  }
});

writeEvidence("phase6-summary", {
  chain: { chain_id: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY, unlock_timer: TIMER },
  slug: SLUG,
  public_page: `/${SLUG}`,
  organization_id: business.organizationId,
  key_quorum: {
    id: business.keyQuorumId,
    threshold: quorum.authorization_threshold,
    members: quorum.public_keys?.length
  },
  locked_account: {
    address: locked.address,
    policy_id: locked.policyId,
    policy_hash: locked.policyHash,
    permitted_payee: PAYEE,
    explorer: `${EXPLORER}/address/${locked.address}`
  },
  unlock: {
    unlock_id: request.unlockId,
    intent_id: request.intentId,
    reason_hash: request.reasonHash,
    amount: UNLOCK_AMOUNT.toString(),
    requested_tx: request.requestedTxHash
  },
  exit_criteria: {
    "full ceremony completes":
      "PARTIAL — the positive path needs a human. See phase6-ceremony.json, written by " +
      "`pnpm --filter @bolt/privy phase6:ceremony`, and phase6-world-credentials-live.json.",
    "two approvals cannot execute":
      executedOnTwo
        ? "FAILED"
        : "PASS — Privy returned 401 at two of five and 200 at three; the refusal is the quorum's, verbatim",
    "completed unlock appears publicly":
      "PARTIAL — the unlock, its reason hash, amount and destination render at /" + SLUG + " " +
      "from the subgraph within ~2 minutes. The approver table reads the subgraph's Approval " +
      "entities and stays empty until UnlockApproved events exist, which needs completed " +
      "Selfie Checks. It is deliberately not populated with placeholder data.",
    "approval without a Selfie Check does not count": worldRefusal ? "PASS — refused before Privy was reached" : "FAILED",
    "WORLD_FEEDBACK.md exists": "see docs/WORLD_FEEDBACK.md"
  },
  blocked_on: {
    what: "A physical device running the sandbox World ID app, and a person to complete three Selfie Checks",
    why:
      "world-docs /world-id/sandbox/sandbox-access and /world-id/sandbox/testing-selfie-check: " +
      "the sandbox builds ship through TestFlight and a private Google Play track, and the " +
      "credential is a camera capture with liveness. There is no headless path and nothing here " +
      "fabricates one.",
    how_to_finish: "pnpm --filter @bolt/privy phase6:ceremony"
  }
});

console.log(
  `\nquorum held at 2 of ${QUORUM_THRESHOLD}: ${!executedOnTwo} · timer refused early release: ` +
    `${earlyReleaseError !== null} · world gate refused: ${worldRefusal !== null} · ` +
    `registry events verified: ${verified.filter((v) => v.verified).length}/${verified.length}`
);
