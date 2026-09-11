/**
 * Phase 6 — the unlock ceremony (FR-5).
 *
 * The only sanctioned early exit from a locked account, and the one place in
 * BOLT where every gate is visible at once:
 *
 *   WHERE     the Privy policy already on the account. An unlock is a
 *             policy-*permitted* release, not an exception to the policy: the
 *             destination must already be a payee that policy allows, and the
 *             calldata is still decoded and checked (invariant 2). Nothing here
 *             widens anything.
 *   WHO       a World Selfie Check per approver, before their approval counts
 *             (FR-5.3). Not our judgement of who is human — World's.
 *   HOW MANY  a 3-of-5 Privy key quorum. Privy's TEE counts the signatures and
 *             refuses below the threshold (FR-5.2, FR-5.7). Nothing in this file
 *             counts to three.
 *   WHEN      `BoltUnlockTimer`'s 24-hour delay (FR-5.4), armed at the final
 *             approval and released on chain before anything is broadcast.
 *
 * Worked from privy-docs:
 *   /transaction-management/intents/create/execute-rpc.mdx      — intents().rpc(walletId, rpcRequest)
 *   /transaction-management/intents/lifecycle.mdx               — intent statuses
 *   /transaction-management/intents/fetch-intent.mdx            — request_details {method, url, body}
 *   /transaction-management/intents/sign-intents.mdx            — POST /v1/intents/{id}/authorize
 *   /controls/key-quorum/sign.mdx                               — m-of-n signing, comma-delimited
 *                                                                 `privy-authorization-signature`
 *   /controls/authorization-keys/using-owners/sign/overview.mdx — the version-1 signature payload
 *   /api-reference/authorization-signatures.mdx                 — required headers
 * and world-docs via `verifySelfieCheck` in @bolt/core (see packages/core/src/world.ts).
 *
 * ---------------------------------------------------------------------------
 * DIVERGENCE FROM THE PLAN — flagged per Rule 0, because it changes how
 * approvals are collected.
 *
 * The plan was to collect all five approvals as signatures on a Privy *intent*.
 * Two things got in the way, both verified live against Privy's API rather than
 * assumed:
 *
 *  1. `@privy-io/node@0.34.0` has no `intents().authorize()`. The Node `Intents`
 *     resource exposes `list/get/reject/rpc/transfer/update*` and nothing else;
 *     the docs' `authorize` example is Java-only. So the endpoint has to be
 *     called over raw HTTP.
 *  2. `POST /v1/intents/{intent_id}/authorize` wants "an authorization signature
 *     over the intent's action", and the docs never say what bytes that is. The
 *     obvious reading — the version-1 payload built from the intent's own
 *     `request_details` — is rejected with
 *     `{"error":"No valid authorization key found for signature","code":"invalid_data"}`,
 *     as are ~20 other shapes (with/without `privy-request-expiry`, with the
 *     `chain_type` the SDK adds to the real request body, with the authorize
 *     URL, with the intent-creation URL, with the timestamp folded into the
 *     body). The same keys sign the same wallet successfully by the documented
 *     m-of-n route, so the keys and the signing helper are fine; the payload
 *     definition is the gap. See docs/evidence/phase6-intent-authorize-gap.json.
 *
 * So: the intent is still created and is still the proposal record — it holds
 * the exact transaction, it carries the quorum's threshold and per-member
 * signing state, and it is what a reviewer opens in Privy's dashboard. But the
 * signatures that actually authorize the unlock are collected per approver and
 * submitted together on the documented key-quorum route
 * (`privy-authorization-signature`, comma-delimited). That route is Privy's own
 * m-of-n enforcement either way: two signatures are refused with a 401 from
 * Privy, three produce a signature from the enclave. Nothing about the security
 * property changes; only which endpoint carries the signatures.
 * ---------------------------------------------------------------------------
 */
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  type Hex
} from "viem";
import type { PrivyClient } from "@privy-io/node";
import { generateAuthorizationSignature } from "@privy-io/node";
import {
  arcTestnet,
  humanProofRefOf,
  nullifierToDecimal,
  reasonHashOf,
  unlockIdOf,
  usdc,
  verifySelfieCheck,
  type RegistryWriter,
  type SelfieCheckConfig,
  type SelfieCheckVerification,
  type UnlockTimer,
  type Usdc
} from "@bolt/core";
import { unlockApprovals, unlockRequests, type BoltDb } from "@bolt/db";
import { asc, eq } from "drizzle-orm";
import { BOLT_ERC20_ABI } from "./policy-builder.js";

const PRIVY_API_URL = "https://api.privy.io";

// ---------------------------------------------------------------------------
// Intents — the proposal record
// ---------------------------------------------------------------------------

/** The subset of an intent BOLT reads. Everything else passes through. */
export interface IntentSnapshot {
  intent_id: string;
  status: string;
  resource_id?: string;
  request_details?: { method: "POST" | "PUT" | "PATCH" | "DELETE"; url: string; body: unknown };
  authorization_details?: {
    threshold: number;
    members: { type: string; signed_at: number | null; public_key?: string; user_id?: string }[];
  }[];
  action_result?: Record<string, unknown>;
}

/** The quorum threshold, read off the intent rather than configured locally. */
export function signatureThreshold(intent: IntentSnapshot): number {
  return intent.authorization_details?.[0]?.threshold ?? 0;
}

export function quorumMemberCount(intent: IntentSnapshot): number {
  return intent.authorization_details?.[0]?.members.length ?? 0;
}

// ---------------------------------------------------------------------------
// Quorum signatures
// ---------------------------------------------------------------------------

export interface PrivyRestConfig {
  appId: string;
  appSecret: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The exact request the quorum authorizes: `eth_signTransaction` on the locked
 * wallet. Built deterministically so five people signing at five different times
 * sign the same bytes — no request expiry, no idempotency key, nothing that
 * varies per signer.
 */
export interface QuorumSignedRequest {
  url: string;
  body: { method: "eth_signTransaction"; params: { transaction: unknown }; chain_type: "ethereum" };
  headers: { "privy-app-id": string };
}

export function unlockSignableRequest(
  cfg: PrivyRestConfig,
  walletId: string,
  transaction: unknown
): QuorumSignedRequest {
  return {
    url: `${cfg.apiUrl ?? PRIVY_API_URL}/v1/wallets/${walletId}/rpc`,
    body: { method: "eth_signTransaction", params: { transaction }, chain_type: "ethereum" },
    headers: { "privy-app-id": cfg.appId }
  };
}

/** One quorum member's authorization signature over that request. */
export function signUnlockRequest(
  request: QuorumSignedRequest,
  authorizationPrivateKey: string
): string {
  return generateAuthorizationSignature({
    authorizationPrivateKey,
    input: {
      version: 1,
      method: "POST",
      url: request.url,
      body: request.body,
      headers: request.headers
    }
  });
}

export class PrivyQuorumError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "PrivyQuorumError";
  }
}

/**
 * Sends the unlock to Privy with every signature collected so far.
 *
 * There is deliberately **no** check here that enough signatures were collected.
 * If two people approved, two signatures go to Privy and Privy refuses them —
 * that refusal is the product working (invariant 1). A count kept in this
 * function would be exactly the application-layer substitute CLAUDE.md forbids.
 */
export async function submitQuorumSignedUnlock(
  cfg: PrivyRestConfig,
  request: QuorumSignedRequest,
  signatures: readonly string[]
): Promise<Hex> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const response = await doFetch(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "privy-app-id": cfg.appId,
      "privy-authorization-signature": signatures.join(","),
      authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString("base64")}`
    },
    body: JSON.stringify(request.body)
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Verbatim, like every other refusal in this codebase.
    throw new PrivyQuorumError(
      `privy: refused the unlock (HTTP ${response.status}): ${JSON.stringify(body)}`,
      response.status,
      body
    );
  }

  const parsed = body as
    | { signed_transaction?: string; data?: { signed_transaction?: string } }
    | null;
  const signed = parsed?.signed_transaction ?? parsed?.data?.signed_transaction;
  if (!signed) {
    throw new PrivyQuorumError(
      `privy: no signed_transaction in response: ${JSON.stringify(body)}`,
      response.status,
      body
    );
  }
  return signed as Hex;
}

// ---------------------------------------------------------------------------
// The ceremony
// ---------------------------------------------------------------------------

export interface UnlockCeremonyConfig extends PrivyRestConfig {
  /** bytes32 business id used by BoltRegistry events. */
  onChainBusinessId: Hex;
  usdcAddress: string;
  chainId: number;
  rpcUrl?: string;
  /** World RP + action the approvers' Selfie Checks must be scoped to. */
  world: SelfieCheckConfig;
}

export interface UnlockRequestInput {
  businessId: string;
  accountId: string;
  /** The locked account the money leaves. */
  walletId: string;
  accountAddress: string;
  amount: Usdc;
  /**
   * Must already be a permitted payee under this account's policy. Not checked
   * here: if it is not, the enclave refuses to sign and the refusal is the
   * evidence (invariant 1).
   */
  destination: string;
  /** FR-5.1, free text. Only its keccak goes on chain. */
  reason: string;
}

export interface UnlockRequestRecord {
  id: string;
  unlockId: Hex;
  reasonHash: Hex;
  intentId: string;
  threshold: number;
  quorumSize: number;
  executableAtFloor: bigint;
  requestedTxHash: string;
  transaction: unknown;
}

/**
 * FR-5.1 / FR-5.2 — open the ceremony.
 *
 * Writes the workflow row, proposes the transfer as a Privy intent (so the
 * quorum's members can approve later, from five different phones, against a
 * proposal they can inspect), and records `UnlockRequested` on `BoltRegistry`.
 *
 * `executableAt` on the event is the *floor*: request time plus the delay read
 * off the deployed `BoltUnlockTimer`. It cannot be executable before then. The
 * authoritative value is set when the final approval arms the timer, and anyone
 * can read it from `BoltUnlockTimer.timers(unlockId)` — we do not get to restate
 * it.
 */
export async function requestUnlock(
  privy: PrivyClient,
  db: BoltDb,
  registry: RegistryWriter,
  timer: UnlockTimer,
  cfg: UnlockCeremonyConfig,
  input: UnlockRequestInput
): Promise<UnlockRequestRecord> {
  const reasonHash = reasonHashOf(input.reason);

  const [row] = await db
    .insert(unlockRequests)
    .values({
      businessId: input.businessId,
      accountId: input.accountId,
      amount: input.amount,
      destination: input.destination,
      reason: input.reason,
      reasonHash,
      status: "PENDING_APPROVAL"
    })
    .returning({ id: unlockRequests.id });
  if (!row) throw new Error("requestUnlock: insert returned no row");

  const unlockId = unlockIdOf(row.id);
  const transaction = await buildUnlockTransaction(cfg, input);

  // eth_signTransaction, not eth_sendTransaction: Phase 0 established Privy will
  // not broadcast on Arc, so the enclave signs and BOLT self-broadcasts — after
  // the timer releases.
  const intent = (await privy.intents().rpc(input.walletId, {
    method: "eth_signTransaction",
    params: { transaction }
  } as never)) as unknown as IntentSnapshot;

  const delay = await timer.delaySeconds();
  const executableAtFloor = BigInt(Math.floor(Date.now() / 1000)) + delay;

  await db
    .update(unlockRequests)
    .set({
      intentId: intent.intent_id,
      executableAt: new Date(Number(executableAtFloor) * 1000)
    })
    .where(eq(unlockRequests.id, row.id));

  const receipt = await registry.recordUnlockRequested({
    businessId: cfg.onChainBusinessId,
    unlockId,
    account: getAddress(input.accountAddress),
    amount: input.amount,
    destination: getAddress(input.destination),
    reasonHash,
    executableAt: executableAtFloor
  });

  return {
    id: row.id,
    unlockId,
    reasonHash,
    intentId: intent.intent_id,
    threshold: signatureThreshold(intent),
    quorumSize: quorumMemberCount(intent),
    executableAtFloor,
    requestedTxHash: receipt.transactionHash,
    transaction
  };
}

/** The USDC transfer the policy will be asked to permit. */
async function buildUnlockTransaction(
  cfg: UnlockCeremonyConfig,
  input: UnlockRequestInput
): Promise<Record<string, unknown>> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(cfg.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  const [nonce, fees] = await Promise.all([
    client.getTransactionCount({ address: getAddress(input.accountAddress), blockTag: "pending" }),
    client.estimateFeesPerGas()
  ]);

  return {
    from: getAddress(input.accountAddress),
    to: getAddress(cfg.usdcAddress),
    // Required by invariant 2: on Arc, USDC is also the native token, so a
    // transfer() call carrying native value would move twice what it says.
    value: "0x0",
    chain_id: cfg.chainId,
    nonce,
    type: 2,
    gas_limit: 300_000,
    max_fee_per_gas: `0x${fees.maxFeePerGas.toString(16)}`,
    max_priority_fee_per_gas: `0x${(fees.maxPriorityFeePerGas ?? 0n).toString(16)}`,
    data: encodeFunctionData({
      abi: BOLT_ERC20_ABI,
      functionName: "transfer",
      args: [getAddress(input.destination), input.amount]
    })
  };
}

/**
 * Rebuilds the exact request the quorum signs, from the intent Privy is holding
 * — not from a local copy that could have drifted from the proposal.
 */
export async function unlockRequestToSign(
  privy: PrivyClient,
  cfg: UnlockCeremonyConfig,
  intentId: string
): Promise<{ intent: IntentSnapshot; request: QuorumSignedRequest }> {
  const intent = (await privy.intents().get(intentId)) as unknown as IntentSnapshot;
  const body = intent.request_details?.body as { params?: { transaction?: unknown } } | undefined;
  const transaction = body?.params?.transaction;
  if (!intent.resource_id || transaction === undefined) {
    throw new Error(`unlockRequestToSign: intent ${intentId} has no proposed transaction`);
  }
  return { intent, request: unlockSignableRequest(cfg, intent.resource_id, transaction) };
}

export interface UnlockApprover {
  /** Stable id for the human — a Privy user id, or a label in a scripted run. */
  id: string;
  /** The address recorded in `UnlockApproved`. */
  address: string;
  /** This member's authorization private key (base64 PKCS8, no PEM headers). */
  authorizationPrivateKey: string;
}

export interface UnlockApprovalResult {
  approvalId: string;
  approver: string;
  world: SelfieCheckVerification;
  humanProofRef: Hex;
  approvals: number;
  threshold: number;
  approvedTxHash: string;
  /** Set on the approval that met the threshold and started the 24h clock. */
  armed: { txHash: string; executableAt: bigint } | null;
}

/**
 * FR-5.3 + FR-5.2 — one approval.
 *
 * The order is the requirement:
 *
 *   1. World verifies the Selfie Check. If it does not, nothing else runs and
 *      this approval does not exist — no signature is ever produced, so the
 *      quorum never sees it. That is what "does not count toward the quorum"
 *      means here; it is not a boolean we check and then ignore.
 *   2. The approval is written with the proof's nullifier under a unique index,
 *      so one human cannot fill three of the five slots.
 *   3. Only then is this member's authorization signature produced and stored.
 *   4. `UnlockApproved(unlockId, approver, humanProofRef)` goes on chain, with
 *      the World nullifier itself as the proof reference.
 *   5. If that reached the quorum's threshold, the on-chain 24-hour timer is
 *      armed. The threshold is the intent's, read from Privy.
 */
export async function approveUnlock(
  privy: PrivyClient,
  db: BoltDb,
  registry: RegistryWriter,
  timer: UnlockTimer,
  cfg: UnlockCeremonyConfig,
  args: {
    unlockRequestId: string;
    approver: UnlockApprover;
    /** The IDKit result, exactly as the widget returned it. Never reshaped. */
    idkitResult: unknown;
  }
): Promise<UnlockApprovalResult> {
  const [request] = await db
    .select()
    .from(unlockRequests)
    .where(eq(unlockRequests.id, args.unlockRequestId));
  if (!request) throw new Error(`approveUnlock: no unlock request ${args.unlockRequestId}`);
  if (!request.intentId) throw new Error("approveUnlock: unlock request has no intent");

  // 1. The World gate. Throws SelfieCheckError on anything short of a verified
  //    Selfie Check — a missing app, a wrong action, an Orb proof offered in its
  //    place, an invalid proof.
  const world = await verifySelfieCheck(cfg.world, args.idkitResult);
  const humanProofRef = humanProofRefOf(world.nullifier);

  const { intent, request: signable } = await unlockRequestToSign(privy, cfg, request.intentId);
  const threshold = signatureThreshold(intent);

  // 2 + 3. Anti-replay on a unique index in Postgres, not a read-then-write, and
  //        the signature stored with it.
  const [approval] = await db
    .insert(unlockApprovals)
    .values({
      unlockRequestId: request.id,
      approver: args.approver.id,
      humanProofRef,
      nullifier: nullifierToDecimal(world.nullifier),
      worldProof: world.raw as Record<string, unknown>,
      quorumSignature: signUnlockRequest(signable, args.approver.authorizationPrivateKey)
    })
    .returning({ id: unlockApprovals.id });
  if (!approval) throw new Error("approveUnlock: approval insert returned no row");

  const approvals = (
    await db.select().from(unlockApprovals).where(eq(unlockApprovals.unlockRequestId, request.id))
  ).length;

  // 4. On chain.
  const unlockId = unlockIdOf(request.id);
  const receipt = await registry.recordUnlockApproved({
    unlockId,
    approver: getAddress(args.approver.address),
    humanProofRef
  });

  // 5. The clock starts at the final approval, not at the request (FR-5.4).
  let armed: { txHash: string; executableAt: bigint } | null = null;
  if (threshold > 0 && approvals >= threshold) {
    const armReceipt = await timer.arm(unlockId);
    const state = await timer.state(unlockId);
    armed = { txHash: armReceipt.transactionHash, executableAt: state.executableAt };
    await db
      .update(unlockRequests)
      .set({ status: "APPROVED", executableAt: new Date(Number(state.executableAt) * 1000) })
      .where(eq(unlockRequests.id, request.id));
  }

  return {
    approvalId: approval.id,
    approver: args.approver.address,
    world,
    humanProofRef,
    approvals,
    threshold,
    approvedTxHash: receipt.transactionHash,
    armed
  };
}

export interface UnlockExecutionResult {
  unlockId: Hex;
  signaturesSubmitted: number;
  releaseTxHash: string;
  transferTxHash: string;
  executedTxHash: string;
  amount: Usdc;
}

/**
 * FR-5.4 + FR-5.5 + FR-5.7 — execute.
 *
 * Order, and why:
 *
 *   1. Every signature collected so far goes to Privy. Below the threshold Privy
 *      refuses with a 401 and the flow ends there — the refusal is the quorum's,
 *      not ours. We never count.
 *   2. `BoltUnlockTimer.release()` on Arc. Before the window it reverts against
 *      the deployed 24-hour constant, and nothing is broadcast.
 *   3. Only then is the signed transaction broadcast and `UnlockExecuted`
 *      recorded.
 *
 * Honest limitation, stated rather than papered over: the signature exists
 * between (1) and (2), so a compromised backend holding it could broadcast
 * without landing the timer transaction. The 24 hours are a published, immutable
 * on-chain commitment and a required step in this flow; they are not a
 * cryptographic impossibility, and we do not claim they are one.
 */
export async function executeUnlock(
  privy: PrivyClient,
  db: BoltDb,
  registry: RegistryWriter,
  timer: UnlockTimer,
  cfg: UnlockCeremonyConfig,
  unlockRequestId: string
): Promise<UnlockExecutionResult> {
  const [request] = await db
    .select()
    .from(unlockRequests)
    .where(eq(unlockRequests.id, unlockRequestId));
  if (!request) throw new Error(`executeUnlock: no unlock request ${unlockRequestId}`);
  if (!request.intentId) throw new Error("executeUnlock: unlock request has no intent");

  const unlockId = unlockIdOf(request.id);
  const { request: signable } = await unlockRequestToSign(privy, cfg, request.intentId);

  const approvals = await db
    .select()
    .from(unlockApprovals)
    .where(eq(unlockApprovals.unlockRequestId, request.id))
    .orderBy(asc(unlockApprovals.approvedAt));
  const signatures = approvals
    .map((a) => a.quorumSignature)
    .filter((s): s is string => Boolean(s));

  // 1. The quorum. Send what we have; let Privy decide whether it is enough.
  const signed = await submitQuorumSignedUnlock(cfg, signable, signatures);

  // 2. The timer, on chain.
  const release = await timer.release(unlockId);

  // 3. Broadcast.
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(cfg.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  const transferTxHash = await client.sendRawTransaction({ serializedTransaction: signed });
  const transferReceipt = await client.waitForTransactionReceipt({ hash: transferTxHash });
  if (transferReceipt.status !== "success") {
    throw new Error(`executeUnlock: unlock transfer reverted on chain: ${transferTxHash}`);
  }

  const amount = usdc(request.amount);
  const executed = await registry.recordUnlockExecuted({ unlockId, amount });
  await db
    .update(unlockRequests)
    .set({ status: "EXECUTED" })
    .where(eq(unlockRequests.id, request.id));

  return {
    unlockId,
    signaturesSubmitted: signatures.length,
    releaseTxHash: release.transactionHash,
    transferTxHash,
    executedTxHash: executed.transactionHash,
    amount
  };
}
