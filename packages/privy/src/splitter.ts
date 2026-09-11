/**
 * Phase 3 — split on receipt.
 *
 * A buyer pays the business's OPERATING account. Privy delivers a signed
 * `wallet.funds_deposited` webhook. Within seconds the deposit is divided across
 * the business's accounts by its active mandate version, each move signed by a
 * session signer that cannot reach any address outside the business, and the
 * whole thing recorded on `BoltRegistry`.
 *
 * Three properties this file exists to hold:
 *
 *  - **Idempotent on `(txHash, logIndex)`** (FR-3.2). Enforced by a unique index
 *    in Postgres, not by a check-then-insert race in application code.
 *  - **The mandate version is fixed at receipt time** (FR-3.4) and stored on the
 *    deposit row, so a mandate published a second later cannot retroactively
 *    change how a deposit was divided.
 *  - **Fails loudly** (FR-3.8). A split that does not confirm leaves its `splits`
 *    row with a null `tx_hash` — visibly unallocated — and writes a SEVERE alert.
 *    Nothing is swallowed and nothing is retried into silence.
 *
 * There is no destination check anywhere in this file. The splitter builds the
 * transfer it believes is right and hands it to Privy; if it is wrong, the
 * enclave refuses to produce a signature (invariant 1).
 *
 * Worked from privy-docs:
 *   /api-reference/webhooks/overview.mdx — svix signing, `privy.webhooks().verify`
 *   /api-reference/webhooks/wallet/funds_deposited.mdx — payload fields
 *   /recipes/wallets/conditional-signer-policies.mdx — signing as an additional signer
 *   /recipes/using-stateful-policies.mdx — eth_signTransaction + self-broadcast
 */
import { z } from "zod";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  type Hex
} from "viem";
import type { PrivyClient } from "@privy-io/node";
import {
  arcTestnet,
  computeSplits,
  depositIdOf,
  obligationIdOf,
  usdc,
  validateMandateRules,
  type AccountClass,
  type MandateRule,
  type RegistryWriter,
  type Usdc
} from "@bolt/core";
import {
  accounts as accountsTable,
  alerts,
  deposits,
  mandateRules,
  mandates,
  obligations,
  splits,
  type BoltDb
} from "@bolt/db";
import { and, desc, eq } from "drizzle-orm";
import { BOLT_ERC20_ABI } from "./policy-builder.js";
import { recordPolicyRefusal } from "./refusals.js";

// ---------------------------------------------------------------------------
// The webhook payload (NFR-7 — every external payload is schema-validated)
// ---------------------------------------------------------------------------

/**
 * `wallet.funds_deposited`, per privy-docs
 * /api-reference/webhooks/wallet/funds_deposited.mdx. Only the fields BOLT reads
 * are declared; `passthrough` keeps the rest so the raw body stays inspectable.
 *
 * **Divergence from the plan, flagged per Rule 0:** the payload has NO log
 * index. It carries `transaction_hash`, `idempotency_key` and `block`, but not
 * the index of the ERC-20 `Transfer` log within the transaction. FR-3.2's key is
 * `(txHash, logIndex)`, so the index is resolved from the chain instead — see
 * `resolveDepositLog`. That is strictly better than trusting the webhook for it:
 * the amount we split is then the amount the chain says arrived.
 */
export const fundsDepositedSchema = z
  .object({
    type: z.literal("wallet.funds_deposited"),
    wallet_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    caip2: z.string().min(1),
    asset: z.object({ type: z.string() }).passthrough(),
    amount: z.string().regex(/^\d+$/),
    transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    sender: z.string(),
    recipient: z.string(),
    block: z.object({ number: z.number(), timestamp: z.number() }).passthrough()
  })
  .passthrough();

export type FundsDepositedPayload = z.infer<typeof fundsDepositedSchema>;

const ERC20_TRANSFER_EVENT = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false }
    ]
  }
] as const;

// ---------------------------------------------------------------------------
// Mandates (FR-3.4, FR-3.5)
// ---------------------------------------------------------------------------

export interface ActiveMandate {
  id: string;
  version: number;
  rules: MandateRule[];
}

/**
 * Writes a new mandate version. `validateMandateRules` runs here — this is the
 * write-time half of FR-3.5, and the reason a bad mandate never reaches a signer.
 */
export async function publishMandate(
  db: BoltDb,
  args: {
    businessId: string;
    version: number;
    rulesHash: string;
    /** Reference to the key quorum action that authorised publication (FR-4.2). */
    quorumRef: string;
    rules: readonly (MandateRule & { description: string })[];
  }
): Promise<ActiveMandate> {
  validateMandateRules(args.rules);

  const [mandate] = await db
    .insert(mandates)
    .values({
      businessId: args.businessId,
      version: args.version,
      rulesHash: args.rulesHash,
      quorumRef: args.quorumRef
    })
    .returning({ id: mandates.id, version: mandates.version });
  if (!mandate) throw new Error("publishMandate: insert returned no row");

  await db.insert(mandateRules).values(
    args.rules.map((r) => ({
      mandateId: mandate.id,
      description: r.description,
      destinationAccountId: r.destinationAccountId,
      bps: r.bps
    }))
  );

  return { id: mandate.id, version: mandate.version, rules: args.rules.map(stripDescription) };
}

const stripDescription = (r: MandateRule): MandateRule => ({
  destinationAccountId: r.destinationAccountId,
  bps: r.bps
});

/** The highest published version for a business — the one in force right now. */
export async function getActiveMandate(
  db: BoltDb,
  businessId: string
): Promise<ActiveMandate | null> {
  const [mandate] = await db
    .select({ id: mandates.id, version: mandates.version })
    .from(mandates)
    .where(eq(mandates.businessId, businessId))
    .orderBy(desc(mandates.version))
    .limit(1);
  if (!mandate) return null;

  const rules = await db
    .select({
      destinationAccountId: mandateRules.destinationAccountId,
      bps: mandateRules.bps
    })
    .from(mandateRules)
    .where(eq(mandateRules.mandateId, mandate.id));

  return { id: mandate.id, version: mandate.version, rules };
}

// ---------------------------------------------------------------------------
// Deposit intake (FR-3.2)
// ---------------------------------------------------------------------------

export interface DepositRecord {
  id: string;
  businessId: string;
  accountId: string;
  txHash: string;
  logIndex: number;
  amount: Usdc;
  mandateVersion: number;
}

/**
 * Inserts the deposit, or returns `{ deposit, isNew: false }` if this
 * `(txHash, logIndex)` has already been seen.
 *
 * The uniqueness is `deposits_tx_log_idx`, a unique index in Postgres — a
 * redelivery racing the original loses at the database, not at a
 * check-then-insert in our code that two concurrent handlers could both pass.
 * `onConflictDoNothing` returns no row when the conflict fires, which is how we
 * know it was a redelivery.
 */
export async function recordDeposit(
  db: BoltDb,
  args: Omit<DepositRecord, "id">
): Promise<{ deposit: DepositRecord; isNew: boolean }> {
  const inserted = await db
    .insert(deposits)
    .values({
      businessId: args.businessId,
      accountId: args.accountId,
      txHash: args.txHash,
      logIndex: args.logIndex,
      amount: args.amount,
      mandateVersion: args.mandateVersion // FR-3.4 — fixed at receipt time
    })
    .onConflictDoNothing({ target: [deposits.txHash, deposits.logIndex] })
    .returning({ id: deposits.id });

  if (inserted[0]) return { deposit: { ...args, id: inserted[0].id }, isNew: true };

  const [existing] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.txHash, args.txHash), eq(deposits.logIndex, args.logIndex)));
  if (!existing) throw new Error("recordDeposit: conflict fired but no existing row found");

  return {
    deposit: {
      id: existing.id,
      businessId: existing.businessId,
      accountId: existing.accountId,
      txHash: existing.txHash,
      logIndex: existing.logIndex,
      amount: usdc(existing.amount),
      mandateVersion: existing.mandateVersion
    },
    isNew: false
  };
}

/**
 * Finds the ERC-20 `Transfer` log inside the deposit transaction that actually
 * credited this account, and returns its index and value. The webhook says a
 * deposit happened; the chain says which log it was and how much (invariant 8).
 *
 * On Arc, USDC is also the native gas token, so a plain value send moves USDC
 * with no `Transfer` log at all. Those deposits key on `logIndex: -1` — one
 * native credit per transaction, so the pair is still unique — and fall back to
 * the webhook's amount, which is the only source there is for that shape.
 */
export async function resolveDepositLog(
  payload: FundsDepositedPayload,
  opts: { usdcAddress: string; rpcUrl?: string }
): Promise<{ logIndex: number; amount: Usdc }> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(opts.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  const receipt = await client.getTransactionReceipt({
    hash: payload.transaction_hash as Hex
  });

  const recipient = payload.recipient.toLowerCase();
  const usdcAddress = opts.usdcAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddress) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: ERC20_TRANSFER_EVENT,
        topics: log.topics,
        data: log.data
      });
    } catch {
      continue; // some other event on the token contract
    }
    if (decoded.eventName !== "Transfer") continue;
    if (decoded.args.to.toLowerCase() !== recipient) continue;
    return { logIndex: log.logIndex, amount: usdc(decoded.args.value) };
  }

  return { logIndex: -1, amount: usdc(BigInt(payload.amount)) };
}

// ---------------------------------------------------------------------------
// The split itself (FR-3.3, FR-3.6, FR-3.7, FR-3.8)
// ---------------------------------------------------------------------------

export interface SplitterAccount {
  id: string;
  address: string;
  accountClass: AccountClass;
  label: string;
}

export interface SplitterConfig {
  /** OPERATING wallet the deposit landed in, and the wallet splits leave from. */
  sourceWalletId: string;
  sourceAddress: string;
  /**
   * The splitter's own authorization private key. It is an additional signer on
   * the source wallet, boxed by `buildSplitterSignerPolicy`. It is NOT the
   * wallet owner's key and must never be swapped for one.
   */
  splitterAuthorizationKey: string;
  usdcAddress: string;
  chainId: number;
  rpcUrl?: string;
  /** bytes32 business id used by BoltRegistry events. */
  onChainBusinessId: Hex;
  /** Institution or beneficiary reference recorded with an accrued obligation. */
  beneficiaryRefFor: (account: SplitterAccount) => Hex;
}

export interface SplitOutcome {
  accountId: string;
  address: string;
  accountClass: AccountClass;
  amount: Usdc;
  /** Null when nothing had to move (the share stayed in the source account). */
  txHash: string | null;
  moved: boolean;
  ok: boolean;
  error?: unknown;
}

export interface SplitResult {
  depositId: string;
  onChainDepositId: Hex;
  mandateVersion: number;
  splits: SplitOutcome[];
  registryTxs: { event: string; account?: string; txHash: string }[];
  unallocated: Usdc;
  durationMs: number;
}

/**
 * Executes the split for a deposit already recorded by `recordDeposit`.
 *
 * Every share is signed by the splitter's session signer and self-broadcast —
 * Phase 0 established that Privy will not broadcast on Arc, so the enclave signs
 * and viem sends. Policy evaluation still happens before the signature exists,
 * which is the only thing the product's claim depends on.
 *
 * A share whose destination is the source account itself does not move: it is
 * already where the mandate says it should be. It still emits `SplitExecuted`,
 * because the allocation is a fact about the deposit whether or not a transfer
 * was needed.
 */
export async function executeSplit(
  privy: PrivyClient,
  db: BoltDb,
  registry: RegistryWriter,
  cfg: SplitterConfig,
  deposit: DepositRecord,
  mandate: ActiveMandate,
  accountsById: Map<string, SplitterAccount>
): Promise<SplitResult> {
  const startedAt = Date.now();

  // FR-3.5, second assertion — on the signing path, not just at write time.
  const allocations = computeSplits(deposit.amount, mandate.rules);

  const onChainDepositId = depositIdOf(deposit.txHash, deposit.logIndex);
  const registryTxs: { event: string; account?: string; txHash: string }[] = [];

  const depositReceipt = await registry.recordDepositObserved({
    businessId: cfg.onChainBusinessId,
    depositId: onChainDepositId,
    amount: deposit.amount,
    mandateVersion: deposit.mandateVersion
  });
  registryTxs.push({ event: "DepositObserved", txHash: depositReceipt.transactionHash });

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(cfg.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  let nonce = await publicClient.getTransactionCount({
    address: getAddress(cfg.sourceAddress),
    blockTag: "pending"
  });
  const fees = await publicClient.estimateFeesPerGas();

  const outcomes: SplitOutcome[] = [];
  for (const allocation of allocations) {
    const account = accountsById.get(allocation.destinationAccountId);
    if (!account) {
      throw new Error(
        `executeSplit: mandate names account ${allocation.destinationAccountId}, ` +
          `which is not one of this business's accounts`
      );
    }

    const [splitRow] = await db
      .insert(splits)
      .values({ depositId: deposit.id, accountId: account.id, amount: allocation.amount })
      .returning({ id: splits.id });

    const isSource =
      account.address.toLowerCase() === cfg.sourceAddress.toLowerCase();

    if (isSource || allocation.amount === 0n) {
      outcomes.push({
        accountId: account.id,
        address: account.address,
        accountClass: account.accountClass,
        amount: allocation.amount,
        txHash: null,
        moved: false,
        ok: true
      });
      continue;
    }

    try {
      const txHash = await signAndBroadcastTransfer(privy, cfg, {
        to: account.address,
        amount: allocation.amount,
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n
      });
      nonce += 1;
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(`split transfer reverted on chain: ${txHash}`);
      }
      if (splitRow) {
        await db.update(splits).set({ txHash }).where(eq(splits.id, splitRow.id));
      }
      outcomes.push({
        accountId: account.id,
        address: account.address,
        accountClass: account.accountClass,
        amount: allocation.amount,
        txHash,
        moved: true,
        ok: true
      });
    } catch (error) {
      // FR-2.4 / FR-3.8. The error is stored exactly as Privy threw it, the
      // `splits` row keeps its null tx_hash so the money reads as unallocated,
      // and an alert is raised. Nothing is retried into silence.
      await recordPolicyRefusal(db, {
        businessId: deposit.businessId,
        accountId: account.id,
        attemptedAction: {
          splitter: true,
          wallet_id: cfg.sourceWalletId,
          to: account.address,
          amount: allocation.amount.toString(),
          deposit_id: deposit.id
        },
        error
      });
      outcomes.push({
        accountId: account.id,
        address: account.address,
        accountClass: account.accountClass,
        amount: allocation.amount,
        txHash: null,
        moved: false,
        ok: false,
        error
      });
    }
  }

  // Obligations accrue for money the business owes: client money and the
  // institutional reserve. The OPERATING share is the business's own — nothing
  // is owed on it, so nothing accrues.
  for (const outcome of outcomes) {
    if (!outcome.ok || outcome.amount === 0n) continue;
    if (outcome.accountClass === "OPERATING") continue;
    const account = accountsById.get(outcome.accountId)!;
    const receipt = await registry.recordObligationAccrued({
      businessId: cfg.onChainBusinessId,
      obligationId: obligationIdOf(onChainDepositId, account.address),
      account: getAddress(account.address),
      beneficiaryRef: cfg.beneficiaryRefFor(account),
      amount: outcome.amount
    });
    registryTxs.push({
      event: "ObligationAccrued",
      account: account.address,
      txHash: receipt.transactionHash
    });
    await db.insert(obligations).values({
      businessId: deposit.businessId,
      accountId: account.id,
      amount: outcome.amount,
      status: "OUTSTANDING"
    });
  }

  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    const receipt = await registry.recordSplitExecuted({
      depositId: onChainDepositId,
      account: getAddress(outcome.address),
      amount: outcome.amount
    });
    registryTxs.push({
      event: "SplitExecuted",
      account: outcome.address,
      txHash: receipt.transactionHash
    });
  }

  const unallocated = usdc(
    outcomes.filter((o) => !o.ok).reduce((sum, o) => sum + o.amount, 0n)
  );
  if (unallocated > 0n) {
    // FR-3.8 — fail loudly.
    await db.insert(alerts).values({
      businessId: deposit.businessId,
      severity: "SEVERE",
      kind: "SPLIT_FAILURE",
      message:
        `Deposit ${deposit.txHash}:${deposit.logIndex} split partially. ` +
        `${unallocated} USDC base units are unallocated and still sit in the ` +
        `operating account.`,
      evidence: {
        depositId: deposit.id,
        onChainDepositId,
        txHash: deposit.txHash,
        logIndex: deposit.logIndex,
        mandateVersion: deposit.mandateVersion,
        failed: outcomes
          .filter((o) => !o.ok)
          .map((o) => ({ address: o.address, amount: o.amount.toString() }))
      }
    });
  }

  return {
    depositId: deposit.id,
    onChainDepositId,
    mandateVersion: deposit.mandateVersion,
    splits: outcomes,
    registryTxs,
    unallocated,
    durationMs: Date.now() - startedAt
  };
}

/**
 * Signs one USDC transfer with the splitter's session signer and broadcasts it
 * ourselves. There is deliberately no check on `args.to` here — if the splitter
 * has been made to aim at an outsider, the refusal must come from the enclave.
 */
async function signAndBroadcastTransfer(
  privy: PrivyClient,
  cfg: SplitterConfig,
  args: {
    to: string;
    amount: bigint;
    nonce: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }
): Promise<Hex> {
  const transaction = {
    from: getAddress(cfg.sourceAddress),
    to: getAddress(cfg.usdcAddress),
    value: "0x0",
    chain_id: cfg.chainId,
    nonce: args.nonce,
    type: 2,
    gas_limit: 300_000,
    max_fee_per_gas: `0x${args.maxFeePerGas.toString(16)}`,
    max_priority_fee_per_gas: `0x${args.maxPriorityFeePerGas.toString(16)}`,
    data: encodeFunctionData({
      abi: BOLT_ERC20_ABI,
      functionName: "transfer",
      args: [getAddress(args.to), args.amount]
    })
  };

  const response = (await privy
    .wallets()
    .ethereum()
    .signTransaction(cfg.sourceWalletId, {
      params: { transaction },
      // The splitter's key, not the wallet owner's. Privy evaluates only this
      // signer's override policy (privy-docs conditional-signer-policies).
      authorization_context: {
        authorization_private_keys: [cfg.splitterAuthorizationKey]
      }
    } as never)) as { signed_transaction?: string; data?: { signed_transaction?: string } };

  const signed = response.signed_transaction ?? response.data?.signed_transaction;
  if (!signed) {
    throw new Error(`splitter: no signed_transaction in response: ${JSON.stringify(response)}`);
  }

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(cfg.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  return client.sendRawTransaction({ serializedTransaction: signed as Hex });
}

// ---------------------------------------------------------------------------
// The webhook handler (FR-3.1, FR-3.2)
// ---------------------------------------------------------------------------

export interface WebhookDeps {
  privy: PrivyClient;
  db: BoltDb;
  registry: RegistryWriter;
  usdcAddress: string;
  chainId: number;
  rpcUrl?: string;
  /**
   * Resolves the wallet the deposit landed in to a BOLT business. Returns null
   * for a wallet BOLT does not manage — a `user.wallet_created` webhook for some
   * other app feature must not be treated as a deposit.
   */
  resolveTarget: (payload: FundsDepositedPayload) => Promise<{
    businessId: string;
    onChainBusinessId: Hex;
    account: SplitterAccount;
    cfg: SplitterConfig;
    accountsById: Map<string, SplitterAccount>;
  } | null>;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The whole handler, free of any web framework so it can be driven from a Next
 * route, a test, or the Phase 3 evidence harness without three copies drifting.
 *
 * Order is deliberate: verify the signature first (an unverified body is not
 * data, it is an attacker's suggestion), then insert the deposit, and only split
 * if the insert was new. A redelivery returns 200 — Privy retries anything that
 * is not 2xx, and a duplicate is not an error.
 */
export async function handleDepositWebhook(
  deps: WebhookDeps,
  request: {
    rawBody: string;
    headers: { "svix-id": string; "svix-timestamp": string; "svix-signature": string };
  }
): Promise<WebhookResponse> {
  let verified: unknown;
  try {
    verified = deps.privy.webhooks().verify({
      payload: request.rawBody,
      headers: request.headers
    });
  } catch (error) {
    // Signature failure. Never parse the body, never act on it.
    return {
      status: 401,
      body: { error: "invalid webhook signature", detail: String(error) }
    };
  }

  const parsed = fundsDepositedSchema.safeParse(verified);
  if (!parsed.success) {
    // A different, legitimately signed Privy event. Acknowledge so Privy stops
    // retrying; there is nothing here for the splitter to do.
    return { status: 200, body: { ignored: true, reason: "not a funds_deposited event" } };
  }
  const payload = parsed.data;

  const target = await deps.resolveTarget(payload);
  if (!target) {
    return { status: 200, body: { ignored: true, reason: "wallet is not a BOLT account" } };
  }

  const mandate = await getActiveMandate(deps.db, target.businessId);
  if (!mandate) {
    await deps.db.insert(alerts).values({
      businessId: target.businessId,
      severity: "SEVERE",
      kind: "SPLIT_FAILURE",
      message:
        `Deposit ${payload.transaction_hash} arrived with no published mandate. ` +
        `The full amount is unallocated.`,
      evidence: { txHash: payload.transaction_hash, amount: payload.amount }
    });
    return { status: 200, body: { ignored: true, reason: "no active mandate" } };
  }

  const { logIndex, amount } = await resolveDepositLog(payload, {
    usdcAddress: deps.usdcAddress,
    rpcUrl: deps.rpcUrl
  });

  const { deposit, isNew } = await recordDeposit(deps.db, {
    businessId: target.businessId,
    accountId: target.account.id,
    txHash: payload.transaction_hash.toLowerCase(),
    logIndex,
    amount,
    mandateVersion: mandate.version
  });

  if (!isNew) {
    // FR-3.2. The identical webhook, replayed, does nothing.
    return {
      status: 200,
      body: { duplicate: true, depositId: deposit.id, splitsExecuted: 0 }
    };
  }

  const result = await executeSplit(
    deps.privy,
    deps.db,
    deps.registry,
    target.cfg,
    deposit,
    mandate,
    target.accountsById
  );

  return {
    status: 200,
    body: {
      depositId: result.depositId,
      mandateVersion: result.mandateVersion,
      splits: result.splits.map((s) => ({
        address: s.address,
        amount: s.amount.toString(),
        txHash: s.txHash,
        ok: s.ok
      })),
      unallocated: result.unallocated.toString(),
      // The BoltRegistry writes, so an operator (or the Phase 3 evidence run)
      // can verify each one straight from the RPC rather than trusting us.
      registry: result.registryTxs,
      durationMs: result.durationMs
    }
  };
}

/** Loads a business's accounts into the shape the splitter wants. */
export async function loadAccounts(
  db: BoltDb,
  businessId: string
): Promise<Map<string, SplitterAccount>> {
  const rows = await db
    .select({
      id: accountsTable.id,
      address: accountsTable.address,
      accountClass: accountsTable.class,
      label: accountsTable.label
    })
    .from(accountsTable)
    .where(eq(accountsTable.businessId, businessId));
  return new Map(rows.map((r) => [r.id, r]));
}
