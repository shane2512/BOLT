/**
 * Phase 7 exit criterion — "deliberately misconfigure the splitter, and the
 * Monitor detects and alerts on the drift". Live, on Arc testnet, not asserted
 * in a unit test.
 *
 * What this does, in order:
 *
 *  1. Publishes mandate v1 on chain (`MandatePublished`, FR-4.2). Phase 3
 *     published v1 into Postgres but never emitted the event, which the Monitor
 *     had already caught as `UNRATIFIED_MANDATE` — see
 *     `docs/evidence/phase7-findings-before.json`. This closes that gap so drift
 *     is measured against a ratified version rather than an unratified one.
 *  2. Runs one **correct** deposit through the real splitter — the Phase 3
 *     mandate, 88% client money / 4% tax reserve / 8% operating. This confirms
 *     the baseline the Monitor anchors on.
 *  3. Runs two **misconfigured** deposits. The mandate handed to the splitter is
 *     8300 / 400 / 1300 — five percent of every deposit diverted out of client
 *     money and into the business's own operating account — while the deposit is
 *     still recorded, and `DepositObserved` still emitted, as mandate version 1.
 *     That is precisely what a compromised or buggy splitter looks like from
 *     outside: the right version stamped on the wrong ratios.
 *  4. Waits for the subgraph to index it, then runs the Monitor and prints what
 *     it found.
 *
 * Two things worth saying plainly about step 3:
 *
 *  - **The Privy policy cannot catch this and is not supposed to.** Both the
 *    correct and the misconfigured transfers go to the business's own accounts,
 *    which is exactly what the splitter's session-signer policy permits
 *    (FR-3.3). A wrong *ratio* to a permitted *destination* is a permitted
 *    transaction. The lock constrains where money may go; it says nothing about
 *    how much. That gap is the Monitor's job, and this run is the proof it does
 *    it.
 *  - **Coverage stays at 100% throughout.** The splitter accrues an obligation
 *    equal to what it actually paid, so held still equals owed and the coverage
 *    line never dips. Only comparing the realized ratio against the baseline
 *    ratio finds it.
 *
 * Real: the deposits, the Privy session-signer signatures, the broadcast
 * transfers, the BoltRegistry events. Simulated: Postgres (PGlite, in-memory
 * WASM Postgres on the identical Drizzle schema — direct Postgres is
 * unreachable from this environment, as in Phase 3).
 *
 *   pnpm --filter @bolt/monitor drift-demo
 *
 * Resumable: state in docs/evidence/phase7-drift-state.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { accounts as accountsTable, businesses, type BoltDb } from "@bolt/db";
import {
  arcTestnet,
  businessIdOf,
  bytes32Of,
  createRegistryWriter,
  policyHashOf,
  quorumRefOf,
  runChecks,
  type MandateRule
} from "@bolt/core";
import {
  BOLT_ERC20_ABI,
  executeSplit,
  publishMandate,
  recordDeposit,
  resolveDepositLog,
  type SplitterAccount,
  type SplitterConfig
} from "@bolt/privy";
import { loadSnapshot } from "../src/snapshot.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase7-drift-state.json");
loadEnv({ path: join(REPO, ".env") });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in .env`);
  return v;
};

const RPC_URL = need("ARC_RPC_URL");
const CHAIN_ID = Number(need("ARC_CHAIN_ID"));
const USDC = need("USDC_ADDRESS");
const REGISTRY = getAddress(need("REGISTRY_ADDRESS"));
const SUBGRAPH_URL = need("SUBGRAPH_URL");
const SLUG = "acme-marketplace";
const DEPOSIT_AMOUNT = 2_000_000n; // 2.00 USDC per deposit

/** The mandate a key quorum published. 8800 + 400 + 800 = 10000. */
const CORRECT_BPS = { client: 8800, reserve: 400, operating: 800 };
/** What the compromised splitter actually pays. Still sums to 10000 — that is
 *  why `computeSplits`' own assertion cannot catch it either. */
const SKIMMING_BPS = { client: 8300, reserve: 400, operating: 1300 };

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

type State = { mandatePublishedTx?: string; deposits?: { label: string; txHash: string }[] };
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State)
  : {};
const saveState = (): void => writeFileSync(STATE_FILE, jsonify(state) + "\n");

// ---------------------------------------------------------------------------
// Phase 2's provisioned business
// ---------------------------------------------------------------------------

type Phase2State = {
  provisioned: {
    name: string;
    keyQuorumId: string;
    organizationId: string;
    accounts: {
      accountClass: "OPERATING" | "CLIENT_MONEY" | "OBLIGATION_RESERVE";
      label: string;
      walletId: string;
      address: string;
      policyId: string | null;
      policy: unknown;
    }[];
  };
};
const phase2 = JSON.parse(readFileSync(join(EVIDENCE, "phase2-state.json"), "utf8")) as Phase2State;
const business = phase2.provisioned;
const operating = business.accounts.find((a) => a.accountClass === "OPERATING")!;
const clientMoney = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY")!;
const reserve = business.accounts.find((a) => a.accountClass === "OBLIGATION_RESERVE")!;

// ---------------------------------------------------------------------------
// 0. What the Monitor says BEFORE anything moves
// ---------------------------------------------------------------------------

console.log("Monitor, before the run:");
const before = await loadSnapshot(SUBGRAPH_URL, SLUG);
const findingsBefore = runChecks(before);
for (const f of findingsBefore) console.log(`   [${f.severity}] ${f.kind}: ${f.title}`);
writeEvidence("phase7-findings-before", {
  note:
    "The Solvency Monitor's findings for acme-marketplace before the drift demo ran. " +
    "The UNRATIFIED_MANDATE finding is real and was not planted: Phase 3 published " +
    "mandate v1 into Postgres but never emitted MandatePublished, and the Monitor " +
    "found that by comparing DepositObserved.mandateVersion against the MandatePublished " +
    "events the subgraph has indexed. Step 1 of this script closes it.",
  subgraphUrl: SUBGRAPH_URL,
  indexedAtBlock: before.indexedAtBlock.toString(),
  depositsIndexed: before.deposits.length,
  findings: findingsBefore
});

// ---------------------------------------------------------------------------
// Chain + Privy + an in-memory Postgres on the real schema
// ---------------------------------------------------------------------------

const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const deployer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
const deployerWallet = createWalletClient({ chain: arcTestnet, transport, account: deployer });

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});
const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});

const pg = new PGlite();
const db = drizzle(pg) as unknown as BoltDb;
for (const stmt of readFileSync(
  join(REPO, "packages", "db", "drizzle", "0000_swift_cardiac.sql"),
  "utf8"
).split("--> statement-breakpoint")) {
  if (stmt.trim()) await pg.exec(stmt);
}

const [bizRow] = await db
  .insert(businesses)
  .values({ slug: SLUG, name: business.name, adminAddress: deployer.address })
  .returning({ id: businesses.id });
const businessId = bizRow!.id;

const accountRows = await db
  .insert(accountsTable)
  .values(
    business.accounts.map((a) => ({
      businessId,
      address: a.address,
      class: a.accountClass,
      label: a.label,
      policyId: a.policyId,
      policyHash: a.policy ? policyHashOf(a.policy) : null,
      yieldEnabled: a.accountClass === "OBLIGATION_RESERVE"
    }))
  )
  .returning({ id: accountsTable.id, address: accountsTable.address });
const idOf = new Map(accountRows.map((r) => [r.address, r.id]));

const accountsById = new Map<string, SplitterAccount>(
  business.accounts.map((a) => [
    idOf.get(a.address)!,
    { id: idOf.get(a.address)!, address: a.address, accountClass: a.accountClass, label: a.label }
  ])
);

const rulesFor = (bps: typeof CORRECT_BPS): MandateRule[] => [
  { destinationAccountId: idOf.get(clientMoney.address)!, bps: bps.client },
  { destinationAccountId: idOf.get(reserve.address)!, bps: bps.reserve },
  { destinationAccountId: idOf.get(operating.address)!, bps: bps.operating }
];

// ---------------------------------------------------------------------------
// 1. Publish mandate v1 on chain (FR-4.2) — closing the gap the Monitor found
// ---------------------------------------------------------------------------

const correctRulesDescribed = [
  { description: "88% to the seller (client money)", ...rulesFor(CORRECT_BPS)[0]! },
  { description: "4% sales tax (obligation reserve)", ...rulesFor(CORRECT_BPS)[1]! },
  { description: "8% retained (operating)", ...rulesFor(CORRECT_BPS)[2]! }
];
const rulesHash = bytes32Of(
  JSON.stringify([
    { account: clientMoney.address.toLowerCase(), bps: CORRECT_BPS.client },
    { account: reserve.address.toLowerCase(), bps: CORRECT_BPS.reserve },
    { account: operating.address.toLowerCase(), bps: CORRECT_BPS.operating }
  ])
);
const quorumRef = quorumRefOf(business.keyQuorumId);

const mandate = await publishMandate(db, {
  businessId,
  version: 1,
  rulesHash,
  quorumRef,
  rules: correctRulesDescribed
});

if (!state.mandatePublishedTx) {
  console.log("\npublishing mandate v1 on chain (MandatePublished) ...");
  const receipt = await registry.recordMandatePublished({
    businessId: businessIdOf(SLUG),
    version: 1,
    rulesHash,
    quorumRef
  });
  state.mandatePublishedTx = receipt.transactionHash;
  saveState();
  console.log(`   ${receipt.transactionHash} (block ${receipt.blockNumber})`);
}

// ---------------------------------------------------------------------------
// 2 & 3. Deposits — one honest, two skimming
// ---------------------------------------------------------------------------

const balanceOf = async (address: string): Promise<bigint> =>
  (await publicClient.readContract({
    address: getAddress(USDC),
    abi: BOLT_ERC20_ABI,
    functionName: "balanceOf",
    args: [getAddress(address)]
  })) as bigint;

const cfg: SplitterConfig = {
  sourceWalletId: operating.walletId,
  sourceAddress: operating.address,
  splitterAuthorizationKey: need("PRIVY_SPLITTER_AUTHORIZATION_KEY"),
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  onChainBusinessId: businessIdOf(SLUG),
  beneficiaryRefFor: (a: SplitterAccount) => bytes32Of(a.label)
};

interface Run {
  label: string;
  bps: typeof CORRECT_BPS;
  fundingTx: string;
  depositBlock: string;
  splits: { address: string; class: string; amount: string; txHash: string | null }[];
  registryTxs: { event: string; account?: string; txHash: string }[];
}

state.deposits ??= [];
const runs: Run[] = [];

async function runDeposit(label: string, bps: typeof CORRECT_BPS): Promise<Run> {
  console.log(`\n[${label}] funding OPERATING with ${DEPOSIT_AMOUNT} base units ...`);
  const remembered = state.deposits!.find((d) => d.label === label);
  let fundingTx = remembered?.txHash;
  if (!fundingTx) {
    fundingTx = await deployerWallet.writeContract({
      address: getAddress(USDC),
      abi: BOLT_ERC20_ABI,
      functionName: "transfer",
      args: [getAddress(operating.address), DEPOSIT_AMOUNT]
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: fundingTx as Hex });
    if (receipt.status !== "success") throw new Error(`funding failed: ${fundingTx}`);
    state.deposits!.push({ label, txHash: fundingTx });
    saveState();
  }
  console.log(`   deposit tx ${fundingTx}`);

  // Same resolution the production webhook path uses: the chain says which log
  // credited the account and for how much, not the payload.
  const { logIndex, amount } = await resolveDepositLog(
    {
      type: "wallet.funds_deposited",
      wallet_id: operating.walletId,
      idempotency_key: `drift_${label}`,
      caip2: `eip155:${CHAIN_ID}`,
      asset: { type: "erc20", address: USDC },
      amount: DEPOSIT_AMOUNT.toString(),
      transaction_hash: fundingTx,
      sender: deployer.address,
      recipient: operating.address,
      block: { number: 0, timestamp: 0 }
    } as never,
    { usdcAddress: USDC, rpcUrl: RPC_URL }
  );

  const { deposit, isNew } = await recordDeposit(db, {
    businessId,
    accountId: idOf.get(operating.address)!,
    txHash: fundingTx.toLowerCase(),
    logIndex,
    amount,
    // FR-3.4 — the version the splitter CLAIMS. Unchanged for every run here,
    // including the skimming ones. That is the lie the Monitor detects.
    mandateVersion: 1
  });
  if (!isNew) console.log("   (deposit already recorded in this in-memory db)");

  const rules = rulesFor(bps);
  console.log(
    `   splitting under ratios ${bps.client}/${bps.reserve}/${bps.operating} bps ` +
      `(reported as mandate v${deposit.mandateVersion})`
  );
  const result = await executeSplit(
    privy,
    db,
    registry,
    cfg,
    deposit,
    { id: mandate.id, version: 1, rules },
    accountsById
  );

  for (const s of result.splits) {
    console.log(
      `     ${s.accountClass.padEnd(19)} ${s.amount.toString().padStart(9)} ${
        s.moved ? s.txHash : "(stayed in operating)"
      }`
    );
  }
  if (result.unallocated > 0n) console.log(`     UNALLOCATED ${result.unallocated}`);

  const receipt = await publicClient.getTransactionReceipt({ hash: fundingTx as Hex });
  return {
    label,
    bps,
    fundingTx,
    depositBlock: receipt.blockNumber.toString(),
    splits: result.splits.map((s) => ({
      address: s.address,
      class: s.accountClass,
      amount: s.amount.toString(),
      txHash: s.txHash
    })),
    registryTxs: result.registryTxs
  };
}

const balancesBefore = {
  operating: await balanceOf(operating.address),
  client_money: await balanceOf(clientMoney.address),
  reserve: await balanceOf(reserve.address)
};

runs.push(await runDeposit("honest-1", CORRECT_BPS));
runs.push(await runDeposit("skimming-1", SKIMMING_BPS));
runs.push(await runDeposit("skimming-2", SKIMMING_BPS));

const balancesAfter = {
  operating: await balanceOf(operating.address),
  client_money: await balanceOf(clientMoney.address),
  reserve: await balanceOf(reserve.address)
};

// ---------------------------------------------------------------------------
// 4. Let the index catch up, then ask the Monitor
// ---------------------------------------------------------------------------

const lastRegistryTx = runs[runs.length - 1]!.registryTxs.at(-1)!.txHash;
const lastBlock = (
  await publicClient.getTransactionReceipt({ hash: lastRegistryTx as Hex })
).blockNumber;
console.log(`\nwaiting for the subgraph to index past block ${lastBlock} ...`);

let snapshot = await loadSnapshot(SUBGRAPH_URL, SLUG);
for (let i = 0; i < 60 && snapshot.indexedAtBlock < lastBlock; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  snapshot = await loadSnapshot(SUBGRAPH_URL, SLUG);
  process.stdout.write(`   head ${snapshot.indexedAtBlock}\r`);
}
console.log(`   indexed to block ${snapshot.indexedAtBlock}, ${snapshot.deposits.length} deposits\n`);

const findingsAfter = runChecks(snapshot);
console.log("Monitor, after the run:");
for (const f of findingsAfter) {
  console.log(`   [${f.severity}] ${f.kind}: ${f.title}`);
  if (f.kind === "MANDATE_DRIFT" && f.severity !== "INFO") {
    console.log(`\n${f.message.replace(/\s+/g, " ")}\n`);
  }
}

const drift = findingsAfter.find((f) => f.kind === "MANDATE_DRIFT" && f.severity === "SEVERE");

writeEvidence("phase7-drift-detected", {
  note:
    "Phase 7 exit criterion: deliberately misconfigure the splitter, and the Monitor " +
    "detects the drift. The misconfiguration is real — three live deposits on Arc " +
    "testnet split by a real Privy session signer, one at the mandate's ratios and two " +
    "at 8300/400/1300, all three stamped mandateVersion 1. The Privy policy permitted " +
    "every one of them, correctly: all the destinations are the business's own accounts, " +
    "and a policy constrains destinations, not ratios. Coverage stayed at 100% throughout, " +
    "because the obligation accrued on each deposit equals what was actually paid. Only " +
    "comparing realized ratios against the baseline finds it.",
  chain: { chainId: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY },
  mandate: {
    version: 1,
    correctBps: CORRECT_BPS,
    rulesHash,
    quorumRef,
    keyQuorumId: business.keyQuorumId,
    publishedOnChainTx: state.mandatePublishedTx,
    explorer: `https://testnet.arcscan.app/tx/${state.mandatePublishedTx}`
  },
  misconfiguration: {
    splitterRatiosUsed: SKIMMING_BPS,
    reportedMandateVersion: 1,
    diversionPerDeposit: `${(CORRECT_BPS.client - SKIMMING_BPS.client) / 100}% of every deposit, out of CLIENT_MONEY into OPERATING`,
    privyPolicyOutcome:
      "PERMITTED — and correctly so. The splitter's session-signer policy (FR-3.3) allows " +
      "USDC transfers to this business's own accounts. Both the honest and the skimming " +
      "splits target those accounts, so the enclave has nothing to refuse. This is the " +
      "class of failure a policy cannot see, which is why FR-7.3 exists."
  },
  runs,
  balances: {
    before: Object.fromEntries(Object.entries(balancesBefore).map(([k, v]) => [k, v.toString()])),
    after: Object.fromEntries(Object.entries(balancesAfter).map(([k, v]) => [k, v.toString()]))
  },
  monitor: {
    subgraphUrl: SUBGRAPH_URL,
    indexedAtBlock: snapshot.indexedAtBlock.toString(),
    depositsIndexed: snapshot.deposits.length,
    driftDetected: Boolean(drift),
    driftFinding: drift ?? null,
    allFindings: findingsAfter
  }
});

console.log(
  drift
    ? "\nDRIFT DETECTED — exit criterion met."
    : "\nNO DRIFT FINDING — exit criterion NOT met. Investigate before proceeding."
);
process.exit(drift ? 0 : 1);
