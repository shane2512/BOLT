/**
 * Phase 3 — live split-on-receipt run.
 *
 * What is genuinely live here:
 *   - a real USDC deposit on Arc testnet, sent from the deployer EOA to the
 *     business's OPERATING account (standing in for "a buyer pays")
 *   - a real Privy session signer: a key quorum added as an additional signer on
 *     the OPERATING wallet, with its own override policy limiting it to this
 *     business's own accounts (FR-3.3)
 *   - real enclave refusals when that signer aims outside the business
 *   - real signatures, self-broadcast to Arc, for the splits themselves
 *   - real `DepositObserved` / `SplitExecuted` / `ObligationAccrued` events on
 *     `BoltRegistry`, each verified by re-reading the receipt from the RPC
 *   - real svix signature verification of the webhook, through
 *     `privy.webhooks().verify`
 *
 * What is simulated, and why:
 *   - **webhook delivery.** This environment has no public URL, so Privy cannot
 *     call us. The payload is built to the documented `wallet.funds_deposited`
 *     shape for the real deposit transaction, signed with a real svix HMAC, and
 *     POSTed over the loopback interface to the same `handleDepositWebhook` the
 *     Next route calls. The signature check, the schema check, the idempotency
 *     and the split are all the production code paths.
 *   - **Postgres.** Direct Postgres is unreachable from this sandbox, so the run
 *     uses PGlite (in-memory WASM Postgres) against the identical Drizzle
 *     schema, including the `deposits_tx_log_idx` unique index that does the
 *     idempotency work. Production targets `DATABASE_URL`.
 *
 * Resumable — state in docs/evidence/phase3-state.json. Run:
 *   pnpm --filter @bolt/privy phase3:split
 */
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  type Hex
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  accounts as accountsTable,
  alerts,
  businesses,
  deposits as depositsTable,
  policyRefusals,
  splits as splitsTable,
  type BoltDb
} from "@bolt/db";
import {
  BOLT_REGISTRY_ABI,
  arcTestnet,
  businessIdOf,
  bytes32Of,
  createRegistryWriter,
  policyHashOf,
  quorumRefOf
} from "@bolt/core";
import {
  BOLT_ERC20_ABI,
  buildSplitterSignerPolicy,
  handleDepositWebhook,
  loadAccounts,
  publishMandate,
  rawErrorBody,
  recordPolicyRefusal,
  type SplitterAccount,
  type SplitterConfig
} from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
const STATE_FILE = join(EVIDENCE, "phase3-state.json");
const ENV_FILE = join(REPO, ".env");

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
const SLUG = "acme-marketplace";
const DEPOSIT_AMOUNT = 10_000_000n; // 10.00 USDC

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), jsonify(body) + "\n");
  console.log(`   -> docs/evidence/${name}.json`);
}

/** Appends a generated value to .env so a re-run reuses it. .env is gitignored. */
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
    return { publicKey: key.export({ format: "der", type: "spki" }).toString("base64"), hasPrivate: false };
  }
}

// ---------------------------------------------------------------------------

type Phase2State = {
  provisioned: {
    slug: string;
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

const phase2 = JSON.parse(
  readFileSync(join(EVIDENCE, "phase2-state.json"), "utf8")
) as Phase2State;
const business = phase2.provisioned;
const operating = business.accounts.find((a) => a.accountClass === "OPERATING")!;
const clientMoney = business.accounts.find((a) => a.accountClass === "CLIENT_MONEY")!;
const reserve = business.accounts.find((a) => a.accountClass === "OBLIGATION_RESERVE")!;

type State = {
  splitterPublicKey?: string;
  splitterKeyQuorumId?: string;
  splitterPolicyId?: string;
  fundingTxHash?: string;
};
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State)
  : {};
const saveState = (): void => writeFileSync(STATE_FILE, jsonify(state) + "\n");

const auth = resolveAuthKey(need("PRIVY_AUTHORIZATION_KEY"));
if (!auth.hasPrivate) {
  throw new Error("PRIVY_AUTHORIZATION_KEY holds only the public half — cannot authorize.");
}
const ownerContext = { authorization_private_keys: [need("PRIVY_AUTHORIZATION_KEY")] };

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});

console.log(`business    : ${business.name} (${business.organizationId})`);
console.log(`operating   : ${operating.address} wallet=${operating.walletId}`);
console.log(`client money: ${clientMoney.address}`);
console.log(`reserve     : ${reserve.address}`);

// ---------------------------------------------------------------------------
// 1. The splitter's session signer and its own policy (FR-3.3)
// ---------------------------------------------------------------------------

if (!process.env.PRIVY_SPLITTER_AUTHORIZATION_KEY) {
  console.log("\ngenerating the splitter's authorization keypair ...");
  const { privateKey, publicKey } = await generateP256KeyPair();
  persistEnv("PRIVY_SPLITTER_AUTHORIZATION_KEY", privateKey);
  state.splitterPublicKey = publicKey;
  saveState();
}
const SPLITTER_KEY = need("PRIVY_SPLITTER_AUTHORIZATION_KEY");
const splitterPublicKey =
  state.splitterPublicKey ?? resolveAuthKey(SPLITTER_KEY).publicKey;

if (!state.splitterKeyQuorumId) {
  // `additional_signers[].signer_id` is a key quorum id
  // (privy-docs /api-reference/wallets/update.mdx), so the splitter's key is
  // registered as a one-key quorum.
  const quorum = await privy.keyQuorums().create({
    display_name: `${business.name} — splitter signer`,
    public_keys: [splitterPublicKey],
    authorization_threshold: 1
  });
  state.splitterKeyQuorumId = quorum.id;
  saveState();
  console.log(`splitter key quorum: ${quorum.id}`);
}

const splitterPolicyBody = buildSplitterSignerPolicy({
  businessName: business.name,
  ownAccountAddresses: business.accounts.map((a) => a.address),
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  ownerKeyQuorumId: business.keyQuorumId
});

if (!state.splitterPolicyId) {
  const policy = await privy.policies().create(splitterPolicyBody);
  state.splitterPolicyId = policy.id;
  saveState();
  console.log(`splitter policy: ${policy.id}`);
}

// Attach the signer. The wallet's owner is the organization's default key
// quorum, so the update carries the owner's authorization signature.
console.log("\nattaching the splitter as an additional signer on the OPERATING wallet ...");
await privy.wallets().update(operating.walletId, {
  additional_signers: [
    { signer_id: state.splitterKeyQuorumId!, override_policy_ids: [state.splitterPolicyId!] }
  ],
  authorization_context: ownerContext
} as never);

const walletAfter = (await privy.wallets().get(operating.walletId)) as unknown as {
  policy_ids?: string[];
  owner_id?: string;
  additional_signers?: { signer_id: string; override_policy_ids?: string[] }[];
};
writeEvidence("phase3-splitter-signer", {
  note:
    "FR-3.3. The splitter is an additional signer on the OPERATING wallet with " +
    "its own override policy. Privy evaluates only this signer's policy when it " +
    "signs, so the splitter's entire reach is the address set below.",
  wallet_id: operating.walletId,
  wallet_address: operating.address,
  wallet_owner_key_quorum: walletAfter.owner_id ?? null,
  wallet_policy_ids: walletAfter.policy_ids ?? [],
  additional_signers: walletAfter.additional_signers ?? [],
  splitter_key_quorum_id: state.splitterKeyQuorumId,
  splitter_policy_id: state.splitterPolicyId,
  splitter_policy_hash: policyHashOf(splitterPolicyBody),
  splitter_policy: splitterPolicyBody,
  permitted_destinations: business.accounts.map((a) => ({
    class: a.accountClass,
    address: a.address
  }))
});

// ---------------------------------------------------------------------------
// 2. Fund the OPERATING account — "a buyer pays" (real, on Arc)
// ---------------------------------------------------------------------------

const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const deployer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
const deployerWallet = createWalletClient({ chain: arcTestnet, transport, account: deployer });

const balanceOf = async (address: string): Promise<bigint> =>
  (await publicClient.readContract({
    address: getAddress(USDC),
    abi: BOLT_ERC20_ABI,
    functionName: "balanceOf",
    args: [getAddress(address)]
  })) as bigint;

const balancesBefore = {
  operating: await balanceOf(operating.address),
  client_money: await balanceOf(clientMoney.address),
  reserve: await balanceOf(reserve.address)
};
console.log(`\nbalances before: ${jsonify(balancesBefore)}`);

if (!state.fundingTxHash) {
  console.log(`funding OPERATING with ${DEPOSIT_AMOUNT} USDC base units from the deployer EOA ...`);
  const hash = await deployerWallet.writeContract({
    address: getAddress(USDC),
    abi: BOLT_ERC20_ABI,
    functionName: "transfer",
    args: [getAddress(operating.address), DEPOSIT_AMOUNT]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`funding transfer failed: ${hash}`);
  state.fundingTxHash = hash;
  saveState();
  console.log(`   deposit tx: ${hash}`);
}
const DEPOSIT_TX = state.fundingTxHash!;
const depositReceipt = await publicClient.getTransactionReceipt({ hash: DEPOSIT_TX as Hex });

// ---------------------------------------------------------------------------
// 3. Postgres (PGlite) with the real schema, the business, and a mandate
// ---------------------------------------------------------------------------

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
const accountIdByAddress = new Map(accountRows.map((r) => [r.address, r.id]));

// FR-3.5, first assertion — at write time. A mandate that does not sum to
// exactly 10000 never reaches the database.
console.log("\npublishing mandate v1 (88% client money · 4% tax reserve · 8% operating) ...");
let badMandateError: unknown = null;
try {
  await publishMandate(db, {
    businessId,
    version: 99,
    rulesHash: bytes32Of("bad"),
    quorumRef: quorumRefOf(business.keyQuorumId),
    rules: [
      { destinationAccountId: accountIdByAddress.get(clientMoney.address)!, bps: 8800, description: "88% seller" },
      { destinationAccountId: accountIdByAddress.get(reserve.address)!, bps: 400, description: "4% sales tax" },
      { destinationAccountId: accountIdByAddress.get(operating.address)!, bps: 799, description: "7.99% operating" }
    ]
  });
} catch (e) {
  badMandateError = e;
  console.log(`   rejected a 9999-bps mandate at write time: ${(e as Error).message}`);
}
const mandateRulesInput = [
  { destinationAccountId: accountIdByAddress.get(clientMoney.address)!, bps: 8800, description: "88% to the seller (client money)" },
  { destinationAccountId: accountIdByAddress.get(reserve.address)!, bps: 400, description: "4% sales tax (obligation reserve)" },
  { destinationAccountId: accountIdByAddress.get(operating.address)!, bps: 800, description: "8% retained (operating)" }
];
const mandate = await publishMandate(db, {
  businessId,
  version: 1,
  rulesHash: bytes32Of(JSON.stringify(mandateRulesInput)),
  quorumRef: quorumRefOf(business.keyQuorumId),
  rules: mandateRulesInput
});
console.log(`   mandate v${mandate.version} published`);

writeEvidence("phase3-mandate", {
  note:
    "FR-3.5, write-time assertion. The first mandate below sums to 9999 bps and " +
    "was refused before any row was written; the second sums to exactly 10000 " +
    "and was published as version 1. Postgres here is PGlite (in-memory WASM " +
    "Postgres) on the identical Drizzle schema — direct Postgres is unreachable " +
    "from this environment. Production targets DATABASE_URL.",
  rejected: {
    bps: [8800, 400, 799],
    sum: 9999,
    error: badMandateError ? (badMandateError as Error).message : "NOT REJECTED — FR-3.5 BROKEN"
  },
  published: {
    version: mandate.version,
    rules: mandateRulesInput.map((r) => ({ description: r.description, bps: r.bps })),
    sum: mandateRulesInput.reduce((s, r) => s + r.bps, 0)
  }
});

// ---------------------------------------------------------------------------
// 4. The splitter's box, attacked (FR-3.3)
// ---------------------------------------------------------------------------

const registry = createRegistryWriter({
  registryAddress: REGISTRY,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
  rpcUrl: RPC_URL
});

const outsider = privateKeyToAccount(generatePrivateKey()).address;
const fees = await publicClient.estimateFeesPerGas();
const splitterNonce = await publicClient.getTransactionCount({
  address: getAddress(operating.address),
  blockTag: "pending"
});

const splitterTx = (to: string) => ({
  from: getAddress(operating.address),
  to: getAddress(USDC),
  value: "0x0",
  chain_id: CHAIN_ID,
  nonce: splitterNonce,
  type: 2,
  gas_limit: 300_000,
  max_fee_per_gas: `0x${fees.maxFeePerGas.toString(16)}`,
  max_priority_fee_per_gas: `0x${(fees.maxPriorityFeePerGas ?? 0n).toString(16)}`,
  data: encodeFunctionData({
    abi: BOLT_ERC20_ABI,
    functionName: "transfer",
    args: [getAddress(to), 100_000n]
  })
});

console.log(`\nsplitter aims OUTSIDE the business (${outsider}) ...`);
const attempted = {
  signer: "splitter session signer",
  signer_key_quorum_id: state.splitterKeyQuorumId,
  override_policy_id: state.splitterPolicyId,
  wallet_id: operating.walletId,
  method: "eth_signTransaction",
  transaction: splitterTx(outsider)
};
let splitterRefusal: unknown = null;
try {
  const signed = await privy
    .wallets()
    .ethereum()
    .signTransaction(operating.walletId, {
      params: { transaction: splitterTx(outsider) },
      authorization_context: { authorization_private_keys: [SPLITTER_KEY] }
    } as never);
  console.log("   SIGNED — the splitter's box did NOT hold");
  writeEvidence("phase3-splitter-refusal", {
    expect: "REFUSE",
    outcome: "ALLOWED — FR-3.3 BROKEN",
    attempted,
    response: signed
  });
} catch (e) {
  splitterRefusal = e;
  console.log("   REFUSED");
  const refusalId = await recordPolicyRefusal(db, {
    businessId,
    accountId: accountIdByAddress.get(operating.address)!,
    attemptedAction: attempted,
    error: e
  });
  const [row] = await db.select().from(policyRefusals).where(eq(policyRefusals.id, refusalId));
  writeEvidence("phase3-splitter-refusal", {
    expect: "REFUSE",
    outcome: "REFUSED",
    note:
      "A compromised splitter cannot pay an outsider (FR-3.3). The request was " +
      "signed by the splitter's own authorization key, which is a valid " +
      "additional signer on this wallet — so it got past the API gate and was " +
      "refused by the enclave evaluating the splitter's override policy. No " +
      "application-layer destination check ran. The body below is what came back " +
      "OUT of the policy_refusals jsonb column (PGlite), not what went in.",
    attempted,
    db_row_id: refusalId,
    raw_error_read_back_from_postgres: row?.rawError
  });
}

// Positive control: the same signer, aimed at one of the business's own
// accounts. Without this the refusal above could just mean the signer is broken.
console.log(`splitter aims INSIDE the business (${clientMoney.address}) ...`);
let splitterPermitted = false;
try {
  await privy
    .wallets()
    .ethereum()
    .signTransaction(operating.walletId, {
      params: { transaction: splitterTx(clientMoney.address) },
      authorization_context: { authorization_private_keys: [SPLITTER_KEY] }
    } as never);
  splitterPermitted = true;
  console.log("   SIGNED (as expected)");
} catch (e) {
  console.log(`   REFUSED — the splitter cannot do its job: ${(e as Error).message}`);
  writeEvidence("phase3-splitter-control", {
    expect: "ALLOW",
    outcome: "REFUSED",
    attempted: splitterTx(clientMoney.address),
    error: rawErrorBody(e)
  });
}
if (splitterPermitted) {
  writeEvidence("phase3-splitter-control", {
    expect: "ALLOW",
    outcome: "ALLOWED",
    note:
      "Byte-identical to the refused request above except for the decoded " +
      "recipient. This is the control that makes the refusal mean something. " +
      "Signature only — not broadcast; the real transfers happen in the split.",
    destination: clientMoney.address
  });
}

// ---------------------------------------------------------------------------
// 5. The webhook — real signature, simulated delivery
// ---------------------------------------------------------------------------

if (!process.env.PRIVY_WEBHOOK_SECRET) {
  // No public URL means no endpoint could be registered in the Privy Dashboard,
  // so there is no Privy-issued signing key to use. This is a real svix-format
  // key; the verification below is Privy's own `webhooks().verify`, running the
  // real svix HMAC check against it.
  persistEnv("PRIVY_WEBHOOK_SECRET", `whsec_${randomBytes(24).toString("base64")}`);
}
const WEBHOOK_SECRET = need("PRIVY_WEBHOOK_SECRET");

const privyWithWebhooks = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET"),
  webhookSigningSecret: WEBHOOK_SECRET
});

/** svix signature scheme: base64 HMAC-SHA256 over `${id}.${timestamp}.${body}`. */
function svixHeaders(body: string, id = `msg_${randomBytes(8).toString("hex")}`) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(WEBHOOK_SECRET.split("_")[1]!, "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

const splitterCfg: SplitterConfig = {
  sourceWalletId: operating.walletId,
  sourceAddress: operating.address,
  splitterAuthorizationKey: SPLITTER_KEY,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  onChainBusinessId: businessIdOf(SLUG),
  beneficiaryRefFor: (a: SplitterAccount) => bytes32Of(a.label)
};

const deps = {
  privy: privyWithWebhooks,
  db,
  registry,
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  async resolveTarget(payload: { recipient: string }) {
    const accountsById = await loadAccounts(db, businessId);
    const account = [...accountsById.values()].find(
      (a) => a.address.toLowerCase() === payload.recipient.toLowerCase()
    );
    if (!account) return null;
    return {
      businessId,
      onChainBusinessId: businessIdOf(SLUG),
      account,
      accountsById,
      cfg: splitterCfg
    };
  }
};

// The same handler the Next route calls, behind a loopback HTTP server so the
// delivery really is an HTTP POST with svix headers.
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void handleDepositWebhook(deps as never, {
      rawBody: raw,
      headers: {
        "svix-id": String(req.headers["svix-id"] ?? ""),
        "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
        "svix-signature": String(req.headers["svix-signature"] ?? "")
      }
    })
      .then((out) => {
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(jsonify(out.body));
      })
      .catch((e: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(jsonify({ error: String(e), raw: rawErrorBody(e) }));
      });
  });
});
await new Promise<void>((resolve) => server.listen(3999, "127.0.0.1", resolve));
const ENDPOINT = "http://127.0.0.1:3999/api/webhooks/privy";

const depositPayload = {
  type: "wallet.funds_deposited",
  wallet_id: operating.walletId,
  idempotency_key: `evt_${DEPOSIT_TX.slice(2, 18)}`,
  caip2: `eip155:${CHAIN_ID}`,
  asset: { type: "erc20", address: USDC },
  amount: DEPOSIT_AMOUNT.toString(),
  transaction_hash: DEPOSIT_TX,
  sender: deployer.address,
  recipient: operating.address,
  block: {
    number: Number(depositReceipt.blockNumber),
    timestamp: Math.floor(Date.now() / 1000)
  }
};
const body = JSON.stringify(depositPayload);

async function post(rawBody: string, headers: Record<string, string>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// 5a. A forged signature must be refused before the body is even parsed.
console.log("\nPOST with a tampered svix signature ...");
const tampered = await post(body, {
  ...svixHeaders(body),
  "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
});
console.log(`   ${tampered.status} ${JSON.stringify(tampered.body).slice(0, 90)}`);

// 5b. The real thing.
console.log("\nPOST the signed deposit webhook ...");
const startedAt = Date.now();
const first = await post(body, svixHeaders(body));
const elapsedMs = Date.now() - startedAt;
console.log(`   ${first.status} in ${elapsedMs}ms`);
console.log(`   ${jsonify(first.body)}`);

// 5c. Replay, byte-identical body, fresh svix id and timestamp — exactly what
//     Privy's at-least-once delivery does.
console.log("\nreplaying the identical payload ...");
const splitsAfterFirst = await db.select().from(splitsTable);
const replay = await post(body, svixHeaders(body));
const splitsAfterReplay = await db.select().from(splitsTable);
console.log(`   ${replay.status} ${jsonify(replay.body)}`);
console.log(
  `   split rows: ${splitsAfterFirst.length} before replay, ${splitsAfterReplay.length} after`
);

server.close();

// ---------------------------------------------------------------------------
// 6. Verify every registry event straight from the RPC
// ---------------------------------------------------------------------------

const depositRows = await db.select().from(depositsTable);
const splitRows = await db.select().from(splitsTable);

const allRegistryTxs =
  (first.body.registry as { event: string; account?: string; txHash: string }[]) ?? [];

console.log("\nverifying registry receipts via eth_getTransactionReceipt ...");
const verified: unknown[] = [];
for (const e of allRegistryTxs) {
  const receipt = await rawReceipt(e.txHash);
  const logs = (receipt.logs as { topics: [Hex, ...Hex[]]; data: Hex }[]).map((log) =>
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

const balancesAfter = {
  operating: await balanceOf(operating.address),
  client_money: await balanceOf(clientMoney.address),
  reserve: await balanceOf(reserve.address)
};
console.log(`\nbalances after: ${jsonify(balancesAfter)}`);

const alertRows = await db.select().from(alerts);

writeEvidence("phase3-registry-events", {
  registry: REGISTRY,
  business_id: businessIdOf(SLUG),
  rpc: RPC_URL,
  events: verified
});

writeEvidence("phase3-split", {
  note:
    "Live split-on-receipt. REAL: the deposit transaction on Arc, the Privy " +
    "session signer and its override policy, the enclave signatures, the " +
    "self-broadcast transfers, the BoltRegistry events, and the svix signature " +
    "verification through privy.webhooks().verify. SIMULATED: webhook DELIVERY " +
    "(no public URL exists for Privy to call, so the correctly-signed payload " +
    "was POSTed over loopback to the same handler the Next route calls) and the " +
    "Postgres DRIVER (PGlite, in-memory WASM Postgres, identical Drizzle schema " +
    "including the deposits_tx_log_idx unique index — direct Postgres is " +
    "unreachable from this environment).",
  deposit: {
    tx: DEPOSIT_TX,
    explorer: `https://testnet.arcscan.app/tx/${DEPOSIT_TX}`,
    from: deployer.address,
    to: operating.address,
    amount_base_units: DEPOSIT_AMOUNT.toString()
  },
  webhook: {
    endpoint_under_test: "apps/web/src/app/api/webhooks/privy/route.ts (via handleDepositWebhook)",
    signing_scheme: "svix v1 HMAC-SHA256, verified by privy.webhooks().verify",
    tampered_signature: { status: tampered.status, body: tampered.body },
    accepted: { status: first.status, body: first.body, elapsed_ms: elapsedMs },
    replay: {
      status: replay.status,
      body: replay.body,
      split_rows_before: splitsAfterFirst.length,
      split_rows_after: splitsAfterReplay.length,
      second_split_produced: splitsAfterReplay.length !== splitsAfterFirst.length
    }
  },
  deposits: depositRows.map((d) => ({
    txHash: d.txHash,
    logIndex: d.logIndex,
    amount: d.amount.toString(),
    mandateVersion: d.mandateVersion
  })),
  splits: splitRows.map((s) => ({
    accountId: s.accountId,
    amount: s.amount.toString(),
    txHash: s.txHash,
    explorer: s.txHash ? `https://testnet.arcscan.app/tx/${s.txHash}` : null
  })),
  balances: {
    before: Object.fromEntries(Object.entries(balancesBefore).map(([k, v]) => [k, v.toString()])),
    after: Object.fromEntries(Object.entries(balancesAfter).map(([k, v]) => [k, v.toString()]))
  },
  alerts: alertRows.map((a) => ({ severity: a.severity, kind: a.kind, message: a.message }))
});

writeEvidence("phase3-summary", {
  chain: { chain_id: CHAIN_ID, rpc: RPC_URL, usdc: USDC, registry: REGISTRY },
  exit_criteria: {
    deposit_splits_across_three_accounts_under_30s: {
      elapsed_ms: elapsedMs,
      under_30s: elapsedMs < 30_000,
      splits: splitRows.length
    },
    replay_produces_no_second_split:
      splitsAfterReplay.length === splitsAfterFirst.length && replay.body.duplicate === true,
    bad_ratios_rejected_at_write_time: badMandateError !== null,
    all_three_event_types_on_chain: {
      DepositObserved: verified.some(
        (v) => (v as { event: string; verified: boolean }).event === "DepositObserved" &&
          (v as { verified: boolean }).verified
      ),
      SplitExecuted: verified.some(
        (v) => (v as { event: string; verified: boolean }).event === "SplitExecuted" &&
          (v as { verified: boolean }).verified
      ),
      ObligationAccrued: verified.some(
        (v) => (v as { event: string; verified: boolean }).event === "ObligationAccrued" &&
          (v as { verified: boolean }).verified
      )
    },
    splitter_cannot_pay_an_outsider: splitterRefusal !== null,
    splitter_can_pay_own_accounts: splitterPermitted
  },
  splitter: {
    key_quorum_id: state.splitterKeyQuorumId,
    override_policy_id: state.splitterPolicyId,
    permitted_destinations: business.accounts.map((a) => a.address)
  },
  registry_events: verified.map((v) => {
    const e = v as { event: string; account?: string; txHash: string; verified: boolean };
    return { event: e.event, account: e.account, tx: e.txHash, verified: e.verified };
  })
});

console.log("\ndone.");
process.exit(0);
