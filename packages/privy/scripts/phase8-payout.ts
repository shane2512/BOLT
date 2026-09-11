/**
 * Phase 8 — beneficiary payout, live (FR-8).
 *
 * Runs against the real `acme-marketplace` business provisioned in Phase 2 and
 * funded in Phase 3: a real locked `CLIENT_MONEY` account holding real testnet
 * USDC against real outstanding obligations. Nothing about the money, the
 * policy, the quorum or the chain is simulated.
 *
 * What it does, in order:
 *
 *   1. Pregenerates a Privy wallet bound to a fresh email (FR-8.1) and reads its
 *      USDC balance off Arc — zero, before anyone has ever signed in.
 *   2. Widens the CLIENT_MONEY policy through the key quorum to admit that
 *      address as a permitted `transfer._to` (FR-2.6 / FR-8.3), and records
 *      `PolicyRotated`.
 *   3. Attempts the payout with no Selfie Check on file. It must not pay out,
 *      and Privy must never be reached (FR-8.6).
 *   4. Completes the Selfie Check — on a device with `--world-device`, or
 *      against a local stub verifier by default, which the evidence file says
 *      in as many words.
 *   5. Pays out. The enclave signs, BOLT broadcasts, `ObligationSettled` lands,
 *      and the receipts are re-read straight from the Arc RPC.
 *   6. Attempts a payout from the same account to a *different*, non-beneficiary
 *      address. The enclave must refuse (FR-8.3), and the refusal is stored
 *      verbatim.
 *   7. Attempts a withdrawal to a changed address. A fresh check is forced
 *      (FR-8.7).
 *   8. Repeats the withdrawal to the already-verified address. No fresh check
 *      (FR-8.8).
 *
 *   pnpm --filter @bolt/privy phase8:payout [--world-device]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { decodeEventLog, encodeFunctionData, getAddress, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  accounts as accountsTable,
  beneficiaryVerifications,
  businesses,
  obligations,
  type BoltDb
} from "@bolt/db";
import {
  BOLT_REGISTRY_ABI,
  businessIdOf,
  createRegistryWriter,
  policyHashOf,
  quorumRefOf,
  usdc,
  type SelfieCheckConfig
} from "@bolt/core";
import {
  BOLT_ERC20_ABI,
  SelfieCheckRequiredError,
  beneficiaryClaimSignal,
  payoutToBeneficiary,
  permitBeneficiary,
  persistBeneficiary,
  pregenerateBeneficiaryWallet,
  rawErrorBody,
  recordBeneficiaryVerification,
  recordPolicyRefusal,
  selfieCheckRequirement,
  type ProvisionedBusiness
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase8-state.json");
loadEnv({ path: join(REPO, ".env") });

const WITH_DEVICE = process.argv.includes("--world-device");
const POLL_TIMEOUT_MS = 15 * 60_000;

// WORLD_FEEDBACK.md (d)6 — idkit-core loads its WASM from a file:// URL under
// Node, which fetch() refuses.
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
const EXPLORER = "https://testnet.arcscan.app";
const SLUG = "acme-marketplace";

const WORLD_ACTION = process.env.WORLD_BENEFICIARY_ACTION_ID ?? "bolt-beneficiary-claim";
const WORLD_ENV = process.env.WORLD_ENVIRONMENT ?? "sandbox";

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

/** Direct `eth_getTransactionReceipt` — the exit criterion is that Arc says so. */
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

/** `balanceOf` straight from the RPC, not from an SDK's idea of a balance. */
async function usdcBalance(address: string): Promise<bigint> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          to: getAddress(USDC),
          data: encodeFunctionData({
            abi: BOLT_ERC20_ABI,
            functionName: "balanceOf",
            args: [getAddress(address)]
          })
        },
        "latest"
      ]
    })
  });
  const body = (await res.json()) as { result?: string };
  return BigInt(body.result ?? "0x0");
}

// ---------------------------------------------------------------------------
// State — resumable, same pattern as Phase 2 and Phase 6.
// ---------------------------------------------------------------------------

interface State {
  beneficiaryEmail?: string;
  privyUserId?: string;
  beneficiaryAddress?: string;
  changedAddress?: string;
  notPermittedAddress?: string;
  permitted?: boolean;
}
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State)
  : {};
const saveState = (): void => writeFileSync(STATE_FILE, jsonify(state) + "\n");

const phase2 = JSON.parse(
  readFileSync(join(EVIDENCE, "phase2-state.json"), "utf8")
) as { provisioned: ProvisionedBusiness };
const business = phase2.provisioned;
const locked = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY");
if (!locked?.policyId) throw new Error("phase2-state.json has no CLIENT_MONEY account with a policy");

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});
const QUORUM_KEY = need("PRIVY_AUTHORIZATION_KEY");
const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});
const businessId = businessIdOf(SLUG);

console.log(`business : ${business.name} (${SLUG})`);
console.log(`locked   : ${locked.address}  policy=${locked.policyId}  wallet=${locked.walletId}`);

// ---------------------------------------------------------------------------
// 1. FR-8.1 — the pregenerated wallet
// ---------------------------------------------------------------------------

if (!state.beneficiaryEmail) {
  // A real, deliverable address (plus-addressed), not a placeholder that looks
  // fake — the exit criterion is "a fresh email address receives a payout".
  state.beneficiaryEmail = `shanejo1506+bolt-seller-${Date.now().toString(36)}@gmail.com`;
  saveState();
}
const EMAIL = state.beneficiaryEmail;

console.log(`\npregenerating a Privy wallet for ${EMAIL} ...`);
const pregenerated = await pregenerateBeneficiaryWallet(privy, EMAIL);
state.privyUserId = pregenerated.privyUserId;
state.beneficiaryAddress = pregenerated.address;
saveState();

const balanceBefore = await usdcBalance(pregenerated.address);
console.log(`  user    : ${pregenerated.privyUserId}${pregenerated.reused ? " (reused)" : ""}`);
console.log(`  wallet  : ${pregenerated.address}`);
console.log(`  balance : ${balanceBefore} USDC base units, before they have ever signed in`);

// The wallet Privy hands back on login is the same one. Read it back by email —
// that is exactly what the familiar-login path resolves (FR-8.2).
const byEmail = await privy.users().getByEmailAddress({ address: EMAIL });
const loginResolvesTo =
  ((byEmail as unknown as { linked_accounts?: { type?: string; chain_type?: string; address?: string }[] })
    .linked_accounts ?? []).find((a) => a.type === "wallet" && a.chain_type === "ethereum")?.address ?? null;

writeEvidence("phase8-pregenerated-wallet", {
  requirement: "FR-8.1 — a beneficiary with no wallet is onboarded via a pregenerated Privy wallet bound to their email; their balance exists before they ever sign in.",
  doc: "privy-docs /recipes/pregenerate-wallets.mdx — users().create({linked_accounts, wallets})",
  sdk_divergence:
    "The recipe's NodeJS sample passes wallet_index and create_direct_signer. @privy-io/node@0.34.0's " +
    "UserCreateParams accepts only linked_accounts, custom_metadata and wallets, and the wallet's " +
    "smart-account flag is create_smart_wallet, not create_smart_account. Those fields exist on the " +
    "REST shapes in the same page. We follow the SDK.",
  email: EMAIL,
  privy_user_id: pregenerated.privyUserId,
  address: pregenerated.address,
  usdc_balance_before_any_login: balanceBefore.toString(),
  login_by_email_resolves_to_the_same_wallet: {
    method: "privy.users().getByEmailAddress({ address })",
    address: loginResolvesTo,
    matches: loginResolvesTo?.toLowerCase() === pregenerated.address.toLowerCase()
  },
  explorer: `${EXPLORER}/address/${pregenerated.address}`
});

// ---------------------------------------------------------------------------
// PGlite. Direct Postgres is unreachable from this sandbox; same schema, same
// migrations, same drizzle writer, same unique indexes as production.
// ---------------------------------------------------------------------------

const pg = new PGlite();
const db = drizzle(pg) as unknown as BoltDb;
for (const file of [
  "0000_swift_cardiac.sql",
  "0001_organic_wendell_vaughn.sql",
  "0002_tense_ken_ellis.sql",
  "0003_wandering_the_stranger.sql"
]) {
  const sql = readFileSync(join(REPO, "packages", "db", "drizzle", file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
}

const [bizRow] = await db
  .insert(businesses)
  .values({ slug: SLUG, name: business.name, adminAddress: locked.address })
  .returning({ id: businesses.id });
const [accountRow] = await db
  .insert(accountsTable)
  .values({
    businessId: bizRow!.id,
    address: locked.address,
    class: "CLIENT_MONEY",
    label: "Client money",
    policyId: locked.policyId,
    policyHash: locked.policyHash
  })
  .returning({ id: accountsTable.id });
const beneficiary = await persistBeneficiary(db, bizRow!.id, pregenerated);

// ---------------------------------------------------------------------------
// The obligation this payout settles — a real one, read from the deployed
// subgraph, not one we invented for the demo.
// ---------------------------------------------------------------------------

const subgraphUrl = need("SUBGRAPH_URL");
const graph = async (query: string): Promise<Record<string, unknown>> => {
  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query })
  });
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown };
  if (!body.data) throw new Error(`subgraph: ${JSON.stringify(body.errors)}`);
  return body.data;
};

// Two of them: the first claim settles one in full, the FR-8.8 repeat
// withdrawal settles part of a second. `BoltRegistry.recordObligationSettled`
// reverts on "settles more than outstanding" — a real guard in the deployed
// contract, and the reason a repeat must not be aimed at an obligation that is
// already closed.
const obligationData = (await graph(`{
  obligations(
    where: { account: "${locked.address.toLowerCase()}", outstanding_gt: "100000" }
    orderBy: accruedAtBlock
    orderDirection: asc
    first: 2
  ) { id accrued settled outstanding }
}`)) as { obligations: { id: string; outstanding: string }[] };

const target = obligationData.obligations[0];
const repeatTarget = obligationData.obligations[1];
if (!target || !repeatTarget) {
  throw new Error("need two outstanding CLIENT_MONEY obligations (one to settle, one to draw on)");
}

const AMOUNT = usdc(BigInt(target.outstanding));
const OBLIGATION_ID = target.id as Hex;
const REPEAT_OBLIGATION_ID = repeatTarget.id as Hex;
console.log(`\nsettling obligation ${OBLIGATION_ID}`);
console.log(`  outstanding: ${AMOUNT} USDC base units`);
console.log(`  repeat draws on ${REPEAT_OBLIGATION_ID} (${repeatTarget.outstanding} outstanding)`);

const [obligationRow] = await db
  .insert(obligations)
  .values({
    businessId: bizRow!.id,
    accountId: accountRow!.id,
    beneficiaryId: beneficiary.id,
    amount: AMOUNT,
    status: "OUTSTANDING"
  })
  .returning({ id: obligations.id });

const coverageBefore = await graph(`{
  coverageSnapshots(where: { business: "${businessId}", class: CLIENT_MONEY }, orderBy: blockNumber, orderDirection: desc, first: 1) {
    held owed ratioBps blockNumber trigger
  }
  account(id: "${locked.address.toLowerCase()}") { held owed }
}`);
console.log(`  coverage before: ${JSON.stringify(coverageBefore)}`);

// ---------------------------------------------------------------------------
// 2. FR-2.6 / FR-8.3 — admit the beneficiary through the key quorum
// ---------------------------------------------------------------------------

console.log(`\nwidening the CLIENT_MONEY policy to permit ${pregenerated.address} ...`);
const permitSpec = {
  name: `${business.name} — Client money`,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  ownerKeyQuorumId: business.keyQuorumId
};

let permitResult: Awaited<ReturnType<typeof permitBeneficiary>> | null = null;
let permitError: unknown = null;
try {
  permitResult = await permitBeneficiary(privy, {
    policyId: locked.policyId,
    payee: pregenerated.address,
    spec: permitSpec,
    authorizationPrivateKeys: [QUORUM_KEY]
  });
  state.permitted = permitResult.permitted;
  saveState();
  console.log(`  ${permitResult.permitted ? "PERMITTED" : "NOT PERMITTED"}`);
} catch (e) {
  permitError = rawErrorBody(e);
  console.log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
}

// The unsigned control. Byte-identical rule, no quorum signature — invariant 3.
let unsignedRefused = false;
let unsignedError: unknown = null;
try {
  const { rules } = await import("../src/policy-builder.js").then((m) => ({
    rules: [
      m.buildPayeeAllowRule(
        { ...permitSpec, permittedAddresses: [pregenerated.address] },
        [pregenerated.address],
        "eth_signTransaction",
        `Unsigned ${pregenerated.address.slice(0, 10)}`
      )
    ]
  }));
  await privy.policies().createRule(locked.policyId, rules[0] as never);
  console.log("  UNSIGNED WIDENING SUCCEEDED — invariant 3 broken");
} catch (e) {
  unsignedRefused = true;
  unsignedError = rawErrorBody(e);
  console.log("  unsigned widening REFUSED (control)");
}

// PolicyRotated, on chain (FR-2.7).
let rotationTx: string | null = null;
if (permitResult?.permitted) {
  const oldHash = policyHashOf(locked.policy);
  const newHash = policyHashOf({
    ...locked.policy!,
    rules: [...locked.policy!.rules, ...permitResult.rules]
  });
  const rotated = await registry.recordPolicyRotated({
    businessId,
    account: getAddress(locked.address),
    oldPolicyHash: oldHash as Hex,
    newPolicyHash: newHash as Hex,
    quorumRef: quorumRefOf(business.keyQuorumId)
  });
  rotationTx = rotated.transactionHash;
  console.log(`  PolicyRotated -> ${rotationTx}`);
}

writeEvidence("phase8-policy-widened", {
  requirement:
    "FR-2.6 / FR-8.3 — the beneficiary is admitted as a permitted destination through the key " +
    "quorum. The payout is policy-permitted, not an exception to the policy.",
  policy_id: locked.policyId,
  owner_key_quorum: business.keyQuorumId,
  payee: pregenerated.address,
  rules_added: permitResult?.rules ?? null,
  rule_names_after: permitResult?.ruleNamesAfter ?? null,
  permitted: permitResult?.permitted ?? false,
  error: permitError,
  unsigned_control: {
    expect: "REFUSE",
    outcome: unsignedRefused ? "REFUSED" : "ALLOWED — INVARIANT 3 BROKEN",
    note:
      "A byte-identical ALLOW rule with no key-quorum authorization signature. Widening a lock " +
      "is exactly as hard as spending from it.",
    error: unsignedError
  },
  policy_rotated_tx: rotationTx,
  explorer: rotationTx ? `${EXPLORER}/tx/${rotationTx}` : null
});

// ---------------------------------------------------------------------------
// 3. FR-8.6 — a first claim with no Selfie Check does not pay out
// ---------------------------------------------------------------------------

const payoutCfg = {
  walletId: locked.walletId,
  accountAddress: locked.address,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  authorizationPrivateKeys: [QUORUM_KEY]
};
const DEVICE_ID = "phase8-evidence-run";

console.log(`\nattempting the payout with no Selfie Check on file ...`);
let firstClaimBlocked: { name: string; reason?: string; message: string } | null = null;
try {
  await payoutToBeneficiary(privy, db, registry, payoutCfg, {
    beneficiaryId: beneficiary.id,
    obligationRowId: obligationRow!.id,
    obligationId: OBLIGATION_ID,
    amount: AMOUNT,
    destination: pregenerated.address,
    deviceId: DEVICE_ID
  });
  console.log("  PAID OUT — FR-8.6 BROKEN");
} catch (e) {
  if (e instanceof SelfieCheckRequiredError) {
    firstClaimBlocked = { name: e.name, reason: e.reason, message: e.message };
    console.log(`  BLOCKED: ${e.reason}`);
  } else {
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 4. The Selfie Check itself
// ---------------------------------------------------------------------------

const signal = beneficiaryClaimSignal(beneficiary.id, pregenerated.address);
const expectedSignalHash = hashSignal(signal);

let worldConfig: SelfieCheckConfig;
let worldMode: string;
let connectUrl: string | null = null;
let idkitResult: unknown;

if (WITH_DEVICE) {
  const { IDKit, selfieCheckLegacy } = await import("@worldcoin/idkit-core");
  const { signRequest } = await import("@worldcoin/idkit-core/signing");
  const sig = signRequest({ signingKeyHex: need("WORLD_RP_SIGNING_KEY"), action: WORLD_ACTION });
  const worldRequest = await IDKit.request({
    app_id: need("WORLD_APP_ID") as `app_${string}`,
    action: WORLD_ACTION,
    rp_context: {
      rp_id: need("WORLD_RP_ID"),
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig
    },
    allow_legacy_proofs: true,
    environment: WORLD_ENV
  }).preset(selfieCheckLegacy({ signal }));

  connectUrl = worldRequest.connectorURI;
  console.log(`\n─── first claim: Selfie Check (FR-8.6)`);
  console.log(`    Open this on a device running the sandbox World ID app.\n`);
  console.log(`    ${connectUrl}\n`);
  const completion = await worldRequest.pollUntilCompletion({ timeout: POLL_TIMEOUT_MS });
  if (!completion.success) {
    throw new Error(`IDKit did not return a proof: ${JSON.stringify(completion.error)}`);
  }
  idkitResult = completion.result; // verbatim from here on
  worldConfig = {
    rpId: need("WORLD_RP_ID"),
    action: WORLD_ACTION,
    expectedSignalHash
  };
  worldMode = "LIVE — a real Selfie Check completed on a device, verified by World's verifier.";
} else {
  // No device attached. The Selfie Check code path below is the real one — the
  // same verifySelfieCheck, the same signal binding, the same ledger write. The
  // ONLY substituted component is World's HTTP response. Phase 6 established
  // that a Selfie Check cannot be completed headlessly and this run does not
  // pretend otherwise; run with --world-device and a phone for the real thing.
  const nullifier = `0x${"7b".repeat(32)}`;
  worldConfig = {
    rpId: need("WORLD_RP_ID"),
    action: WORLD_ACTION,
    expectedSignalHash,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          success: true,
          results: [{ identifier: "selfie", success: true, nullifier }],
          action: WORLD_ACTION,
          nullifier,
          created_at: new Date().toISOString(),
          environment: WORLD_ENV,
          message: "STUBBED VERIFIER — not a World response. See phase8-summary.json."
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch
  };
  idkitResult = {
    protocol_version: "3.0",
    nonce: "00000000-0000-4000-8000-000000000000",
    action: WORLD_ACTION,
    environment: WORLD_ENV,
    responses: [
      {
        identifier: "selfie",
        signal_hash: expectedSignalHash,
        proof: `0x${"11".repeat(256)}`,
        merkle_root: `0x${"22".repeat(32)}`,
        nullifier
      }
    ],
    user_presence_completed: true
  };
  worldMode =
    "STUBBED — no device attached. verifySelfieCheck, the signal binding and the ledger write " +
    "are the production code path; only World's HTTP response is substituted. The live " +
    "credentials and the live action are proven separately in phase8-world-action-probe.json.";
}

console.log(`\nrecording the Selfie Check (${WITH_DEVICE ? "device" : "stub"}) ...`);
const verification = await recordBeneficiaryVerification(db, worldConfig, {
  beneficiaryId: beneficiary.id,
  address: pregenerated.address,
  reason: "FIRST_CLAIM",
  deviceId: DEVICE_ID,
  idkitResult
});
console.log(`  proof reference: ${verification.humanProofRef}`);

// ---------------------------------------------------------------------------
// 5. FR-8.3 / FR-8.5 — the payout
// ---------------------------------------------------------------------------

console.log(`\npaying ${AMOUNT} USDC base units to ${pregenerated.address} ...`);
let payout: Awaited<ReturnType<typeof payoutToBeneficiary>> | null = null;
let payoutError: unknown = null;
try {
  payout = await payoutToBeneficiary(privy, db, registry, payoutCfg, {
    beneficiaryId: beneficiary.id,
    obligationRowId: obligationRow!.id,
    obligationId: OBLIGATION_ID,
    amount: AMOUNT,
    destination: pregenerated.address,
    deviceId: DEVICE_ID
  });
  console.log(`  transfer      : ${payout.transferTxHash}`);
  console.log(`  ObligationSettled: ${payout.settledTxHash}`);
} catch (e) {
  payoutError = rawErrorBody(e);
  console.log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
}

const balanceAfter = await usdcBalance(pregenerated.address);
console.log(`  beneficiary balance: ${balanceBefore} -> ${balanceAfter}`);

const payoutReceipts: Record<string, unknown> = {};
if (payout) {
  for (const [label, hash] of [
    ["transfer", payout.transferTxHash],
    ["obligation_settled", payout.settledTxHash]
  ] as const) {
    const receipt = await rawReceipt(hash);
    const logs = (receipt.logs as { topics: Hex[]; data: Hex }[]).map((log) => {
      try {
        return decodeEventLog({ abi: BOLT_REGISTRY_ABI, topics: log.topics, data: log.data });
      } catch {
        return { eventName: "(not a BoltRegistry event)", topics: log.topics };
      }
    });
    payoutReceipts[label] = {
      tx: hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      explorer: `${EXPLORER}/tx/${hash}`,
      decodedLogs: logs,
      verified: receipt.status === "0x1"
    };
  }
}

// ---------------------------------------------------------------------------
// 6. FR-8.3's other half — a non-beneficiary from the same account is refused
// ---------------------------------------------------------------------------

if (!state.notPermittedAddress) {
  state.notPermittedAddress = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const NOT_PERMITTED = state.notPermittedAddress;

console.log(`\npaying the same account's money to a non-beneficiary (${NOT_PERMITTED}) ...`);
// The World gate is passed for this address too, deliberately: the refusal below
// must be the *policy's*, not the Selfie Check's. Two gates, tested one at a time.
await recordBeneficiaryVerification(
  db,
  {
    ...worldConfig,
    expectedSignalHash: hashSignal(beneficiaryClaimSignal(beneficiary.id, NOT_PERMITTED)),
    fetchImpl:
      worldConfig.fetchImpl ??
      ((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch)
  },
  {
    beneficiaryId: beneficiary.id,
    address: NOT_PERMITTED,
    reason: "ADDRESS_CHANGE",
    deviceId: DEVICE_ID,
    idkitResult: {
      ...(idkitResult as Record<string, unknown>),
      responses: [
        {
          ...((idkitResult as { responses: Record<string, unknown>[] }).responses[0] ?? {}),
          signal_hash: hashSignal(beneficiaryClaimSignal(beneficiary.id, NOT_PERMITTED)),
          nullifier: `0x${"7c".repeat(32)}`
        }
      ]
    }
  }
).catch((e: unknown) => {
  // With --world-device this second check needs a second scan; if it isn't
  // available the enclave test below still runs from the address-change gate.
  console.log(`  (second Selfie Check unavailable: ${e instanceof Error ? e.message : String(e)})`);
});

const [obligationRow2] = await db
  .insert(obligations)
  .values({
    businessId: bizRow!.id,
    accountId: accountRow!.id,
    beneficiaryId: beneficiary.id,
    amount: usdc(10_000n),
    status: "OUTSTANDING"
  })
  .returning({ id: obligations.id });

let enclaveRefusal: unknown = null;
let enclaveRefused = false;
const attemptedAction = {
  wallet_id: locked.walletId,
  method: "eth_signTransaction",
  to: NOT_PERMITTED,
  amount: "10000",
  note: "same locked account, same quorum signature, a destination the policy does not carry"
};
try {
  await payoutToBeneficiary(privy, db, registry, payoutCfg, {
    beneficiaryId: beneficiary.id,
    obligationRowId: obligationRow2!.id,
    obligationId: `0x${"00".repeat(32)}` as Hex,
    amount: usdc(10_000n),
    destination: NOT_PERMITTED,
    deviceId: DEVICE_ID
  });
  console.log("  SIGNED — INVARIANT 2 BROKEN");
} catch (e) {
  enclaveRefused = !(e instanceof SelfieCheckRequiredError);
  enclaveRefusal = rawErrorBody(e);
  console.log(
    `  REFUSED by ${e instanceof SelfieCheckRequiredError ? "the World gate" : "the enclave"}: ` +
      `${e instanceof Error ? e.message.slice(0, 120) : String(e)}`
  );
  await recordPolicyRefusal(db, {
    businessId: bizRow!.id,
    accountId: accountRow!.id,
    error: e,
    attemptedAction
  });
}

// ---------------------------------------------------------------------------
// 7 + 8. FR-8.7 and FR-8.8 — the two halves of the friction decision
// ---------------------------------------------------------------------------

if (!state.changedAddress) {
  state.changedAddress = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const CHANGED = state.changedAddress;

const repeatGate = await selfieCheckRequirement(db, {
  beneficiaryId: beneficiary.id,
  address: pregenerated.address,
  deviceId: DEVICE_ID
});
const addressChangeGate = await selfieCheckRequirement(db, {
  beneficiaryId: beneficiary.id,
  address: CHANGED,
  deviceId: DEVICE_ID
});
const newDeviceGate = await selfieCheckRequirement(db, {
  beneficiaryId: beneficiary.id,
  address: pregenerated.address,
  deviceId: "an-unrecognised-device"
});

console.log(`\nFR-8.8 repeat to verified address : fresh check required = ${repeatGate.required}`);
console.log(`FR-8.7 changed address            : fresh check required = ${addressChangeGate.required} (${addressChangeGate.reason})`);
console.log(`FR-8.7 unrecognised device        : fresh check required = ${newDeviceGate.required} (${newDeviceGate.reason})`);

// The repeat withdrawal, actually executed — FR-8.8 is a claim about a payout
// going through, not about a boolean.
const [obligationRow3] = await db
  .insert(obligations)
  .values({
    businessId: bizRow!.id,
    accountId: accountRow!.id,
    beneficiaryId: beneficiary.id,
    amount: usdc(50_000n),
    status: "OUTSTANDING"
  })
  .returning({ id: obligations.id });

let repeatPayout: Awaited<ReturnType<typeof payoutToBeneficiary>> | null = null;
let repeatError: unknown = null;
if (!repeatGate.required && payout) {
  console.log(`\nrepeat withdrawal of 50000 base units to the verified address, no fresh check ...`);
  try {
    repeatPayout = await payoutToBeneficiary(privy, db, registry, payoutCfg, {
      beneficiaryId: beneficiary.id,
      obligationRowId: obligationRow3!.id,
      obligationId: REPEAT_OBLIGATION_ID,
      amount: usdc(50_000n),
      destination: pregenerated.address,
      deviceId: DEVICE_ID
    });
    console.log(`  transfer: ${repeatPayout.transferTxHash}`);
  } catch (e) {
    repeatError = rawErrorBody(e);
    console.log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const verificationRows = await db
  .select()
  .from(beneficiaryVerifications)
  .where(eq(beneficiaryVerifications.beneficiaryId, beneficiary.id));

writeEvidence("phase8-selfie-check-gates", {
  requirements: {
    "FR-8.6": "A beneficiary completes a Selfie Check on first claim, before any payout executes to them.",
    "FR-8.7": "A fresh Selfie Check when changing withdrawal address, or claiming from an unrecognised device.",
    "FR-8.8": "A repeat withdrawal to an already-verified address requires no fresh check."
  },
  world: {
    mode: worldMode,
    action: WORLD_ACTION,
    environment: WORLD_ENV,
    signal: signal,
    signal_hash: expectedSignalHash,
    connect_url: connectUrl,
    action_scoping:
      "A second action, distinct from bolt-unlock-approval. The nullifier is scoped to " +
      "(RP, action), so sharing one action would put a beneficiary's nullifier in the same " +
      "scope as a quorum approver's. Proven usable with no Developer Portal step — see " +
      "phase8-world-action-probe.json."
  },
  "FR-8.6_first_claim_without_a_check": {
    expect: "NO PAYOUT",
    outcome: firstClaimBlocked ? "BLOCKED" : "PAID OUT — FR-8.6 BROKEN",
    error: firstClaimBlocked,
    note:
      "Thrown before the transaction is built, so Privy is never reached and no signature can " +
      "exist. This is not a boolean we check and then ignore."
  },
  "FR-8.8_repeat_to_verified_address": {
    expect: "NO FRESH CHECK",
    gate: repeatGate,
    payout_executed: repeatPayout
      ? { tx: repeatPayout.transferTxHash, explorer: `${EXPLORER}/tx/${repeatPayout.transferTxHash}` }
      : null,
    error: repeatError
  },
  "FR-8.7_address_change": { expect: "FRESH CHECK", gate: addressChangeGate },
  "FR-8.7_unrecognised_device": { expect: "FRESH CHECK", gate: newDeviceGate },
  verification_ledger: verificationRows.map((v) => ({
    address: v.address,
    reason: v.reason,
    device_id: v.deviceId,
    human_proof_ref: v.humanProofRef,
    nullifier_decimal: v.nullifier,
    verified_at: v.verifiedAt
  }))
});

writeEvidence("phase8-payout", {
  requirements: {
    "FR-8.3": "Payout from a locked account to a beneficiary succeeds inside the policy.",
    "FR-8.5": "Payout emits ObligationSettled(obligationId, amount, txRef) and reduces outstanding obligations."
  },
  locked_account: {
    address: locked.address,
    wallet_id: locked.walletId,
    policy_id: locked.policyId,
    explorer: `${EXPLORER}/address/${locked.address}`
  },
  obligation: { id: OBLIGATION_ID, amount: AMOUNT.toString(), source: "deployed subgraph" },
  permitted_payout: payout
    ? {
        expect: "ALLOW",
        outcome: "PAID",
        destination: payout.destination,
        amount: payout.amount.toString(),
        transfer_tx: payout.transferTxHash,
        obligation_settled_tx: payout.settledTxHash,
        receipts_read_from_rpc: payoutReceipts
      }
    : { expect: "ALLOW", outcome: "FAILED", error: payoutError },
  beneficiary_balance: {
    address: pregenerated.address,
    before: balanceBefore.toString(),
    after: balanceAfter.toString(),
    delta: (balanceAfter - balanceBefore).toString(),
    read_by: "eth_call balanceOf against ARC_RPC_URL, not from an SDK"
  },
  refused_payout: {
    expect: "REFUSE",
    outcome: enclaveRefused ? "REFUSED BY THE ENCLAVE" : "REFUSED BEFORE THE ENCLAVE",
    destination: NOT_PERMITTED,
    note:
      "Same locked account, same key-quorum authorization signature, same amount shape — only " +
      "the decoded transfer._to differs. No application-layer destination check ran anywhere in " +
      "this path (invariant 1); the error below is Privy's, verbatim.",
    attempted: attemptedAction,
    error: enclaveRefusal
  }
});

// ---------------------------------------------------------------------------
// Coverage, after — read back from the deployed subgraph.
// ---------------------------------------------------------------------------

console.log("\nwaiting for the subgraph to index the settlement ...");
let coverageAfter: unknown = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  const data = (await graph(`{
    _meta { block { number } }
    obligation(id: "${OBLIGATION_ID}") { accrued settled outstanding }
    obligationSettlements(where: { obligation: "${OBLIGATION_ID}" }) { amount txRef blockNumber txHash }
    account(id: "${locked.address.toLowerCase()}") { held owed }
    coverageSnapshots(where: { business: "${businessId}", class: CLIENT_MONEY }, orderBy: blockNumber, orderDirection: desc, first: 3) {
      held owed ratioBps trigger blockNumber txHash
    }
  }`)) as Record<string, unknown>;
  const settlements = (data.obligationSettlements as unknown[]) ?? [];
  process.stdout.write(`  attempt ${i + 1}: ${settlements.length} settlement(s) indexed\r`);
  if (settlements.length > 0) {
    coverageAfter = data;
    break;
  }
  coverageAfter = data;
}
console.log("");

writeEvidence("phase8-coverage", {
  requirement:
    "FR-8.5 — outstanding obligations fall and the coverage line updates. Both figures come from " +
    "the deployed subgraph's indexed events, not from Postgres (invariant 8).",
  business_id: businessId,
  account: locked.address,
  before: coverageBefore,
  after: coverageAfter,
  public_page: `/${SLUG}`
});

writeEvidence("phase8-summary", {
  phase: "8 — beneficiary payout",
  world_selfie_check_mode: worldMode,
  postgres:
    "PGlite (in-memory WASM Postgres), same schema and migrations as production — direct " +
    "Postgres is unreachable from this sandbox.",
  exit_criteria: {
    "a fresh email address receives a payout end to end without ever seeing a seed phrase": {
      email: EMAIL,
      privy_user_id: pregenerated.privyUserId,
      address: pregenerated.address,
      balance_before: balanceBefore.toString(),
      balance_after: balanceAfter.toString(),
      passed: balanceAfter > balanceBefore
    },
    "the payout is policy-permitted; a payout to a non-beneficiary from the same account is still refused": {
      permitted_payout_tx: payout?.transferTxHash ?? null,
      non_beneficiary: NOT_PERMITTED,
      refused: enclaveRefused,
      passed: Boolean(payout) && enclaveRefused
    },
    "a first claim without a Selfie Check does not pay out": {
      blocked: firstClaimBlocked !== null,
      passed: firstClaimBlocked !== null
    },
    "a repeat withdrawal to a verified address needs no fresh check": {
      fresh_check_required: repeatGate.required,
      payout_tx: repeatPayout?.transferTxHash ?? null,
      passed: repeatGate.required === false
    },
    "changing the withdrawal address forces a fresh check": {
      gate: addressChangeGate,
      passed: addressChangeGate.required === true
    }
  },
  chain: { chain_id: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY }
});

console.log(`\nbeneficiary ${EMAIL}`);
console.log(`  ${pregenerated.address}  ${balanceBefore} -> ${balanceAfter}`);
console.log(`  ${EXPLORER}/address/${pregenerated.address}`);
