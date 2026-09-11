/**
 * Phase 2 — live provisioning run.
 *
 * Creates a business as a Privy organization with an org wallet tree, its three
 * accounts (locked ones with a policy attached at creation), records
 * `AccountRegistered` and `PolicyRotated` on `BoltRegistry`, verifies both
 * against Arc testnet by re-reading the receipt straight from the RPC, and then
 * attacks the lock the only way Phase 2 can: by trying to widen a policy without
 * the key quorum's signature.
 *
 * Resumable — state in docs/evidence/phase2-state.json. Run:
 *   pnpm --filter @bolt/privy phase2:provision
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { decodeEventLog, encodeFunctionData, getAddress, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { businesses, policyRefusals, type BoltDb } from "@bolt/db";
import {
  BOLT_REGISTRY_ABI,
  ZERO_BYTES32,
  businessIdOf,
  createRegistryWriter,
  policyHashOf,
  quorumRefOf
} from "@bolt/core";
import {
  BOLT_ERC20_ABI,
  provisionBusiness,
  rawErrorBody,
  recordPolicyRefusal,
  type ProvisionedBusiness
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase2-state.json");

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

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

/** PRIVY_AUTHORIZATION_KEY may hold either half of the P-256 keypair. */
function resolveAuthKey(b64: string): { publicKey: string; hasPrivate: boolean } {
  const der = Buffer.from(b64.replace(/^wallet-auth:/, ""), "base64");
  try {
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return {
      publicKey: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64"),
      hasPrivate: true
    };
  } catch {
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return {
      publicKey: key.export({ format: "der", type: "spki" }).toString("base64"),
      hasPrivate: false
    };
  }
}

/**
 * Direct `eth_getTransactionReceipt`. Deliberately not viem's helper: the exit
 * criterion is that the event landed on Arc, not that an SDK said it did.
 */
async function rawReceipt(hash: string): Promise<Record<string, unknown>> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [hash]
    })
  });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (!body.result) throw new Error(`no receipt for ${hash}: ${JSON.stringify(body.error)}`);
  return body.result;
}

type State = {
  permittedBeneficiary?: string;
  taxAuthority?: string;
  provisioned?: ProvisionedBusiness;
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
const auth = resolveAuthKey(need("PRIVY_AUTHORIZATION_KEY"));
console.log(
  auth.hasPrivate
    ? "PRIVY_AUTHORIZATION_KEY: private half present"
    : "PRIVY_AUTHORIZATION_KEY: PUBLIC half only — no authorization signature can be produced"
);

// Payees. In production these are verified beneficiary addresses; here they are
// throwaway EOAs so the policy has real, checkable destinations.
if (!state.permittedBeneficiary) {
  state.permittedBeneficiary = privateKeyToAccount(generatePrivateKey()).address;
  state.taxAuthority = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const BENEFICIARY = state.permittedBeneficiary;
const TAX = state.taxAuthority!;
// Fresh every run, so a re-run's widening attempt is never a rule the policy
// already carries — otherwise the "policy unchanged" check reads stale state.
const EXTRA = privateKeyToAccount(generatePrivateKey()).address;

const SLUG = "acme-marketplace";

// 1. Provision the org and the three accounts (FR-1.1, FR-1.2, FR-1.3).
if (!state.provisioned) {
  console.log("\nprovisioning organization and account tree ...");
  state.provisioned = await provisionBusiness(privy, {
    slug: SLUG,
    name: "Acme Marketplace",
    quorumPublicKeys: [auth.publicKey],
    quorumThreshold: 1,
    usdcAddress: USDC,
    chainId: CHAIN_ID,
    accounts: [
      { accountClass: "OPERATING", label: "Operating" },
      {
        accountClass: "CLIENT_MONEY",
        label: "Client money",
        permittedAddresses: [BENEFICIARY],
        // Asked for, and refused: FR-1.6 pins CLIENT_MONEY to no yield.
        yieldRequested: true
      },
      {
        accountClass: "OBLIGATION_RESERVE",
        label: "Sales tax reserve",
        permittedAddresses: [TAX],
        yieldRequested: true
      }
    ]
  });
  saveState();
  writeEvidence("phase2-provisioned-business", state.provisioned);
}
const business = state.provisioned;
console.log(`organization: ${business.organizationId}`);
console.log(`key quorum  : ${business.keyQuorumId}`);
for (const a of business.accounts) {
  console.log(
    `  ${a.accountClass.padEnd(19)} ${a.address}  policy=${a.policyId ?? "(none — unlocked by design)"}  yield=${a.yieldEnabled}`
  );
}

// 2. Confirm the policies are live on Privy and attached to the wallets — read
//    them back rather than trusting the create responses.
const attached: Record<string, unknown> = {};
for (const a of business.accounts) {
  const wallet = await privy.wallets().get(a.walletId);
  const policy = a.policyId ? await privy.policies().get(a.policyId) : null;
  attached[a.accountClass] = {
    wallet_id: a.walletId,
    address: a.address,
    entity: (wallet as unknown as { entity?: unknown }).entity ?? null,
    owner_id: (wallet as unknown as { owner_id?: unknown }).owner_id ?? null,
    policy_ids: (wallet as unknown as { policy_ids?: unknown }).policy_ids ?? [],
    policy_owner_id: policy ? (policy as unknown as { owner_id?: unknown }).owner_id : null,
    policy_rule_count: policy
      ? ((policy as unknown as { rules?: unknown[] }).rules ?? []).length
      : 0,
    yield_enabled: a.yieldEnabled
  };
}
writeEvidence("phase2-accounts-attached", {
  organization_id: business.organizationId,
  key_quorum_id: business.keyQuorumId,
  accounts: attached
});

// 3. Record on chain. BoltRegistry is not a locked account — the recorder EOA
//    signs directly; no Privy signing is involved here.
const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});
const businessId = businessIdOf(SLUG);
const quorumRef = quorumRefOf(business.keyQuorumId);

const emitted: { event: string; account?: string; txHash: string }[] = [];

console.log("\nrecording on BoltRegistry ...");
const businessReceipt = await registry.recordBusinessRegistered({
  businessId,
  slug: SLUG,
  admin: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address
});
emitted.push({ event: "BusinessRegistered", txHash: businessReceipt.transactionHash });

for (const a of business.accounts) {
  const accountReceipt = await registry.recordAccountRegistered({
    businessId,
    account: getAddress(a.address),
    accountClass: a.accountClass,
    policyHash: (a.policy ? policyHashOf(a.policy) : ZERO_BYTES32) as Hex,
    label: a.label
  });
  emitted.push({
    event: "AccountRegistered",
    account: a.address,
    txHash: accountReceipt.transactionHash
  });
  console.log(`  AccountRegistered ${a.accountClass} -> ${accountReceipt.transactionHash}`);

  // A locked account's policy went from "none" to the built policy at creation.
  // oldPolicyHash = 0x0 means there was no prior policy, which is the honest
  // reading of FR-1.3: the account never existed unlocked.
  if (a.policy) {
    const rotated = await registry.recordPolicyRotated({
      businessId,
      account: getAddress(a.address),
      oldPolicyHash: ZERO_BYTES32,
      newPolicyHash: policyHashOf(a.policy) as Hex,
      quorumRef
    });
    emitted.push({
      event: "PolicyRotated",
      account: a.address,
      txHash: rotated.transactionHash
    });
    console.log(`  PolicyRotated     ${a.accountClass} -> ${rotated.transactionHash}`);
  }
}

// 4. Verify each one landed, straight from the RPC, and decode the logs.
console.log("\nverifying receipts via eth_getTransactionReceipt ...");
const verified = [];
for (const e of emitted) {
  const receipt = await rawReceipt(e.txHash);
  const logs = (receipt.logs as { topics: Hex[]; data: Hex; address: string }[]).map((log) =>
    decodeEventLog({ abi: BOLT_REGISTRY_ABI, topics: log.topics, data: log.data })
  );
  const ok = receipt.status === "0x1" && logs.some((l) => l.eventName === e.event);
  console.log(`  ${ok ? "OK " : "BAD"} ${e.event} ${e.txHash}`);
  verified.push({
    ...e,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    explorer: `https://testnet.arcscan.app/tx/${e.txHash}`,
    decodedLogs: logs,
    verified: ok
  });
}
writeEvidence("phase2-registry-events", {
  registry: REGISTRY,
  business_id: businessId,
  quorum_ref: quorumRef,
  rpc: RPC_URL,
  events: verified
});

// 5. Invariant 3, live. Try to widen the CLIENT_MONEY policy — add a second
//    permitted payee — WITHOUT a quorum authorization signature. There is no
//    application-layer check here and no dev-mode bypass: the request goes to
//    Privy and Privy is left to refuse it.
const locked = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY");
if (!locked?.policyId) throw new Error("no CLIENT_MONEY policy to attack");

console.log("\nattempting to widen the lock without a quorum signature ...");
const wideningRule = {
  name: `Widen: add payee ${EXTRA.slice(0, 10)}`, // Privy caps rule names at 50
  method: "eth_signTransaction",
  action: "ALLOW",
  conditions: [
    { field_source: "ethereum_transaction", field: "to", operator: "in", value: [USDC.toLowerCase(), getAddress(USDC)] },
    { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
    {
      field_source: "ethereum_calldata",
      field: "function_name",
      abi: BOLT_ERC20_ABI,
      operator: "eq",
      value: "transfer"
    },
    {
      field_source: "ethereum_calldata",
      field: "transfer._to",
      abi: BOLT_ERC20_ABI,
      operator: "in",
      value: [EXTRA.toLowerCase(), getAddress(EXTRA)]
    }
  ]
} as const;

let quorumHeld = false;
try {
  // No authorization_context. The policy's owner_id is the key quorum.
  const rule = await privy
    .policies()
    .createRule(locked.policyId, wideningRule as never);
  console.log("   WIDENED — the quorum did NOT hold");
  writeEvidence("phase2-quorum-refusal", {
    expect: "REFUSE",
    outcome: "ALLOWED — INVARIANT 3 BROKEN",
    policy_id: locked.policyId,
    policy_owner_key_quorum: business.keyQuorumId,
    attempted_rule: wideningRule,
    response: rule
  });
} catch (e) {
  quorumHeld = true;
  console.log("   REFUSED");
  writeEvidence("phase2-quorum-refusal", {
    expect: "REFUSE",
    outcome: "REFUSED",
    note:
      "Adding an ALLOW rule to a policy owned by a key quorum, with no " +
      "authorization signature. No application-layer check ran; the error below " +
      "is Privy's, verbatim.",
    policy_id: locked.policyId,
    policy_owner_key_quorum: business.keyQuorumId,
    attempted_rule: wideningRule,
    error: rawErrorBody(e)
  });
}

// 6. Prove the policy really is unchanged, not merely that the call errored.
const ruleNames = async (): Promise<string[]> =>
  ((await privy.policies().get(locked.policyId!)) as unknown as { rules?: { name: string }[] })
    .rules?.map((r) => r.name) ?? [];

const afterRules = await ruleNames();
const widened = afterRules.includes(wideningRule.name);
writeEvidence("phase2-policy-after-attack", {
  policy_id: locked.policyId,
  rule_names: afterRules,
  widening_rule_present: widened
});

// 7. The positive control. Without this the refusal above proves nothing — it
//    could just mean `createRule` is broken. The identical request, signed by a
//    key in the owning quorum, must succeed. That is the whole of invariant 3:
//    widening a lock is exactly as hard as spending from it.
let authorizedWidening: { attempted: boolean; succeeded: boolean; rules?: string[] } = {
  attempted: false,
  succeeded: false
};
if (auth.hasPrivate) {
  console.log("\nre-attempting the same widening WITH a quorum signature ...");
  try {
    await privy.policies().createRule(locked.policyId, {
      ...wideningRule,
      authorization_context: {
        authorization_private_keys: [need("PRIVY_AUTHORIZATION_KEY")]
      }
    } as never);
    const rules = await ruleNames();
    authorizedWidening = { attempted: true, succeeded: rules.includes(wideningRule.name), rules };
    console.log(`   ${authorizedWidening.succeeded ? "WIDENED (as expected)" : "STILL REFUSED"}`);
    writeEvidence("phase2-quorum-widening-authorized", {
      expect: "ALLOW",
      outcome: authorizedWidening.succeeded ? "WIDENED" : "REFUSED",
      note:
        "Byte-identical to the refused request above except for the quorum " +
        "authorization signature. This is the control that makes the refusal mean something.",
      policy_id: locked.policyId,
      rule_names_after: rules
    });
  } catch (e) {
    authorizedWidening = { attempted: true, succeeded: false };
    console.log("   REFUSED even with a signature");
    writeEvidence("phase2-quorum-widening-authorized", {
      expect: "ALLOW",
      outcome: "REFUSED",
      policy_id: locked.policyId,
      error: rawErrorBody(e)
    });
  }
}

// 8. A real rotation — old hash → new hash, under the quorum that authorised it (FR-2.7).
if (authorizedWidening.succeeded) {
  const oldHash = policyHashOf(locked.policy);
  const newHash = policyHashOf({
    ...locked.policy!,
    rules: [...locked.policy!.rules, wideningRule]
  });
  const rotated = await registry.recordPolicyRotated({
    businessId,
    account: getAddress(locked.address),
    oldPolicyHash: oldHash as Hex,
    newPolicyHash: newHash as Hex,
    quorumRef
  });
  const receipt = await rawReceipt(rotated.transactionHash);
  console.log(`  PolicyRotated (real widening) -> ${rotated.transactionHash}`);
  writeEvidence("phase2-policy-rotated", {
    account: locked.address,
    old_policy_hash: oldHash,
    new_policy_hash: newHash,
    quorum_ref: quorumRef,
    tx: rotated.transactionHash,
    status: receipt.status,
    explorer: `https://testnet.arcscan.app/tx/${rotated.transactionHash}`
  });
  verified.push({
    event: "PolicyRotated",
    account: locked.address,
    txHash: rotated.transactionHash,
    status: receipt.status as string,
    blockNumber: receipt.blockNumber as string,
    explorer: `https://testnet.arcscan.app/tx/${rotated.transactionHash}`,
    decodedLogs: [],
    verified: receipt.status === "0x1"
  });
}

// 9. FR-2.4 / FR-2.5, live. Two signing attempts from the locked CLIENT_MONEY
//    account, both fully authorized by the key quorum, differing only in the
//    decoded recipient. There is no destination check anywhere in this script —
//    the requests go to Privy and the enclave decides.
//
//    Both must be authorized: an org wallet is owned by the organization's
//    default key quorum, so an unsigned request is refused at the API with a 401
//    before the policy is ever evaluated. That is a second, independent gate —
//    useful, but not the one Phase 2 is proving. To make the enclave the thing
//    that refuses, the request has to get past the quorum first.
const notPermitted = privateKeyToAccount(generatePrivateKey()).address;
const signerContext = { authorization_private_keys: [need("PRIVY_AUTHORIZATION_KEY")] };

const [nonce, fees] = await Promise.all([
  registry.getTransactionCount(getAddress(locked.address)),
  registry.estimateFeesPerGas()
]);

const transferTx = (to: string): Record<string, unknown> => ({
  from: getAddress(locked.address),
  to: getAddress(USDC),
  value: "0x0",
  chain_id: CHAIN_ID,
  nonce,
  type: 2,
  gas_limit: 300_000,
  max_fee_per_gas: `0x${fees.maxFeePerGas.toString(16)}`,
  max_priority_fee_per_gas: `0x${fees.maxPriorityFeePerGas.toString(16)}`,
  data: encodeFunctionData({
    abi: BOLT_ERC20_ABI,
    functionName: "transfer",
    args: [getAddress(to), 10_000n]
  })
});

async function signTransfer(to: string): Promise<unknown> {
  return await privy
    .wallets()
    .ethereum()
    .signTransaction(locked!.walletId, {
      params: { transaction: transferTx(to) },
      authorization_context: signerContext
    } as never);
}

// 9a. Control: the permitted beneficiary. The enclave must produce a signature.
console.log(`
permitted transfer to ${BENEFICIARY} ...`);
let permittedSigned = false;
try {
  const signed = await signTransfer(BENEFICIARY);
  permittedSigned = true;
  console.log("   SIGNED");
  writeEvidence("phase2-permitted-transfer", {
    expect: "ALLOW",
    outcome: "ALLOWED",
    note:
      "Signature only — Phase 0 established that Privy will not broadcast on Arc, " +
      "so BOLT signs in the enclave and self-broadcasts. Not broadcast here: this " +
      "wallet is unfunded and the point is that the enclave produced a signature.",
    attempted: { wallet_id: locked.walletId, to: BENEFICIARY, transaction: transferTx(BENEFICIARY) },
    response: signed
  });
} catch (e) {
  console.log("   REFUSED — the permitted destination did not go through");
  writeEvidence("phase2-permitted-transfer", {
    expect: "ALLOW",
    outcome: "REFUSED",
    attempted: { wallet_id: locked.walletId, to: BENEFICIARY },
    error: rawErrorBody(e)
  });
}

// 9b. The refusal. Same wallet, same quorum signature, different decoded recipient.
console.log(`transfer to an unpermitted address (${notPermitted}) ...`);
let refusal: unknown = null;
const attemptedAction = {
  wallet_id: locked.walletId,
  method: "eth_signTransaction",
  transaction: transferTx(notPermitted)
};
try {
  const signed = await signTransfer(notPermitted);
  console.log("   SIGNED — the lock did NOT hold");
  writeEvidence("phase2-refusal-live", {
    expect: "REFUSE",
    outcome: "ALLOWED — INVARIANT 2 BROKEN",
    attempted: attemptedAction,
    response: signed
  });
} catch (e) {
  refusal = e;
  console.log("   REFUSED");
}

let storedRefusal: unknown = null;
if (refusal) {
  // PGlite, because direct Postgres ports are unreachable from this sandbox.
  // Same schema, same drizzle writer, same jsonb column as production.
  const pg = new PGlite();
  const db = drizzle(pg) as unknown as BoltDb;
  const schemaSql = readFileSync(
    join(REPO, "packages", "db", "drizzle", "0000_swift_cardiac.sql"),
    "utf8"
  );
  for (const stmt of schemaSql.split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  const [biz] = await db
    .insert(businesses)
    .values({ slug: SLUG, name: business.name, adminAddress: locked.address })
    .returning({ id: businesses.id });
  const id = await recordPolicyRefusal(db, {
    businessId: biz!.id,
    error: refusal,
    attemptedAction
  });
  const [row] = await db.select().from(policyRefusals).where(eq(policyRefusals.id, id));
  storedRefusal = row?.rawError;
  writeEvidence("phase2-refusal-live", {
    expect: "REFUSE",
    outcome: "REFUSED",
    note:
      "No application-layer destination check ran, and the request carried a valid " +
      "quorum authorization signature — so the refusal is the policy, not the API " +
      "gate. The body below is what came back OUT of the policy_refusals jsonb " +
      "column, not what went in.",
    attempted: attemptedAction,
    db_row_id: id,
    raw_error_read_back_from_postgres: storedRefusal
  });
}

writeEvidence("phase2-summary", {
  chain: { chain_id: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY },
  organization_id: business.organizationId,
  key_quorum_id: business.keyQuorumId,
  accounts: business.accounts.map((a) => ({
    class: a.accountClass,
    address: a.address,
    policy_id: a.policyId,
    policy_hash: a.policyHash,
    yield_enabled: a.yieldEnabled,
    explorer: `https://testnet.arcscan.app/address/${a.address}`
  })),
  permitted: { client_money: BENEFICIARY, obligation_reserve: TAX, never_permitted: EXTRA },
  registry_events: verified.map((v) => ({
    event: v.event,
    account: v.account,
    tx: v.txHash,
    verified: v.verified
  })),
  refusal: {
    permitted_transfer_signed: permittedSigned,
    attempted_destination: notPermitted,
    refused: refusal !== null,
    stored_and_read_back: storedRefusal !== null
  },
  quorum_enforcement: {
    widening_without_quorum_refused: quorumHeld,
    policy_widened_without_quorum: widened,
    widening_with_quorum_succeeded: authorizedWidening.succeeded
  }
});

console.log(
  `\nquorum held: ${quorumHeld} · policy widened: ${widened} · registry events verified: ` +
    `${verified.filter((v) => v.verified).length}/${verified.length}`
);
