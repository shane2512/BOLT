/**
 * Phase 9, day 8 — provisions the breach simulator's sandbox business (FR-9) and
 * proves three things live, against Arc testnet and a real Privy enclave:
 *
 *   1. the sandbox is a real, funded, locked BOLT business — same provisioning
 *      path as Phase 2, not a mock and not a copy of a real business
 *   2. Phase 0's whole attack suite is still refused by it, with the raw error
 *      preserved verbatim for the page to show (FR-9.2)
 *   3. the sandbox's operator credential — the only credential the /simulator
 *      route ever holds — cannot address `acme-marketplace` or
 *      `bolt-unlock-demo` at all (FR-9.4). Not "the UI doesn't offer it":
 *      different key quorum, so Privy refuses the request outright.
 *
 * Resumable — state in docs/evidence/phase9-simulator-state.json. Run:
 *   pnpm --filter @bolt/privy phase9:simulator
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  type Hex
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  BOLT_REGISTRY_ABI,
  ZERO_BYTES32,
  businessIdOf,
  createRegistryWriter,
  policyHashOf,
  quorumRefOf
} from "@bolt/core";
import {
  SIMULATOR_ATTACKS,
  attemptAttack,
  provisionBusiness,
  rawErrorBody,
  type ProvisionedBusiness,
  type SimulatorWallet
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const ENV_FILE = join(REPO, ".env");
const STATE_FILE = join(EVIDENCE, "phase9-simulator-state.json");
/** Read by the public /simulator page. Contains ids and addresses only — no key. */
const SANDBOX_FILE = join(REPO, "apps", "web", "src", "app", "simulator", "sandbox.json");

loadEnv({ path: ENV_FILE });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in ${ENV_FILE}`);
  return v;
};

const RPC_URL = need("ARC_RPC_URL");
const CHAIN_ID = Number(need("ARC_CHAIN_ID"));
const USDC = need("USDC_ADDRESS");
const REGISTRY = getAddress(need("REGISTRY_ADDRESS"));
const SLUG = "bolt-simulator-sandbox";
/** 0.25 USDC. On Arc the native token IS USDC, at 18 decimals natively. */
const FUNDING_WEI = 250_000_000_000_000_000n;

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

function persistEnv(key: string, value: string): void {
  process.env[key] = value;
  const current = readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(
    ENV_FILE,
    pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`
  );
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
  simulatorPublicKey?: string;
  permittedPayee?: string;
  provisioned?: ProvisionedBusiness;
  funded?: boolean;
  registryTxs?: { event: string; account?: string; txHash: string }[];
};
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State)
  : {};
const saveState = (): void => writeFileSync(STATE_FILE, jsonify(state) + "\n");

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});
const publicClient = createPublicClient({ transport: http(RPC_URL) });

// ---------------------------------------------------------------------------
// 1. The sandbox's own credential. Generated here, used nowhere else.
// ---------------------------------------------------------------------------
// This is the whole of FR-9.4. The simulator's route holds this key and only
// this key; every real business's wallets and policies are owned by a different
// key quorum, so this key is not "not offered" those wallets — it cannot
// authorize a request against them at all. Proven in step 6.
if (!process.env.SIMULATOR_AUTHORIZATION_KEY) {
  console.log("generating the sandbox's own authorization keypair ...");
  const { privateKey, publicKey } = newAuthorizationKey();
  persistEnv("SIMULATOR_AUTHORIZATION_KEY", privateKey);
  state.simulatorPublicKey = publicKey;
  saveState();
}
const SIMULATOR_KEY = need("SIMULATOR_AUTHORIZATION_KEY");
const simulatorPublicKey = state.simulatorPublicKey;
if (!simulatorPublicKey) {
  throw new Error(
    "SIMULATOR_AUTHORIZATION_KEY exists but its public half is not in state — " +
      "delete both and re-run so the quorum and the key are provisioned together."
  );
}

if (!state.permittedPayee) {
  state.permittedPayee = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const PERMITTED = state.permittedPayee;

// ---------------------------------------------------------------------------
// 2. The sandbox business — same provisionBusiness() as Phase 2 (FR-1.1..1.3)
// ---------------------------------------------------------------------------
if (!state.provisioned) {
  console.log("\nprovisioning the sandbox organization and account tree ...");
  state.provisioned = await provisionBusiness(privy, {
    slug: SLUG,
    name: "BOLT Simulator Sandbox",
    // One key, and it is the simulator's. Deliberately NOT the key quorum any
    // real business uses.
    quorumPublicKeys: [simulatorPublicKey],
    quorumThreshold: 1,
    usdcAddress: USDC,
    chainId: CHAIN_ID,
    accounts: [
      { accountClass: "OPERATING", label: "Sandbox operating" },
      {
        accountClass: "CLIENT_MONEY",
        label: "Sandbox client money",
        permittedAddresses: [PERMITTED]
      },
      {
        accountClass: "OBLIGATION_RESERVE",
        label: "Sandbox tax reserve",
        permittedAddresses: [privateKeyToAccount(generatePrivateKey()).address]
      }
    ]
  });
  saveState();
  writeEvidence("phase9-simulator-provisioned", state.provisioned);
}
const business = state.provisioned;
const target = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY");
if (!target?.policyId) throw new Error("sandbox has no locked CLIENT_MONEY account");

console.log(`organization: ${business.organizationId}`);
console.log(`key quorum  : ${business.keyQuorumId}`);
for (const a of business.accounts) {
  console.log(`  ${a.accountClass.padEnd(19)} ${a.address}  policy=${a.policyId ?? "(none)"}`);
}

// ---------------------------------------------------------------------------
// 3. Fund the locked account, so the money a visitor tries to steal is real
// ---------------------------------------------------------------------------
const balanceBefore = await publicClient.getBalance({ address: getAddress(target.address) });
if (balanceBefore < FUNDING_WEI && !state.funded) {
  console.log(`\nfunding ${target.address} with 0.25 USDC from the deployer ...`);
  const deployer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
  const walletClient = createWalletClient({ account: deployer, transport: http(RPC_URL) });
  const hash = await walletClient.sendTransaction({
    to: getAddress(target.address),
    value: FUNDING_WEI,
    chain: null
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  state.funded = receipt.status === "success";
  saveState();
  console.log(`   ${hash} -> ${receipt.status}`);
  writeEvidence("phase9-simulator-funding", {
    from: deployer.address,
    to: target.address,
    value_wei: FUNDING_WEI,
    tx: hash,
    status: receipt.status,
    explorer: `https://testnet.arcscan.app/tx/${hash}`
  });
}
const sandboxBalance = await publicClient.getBalance({ address: getAddress(target.address) });
console.log(`sandbox client-money balance: ${sandboxBalance} wei (native USDC)`);

// ---------------------------------------------------------------------------
// 4. Record the sandbox on BoltRegistry, like any other business
// ---------------------------------------------------------------------------
const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});
const businessId = businessIdOf(SLUG);
const quorumRef = quorumRefOf(business.keyQuorumId);

if (!state.registryTxs) {
  console.log("\nrecording the sandbox on BoltRegistry ...");
  const txs: { event: string; account?: string; txHash: string }[] = [];
  const registered = await registry.recordBusinessRegistered({
    businessId,
    slug: SLUG,
    admin: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address
  });
  txs.push({ event: "BusinessRegistered", txHash: registered.transactionHash });
  for (const a of business.accounts) {
    const r = await registry.recordAccountRegistered({
      businessId,
      account: getAddress(a.address),
      accountClass: a.accountClass,
      policyHash: (a.policy ? policyHashOf(a.policy) : ZERO_BYTES32) as Hex,
      label: a.label
    });
    txs.push({ event: "AccountRegistered", account: a.address, txHash: r.transactionHash });
    if (a.policy) {
      const rot = await registry.recordPolicyRotated({
        businessId,
        account: getAddress(a.address),
        oldPolicyHash: ZERO_BYTES32,
        newPolicyHash: policyHashOf(a.policy) as Hex,
        quorumRef
      });
      txs.push({ event: "PolicyRotated", account: a.address, txHash: rot.transactionHash });
    }
  }
  state.registryTxs = txs;
  saveState();

  // Verified straight from the RPC, not from the SDK's say-so.
  const verified = [];
  for (const t of txs) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [t.txHash]
      })
    });
    const body = (await res.json()) as { result?: Record<string, unknown> };
    const receipt = body.result ?? {};
    const logs = ((receipt.logs ?? []) as { topics: Hex[]; data: Hex }[]).map((log) =>
      decodeEventLog({ abi: BOLT_REGISTRY_ABI, topics: log.topics, data: log.data })
    );
    verified.push({
      ...t,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      explorer: `https://testnet.arcscan.app/tx/${t.txHash}`,
      decodedLogs: logs,
      verified: receipt.status === "0x1" && logs.some((l) => l.eventName === t.event)
    });
    console.log(`  ${receipt.status === "0x1" ? "OK " : "BAD"} ${t.event} ${t.txHash}`);
  }
  writeEvidence("phase9-simulator-registry-events", {
    registry: REGISTRY,
    business_id: businessId,
    quorum_ref: quorumRef,
    events: verified
  });
}

// ---------------------------------------------------------------------------
// 5. Phase 0's attack suite, live, against the sandbox
// ---------------------------------------------------------------------------
const wallet: SimulatorWallet = {
  walletId: target.walletId,
  address: target.address,
  usdcAddress: USDC,
  permittedPayee: PERMITTED,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  authorizationPrivateKeys: [SIMULATOR_KEY]
};

// The thief's address. A throwaway EOA, exactly as a visitor's would be.
const THIEF = privateKeyToAccount(generatePrivateKey()).address;
console.log(`\nrunning the attack suite. thief address: ${THIEF}\n`);

const results: { id: string; expect: string; outcome: string; policyViolation: boolean }[] = [];
for (const attack of SIMULATOR_ATTACKS) {
  process.stdout.write(`${attack.id.padEnd(36)} (expect ${attack.expect}) ... `);
  const result = await attemptAttack(privy, wallet, attack, THIEF);
  const policyViolation =
    result.outcome === "REFUSED" && jsonify(result.rawError).toLowerCase().includes("policy_violation");
  console.log(
    result.outcome === "ALLOWED"
      ? "ALLOWED"
      : policyViolation
        ? "REFUSED (policy_violation)"
        : "REFUSED (not a policy violation)"
  );
  results.push({ id: attack.id, expect: attack.expect, outcome: result.outcome, policyViolation });
  writeEvidence(`phase9-simulator-${attack.id}`, {
    expect: attack.expect,
    stopped_by: attack.stoppedBy,
    wallet: target.address,
    thief: THIEF,
    ...result
  });
}

// The ALLOW control, actually broadcast. Without this the refusals prove nothing:
// they could just mean signing is broken. A confirmed transfer on Arc says the
// enclave signs real, spendable transactions for the permitted destination and
// refuses every other shape.
const control = SIMULATOR_ATTACKS.find((a) => a.id === "permitted-transfer")!;
const signedControl = await attemptAttack(privy, wallet, control, THIEF);
let controlTx: string | null = null;
if (signedControl.outcome === "ALLOWED") {
  const raw = (signedControl.signedTransaction as { signed_transaction?: Hex }).signed_transaction;
  if (raw && sandboxBalance > 0n) {
    try {
      const hash = await publicClient.sendRawTransaction({ serializedTransaction: raw });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      controlTx = hash;
      console.log(`\ncontrol transfer broadcast: ${hash} -> ${receipt.status}`);
      writeEvidence("phase9-simulator-control-broadcast", {
        note:
          "The permitted transfer, signed by the enclave and self-broadcast (Privy " +
          "does not broadcast on Arc). Proof the sandbox account holds real money " +
          "and the signatures the enclave withholds from every attack are real ones.",
        from: target.address,
        to: PERMITTED,
        tx: hash,
        status: receipt.status,
        explorer: `https://testnet.arcscan.app/tx/${hash}`
      });
    } catch (e) {
      console.log(`\ncontrol broadcast failed: ${String(e).slice(0, 120)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. FR-9.4 — isolation, attacked rather than asserted
// ---------------------------------------------------------------------------
// Every real business provisioned so far, with the wallet the simulator would
// have to reach to steal anything real. Read from the Phase 2 / Phase 6 evidence
// so this check follows the businesses that actually exist.
const realBusinesses = [
  { file: "phase2-provisioned-business.json", slug: "acme-marketplace" },
  { file: "phase6-provisioned-business.json", slug: "bolt-unlock-demo" }
].map(({ file, slug }) => {
  const b = JSON.parse(readFileSync(join(EVIDENCE, file), "utf8")) as ProvisionedBusiness;
  const locked = b.accounts.find((a) => a.accountClass === "CLIENT_MONEY")!;
  return { slug, keyQuorumId: b.keyQuorumId, organizationId: b.organizationId, locked };
});

console.log("\nisolation: pointing the simulator's credential at real businesses ...");
const isolation = [];
for (const real of realBusinesses) {
  // 6a. Sign a transfer out of the real business's locked account, using the
  //     simulator's key. This is the actual theft the simulator must not enable.
  const attempt = await attemptAttack(
    privy,
    {
      ...wallet,
      walletId: real.locked.walletId,
      address: real.locked.address
    },
    SIMULATOR_ATTACKS[0]!, // wrong-destination: a plain transfer to the thief
    THIEF
  );

  // 6b. Widen the real business's policy with the simulator's key — the other
  //     way in. Invariant 3: widening a lock is as hard as spending from it.
  let widening: unknown;
  let widened = false;
  try {
    await privy.policies().createRule(real.locked.policyId!, {
      name: "Simulator widening attempt",
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [],
      authorization_context: { authorization_private_keys: [SIMULATOR_KEY] }
    } as never);
    widened = true;
    widening = { outcome: "ALLOWED — ISOLATION BROKEN" };
  } catch (e) {
    widening = rawErrorBody(e);
  }

  const reachable = attempt.outcome === "ALLOWED" || widened;
  console.log(
    `  ${real.slug.padEnd(22)} spend=${attempt.outcome} widen=${widened ? "ALLOWED" : "REFUSED"}`
  );
  isolation.push({
    slug: real.slug,
    their_key_quorum: real.keyQuorumId,
    sandbox_key_quorum: business.keyQuorumId,
    shares_key_quorum: real.keyQuorumId === business.keyQuorumId,
    shares_organization: real.organizationId === business.organizationId,
    locked_account: real.locked.address,
    spend_attempt: attempt,
    widen_attempt: widening,
    reachable_by_simulator: reachable
  });
}

// 6c. The sandbox's permitted destination is nobody's real account, so even the
//     one transfer the sandbox policy allows cannot move a real business's money
//     anywhere — and no real policy permits a sandbox address either.
const realAddresses = realBusinesses.map((r) => r.locked.address.toLowerCase());
const sandboxAddresses = business.accounts.map((a) => a.address.toLowerCase());
const destinationOverlap = [PERMITTED.toLowerCase(), ...sandboxAddresses].filter((a) =>
  realAddresses.includes(a)
);

writeEvidence("phase9-simulator-isolation", {
  question:
    "Can the credential the /simulator route holds reach a real business's money? " +
    "Attempted, not reasoned about.",
  sandbox: {
    slug: SLUG,
    organization_id: business.organizationId,
    key_quorum_id: business.keyQuorumId,
    accounts: sandboxAddresses,
    permitted_payee: PERMITTED
  },
  attempts: isolation,
  address_overlap_with_real_businesses: destinationOverlap,
  isolated: isolation.every((i) => !i.reachable_by_simulator) && destinationOverlap.length === 0
});

// ---------------------------------------------------------------------------
// 7. The file the public page reads. Ids and addresses only — never the key.
// ---------------------------------------------------------------------------
writeFileSync(
  SANDBOX_FILE,
  jsonify({
    slug: SLUG,
    name: "BOLT Simulator Sandbox",
    organizationId: business.organizationId,
    keyQuorumId: business.keyQuorumId,
    chainId: CHAIN_ID,
    usdcAddress: USDC,
    permittedPayee: PERMITTED,
    account: {
      walletId: target.walletId,
      address: target.address,
      accountClass: target.accountClass,
      policyId: target.policyId,
      policyHash: target.policyHash
    },
    otherAccounts: business.accounts
      .filter((a) => a.address !== target.address)
      .map((a) => ({ accountClass: a.accountClass, address: a.address, policyId: a.policyId }))
  }) + "\n"
);
console.log(`\n   -> apps/web/src/app/simulator/sandbox.json`);

const refusedAsExpected = results.filter(
  (r) => (r.expect === "REFUSE") === (r.outcome === "REFUSED")
).length;

writeEvidence("phase9-simulator-summary", {
  chain: { chain_id: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY },
  sandbox: {
    slug: SLUG,
    organization_id: business.organizationId,
    key_quorum_id: business.keyQuorumId,
    locked_account: target.address,
    policy_id: target.policyId,
    permitted_payee: PERMITTED,
    balance_wei: sandboxBalance,
    explorer: `https://testnet.arcscan.app/address/${target.address}`
  },
  attack_suite: results,
  attacks_behaving_as_expected: `${refusedAsExpected}/${results.length}`,
  control_broadcast_tx: controlTx,
  isolation: isolation.map((i) => ({
    slug: i.slug,
    reachable_by_simulator: i.reachable_by_simulator,
    shares_key_quorum: i.shares_key_quorum
  }))
});

console.log(
  `\nsuite: ${refusedAsExpected}/${results.length} behaved as expected · isolation: ` +
    `${isolation.every((i) => !i.reachable_by_simulator) ? "HELD" : "BROKEN"}`
);
