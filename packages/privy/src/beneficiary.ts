/**
 * Phase 8 — beneficiary payout (FR-8).
 *
 * The second of BOLT's two exits from a locked account, and the one a person
 * actually walks through. Every gate that guards it is visible in this file:
 *
 *   WHERE  the Privy policy already on the `CLIENT_MONEY` account. A payout is
 *          policy-*permitted* — the beneficiary's address is added to the
 *          allowlist through the key quorum first (FR-2.6, `permitBeneficiary`)
 *          and only then can the enclave sign a transfer to it. It is not an
 *          exception carved out for payouts, and nothing here checks a
 *          destination (invariant 1): a payout to an address the policy does not
 *          carry is refused by the enclave, and that refusal is the evidence.
 *   WHO    a World Selfie Check, verified server-side, before any signing
 *          happens. First claim is the *eligibility* signal (FR-8.6); an address
 *          change or an unrecognised device is the *continuity* signal and the
 *          anti-account-takeover control (FR-8.7). A repeat withdrawal to an
 *          address this beneficiary has already verified needs no fresh check
 *          (FR-8.8) — deliberately, because the signal is already established
 *          and Selfie Check is low-friction by design.
 *   PROOF  `ObligationSettled(obligationId, amount, txRef)` on `BoltRegistry`,
 *          where `txRef` is the Arc transaction hash of the transfer itself.
 *          Outstanding obligations fall and the coverage line moves because the
 *          subgraph indexed an event, not because we told it to (invariant 8).
 *
 * Worked from privy-docs:
 *   /recipes/pregenerate-wallets.mdx            — users().create({linked_accounts, wallets})
 *   /api-reference/users/pregenerate-wallets    — the same, for an existing user
 *   /basics/react/quickstart.mdx                — useLoginWithEmail (the login half,
 *                                                 in apps/web)
 *   /controls/policies/create-a-policy.mdx      — policies().createRule + owner quorum
 * and world-docs via `verifySelfieCheck` in @bolt/core (packages/core/src/world.ts).
 *
 * ---------------------------------------------------------------------------
 * DIVERGENCE FROM THE DOCS, flagged per Rule 0.
 *
 * `/recipes/pregenerate-wallets.mdx` shows `wallet_index` and
 * `create_direct_signer` on the NodeJS `users().create` call and
 * `create_smart_account` on the wallet. In `@privy-io/node@0.34.0`,
 * `UserCreateParams` has only `linked_accounts`, `custom_metadata` and
 * `wallets`, and `UserCreateParams.Wallet` has `chain_type`,
 * `additional_signers`, `create_smart_wallet` and `policy_ids` — no
 * `wallet_index`, no `create_direct_signer`, and the smart-wallet flag is spelled
 * differently. The REST shapes in the recipe are the ones that carry those
 * fields. We follow the SDK.
 * ---------------------------------------------------------------------------
 */
import { createPublicClient, encodeFunctionData, getAddress, http, type Hex } from "viem";
import type { PrivyClient } from "@privy-io/node";
import type { PolicyCreateParams } from "@privy-io/node/resources";
import {
  arcTestnet,
  humanProofRefOf,
  nullifierToDecimal,
  usdc,
  verifySelfieCheck,
  type RegistryWriter,
  type SelfieCheckConfig,
  type SelfieCheckVerification,
  type Usdc
} from "@bolt/core";
import {
  beneficiaries,
  beneficiaryVerifications,
  obligations,
  type BoltDb
} from "@bolt/db";
import { and, eq } from "drizzle-orm";
import { BOLT_ERC20_ABI, buildPayeeAllowRule, type TransferPolicySpec } from "./policy-builder.js";

// ---------------------------------------------------------------------------
// FR-8.1 — the pregenerated wallet
// ---------------------------------------------------------------------------

export interface PregeneratedBeneficiary {
  /** `did:privy:...`. The handle the email login resolves to later. */
  privyUserId: string;
  email: string;
  address: string;
  /** True when this email already had a Privy user and we reused it. */
  reused: boolean;
}

/**
 * Creates a Privy user bound to `email` with an embedded Ethereum wallet, before
 * that person has ever signed in (FR-8.1). The address exists — and can be paid
 * — from this moment; when they eventually log in with the same email, Privy
 * hands them the same wallet.
 *
 * No policy is attached. This is the beneficiary's own money once it arrives;
 * BOLT locks the account money *leaves*, never the one it lands in.
 */
export async function pregenerateBeneficiaryWallet(
  privy: PrivyClient,
  email: string
): Promise<PregeneratedBeneficiary> {
  const existing = await privy
    .users()
    .getByEmailAddress({ address: email })
    .catch(() => null);

  let user =
    existing ??
    (await privy.users().create({
      linked_accounts: [{ type: "email", address: email }],
      wallets: [{ chain_type: "ethereum" }]
    }));

  // An existing user can genuinely have no wallet yet — e.g. this project's
  // own operator login creates a Privy user from an email-only Selfie-free
  // sign-in, with nothing else attached. That is not the failure case below;
  // it is the documented "add a wallet to an existing user" path
  // (privy-docs /recipes/pregenerate-wallets.mdx, "Creating wallets for
  // existing users" — `users().pregenerateWallets(user_id, { wallets })`,
  // confirmed against the installed @privy-io/node@0.34.0 client.d.ts).
  if (!ethereumWalletAddress(user)) {
    user = await privy.users().pregenerateWallets(user.id, {
      wallets: [{ chain_type: "ethereum" }]
    });
  }

  const address = ethereumWalletAddress(user);
  if (!address) {
    throw new Error(
      `pregenerateBeneficiaryWallet: no ethereum embedded wallet on ${user.id} ` +
        `(linked account types: ${linkedTypes(user).join(", ")})`
    );
  }

  return { privyUserId: user.id, email, address, reused: existing !== null };
}

/** The `wallet` linked account Privy created, whatever else is on the user. */
function ethereumWalletAddress(user: unknown): string | null {
  const accounts = (user as { linked_accounts?: unknown[] }).linked_accounts ?? [];
  for (const account of accounts) {
    const a = account as { type?: string; chain_type?: string; address?: string };
    if (a.type === "wallet" && a.chain_type === "ethereum" && a.address) {
      return getAddress(a.address);
    }
  }
  return null;
}

const linkedTypes = (user: unknown): string[] =>
  ((user as { linked_accounts?: { type?: string }[] }).linked_accounts ?? []).map(
    (a) => a.type ?? "?"
  );

/** Records the pregenerated beneficiary in Postgres (directory state, not a figure). */
export async function persistBeneficiary(
  db: BoltDb,
  businessId: string,
  pregenerated: PregeneratedBeneficiary
): Promise<{ id: string }> {
  const [row] = await db
    .insert(beneficiaries)
    .values({
      businessId,
      email: pregenerated.email,
      privyUserId: pregenerated.privyUserId,
      walletAddress: pregenerated.address
    })
    .onConflictDoUpdate({
      target: [beneficiaries.businessId, beneficiaries.email],
      set: {
        privyUserId: pregenerated.privyUserId,
        walletAddress: pregenerated.address
      }
    })
    .returning({ id: beneficiaries.id });
  if (!row) throw new Error("persistBeneficiary: insert returned no row");
  return row;
}

// ---------------------------------------------------------------------------
// FR-2.6 / FR-8.3 — widening the lock to admit the beneficiary
// ---------------------------------------------------------------------------

export interface PermitBeneficiaryArgs {
  policyId: string;
  payee: string;
  spec: Omit<TransferPolicySpec, "permittedAddresses">;
  /**
   * Key-quorum authorization private keys. Required, and there is no branch that
   * skips them (invariant 3): widening a lock is exactly as hard as spending
   * from it. Below the quorum's threshold Privy refuses and the refusal stands.
   */
  authorizationPrivateKeys: readonly string[];
  /** `eth_signTransaction` is the live path on Arc; both are added by default. */
  methods?: readonly ("eth_signTransaction" | "eth_sendTransaction")[];
}

export interface PermitBeneficiaryResult {
  rules: PolicyCreateParams.Rule[];
  ruleNamesAfter: string[];
  permitted: boolean;
}

/**
 * Adds one beneficiary address to a live `CLIENT_MONEY` policy as a permitted
 * `transfer._to`, through the key quorum that owns the policy.
 *
 * This is Phase 2's allowlist-widening path (FR-2.6), not a new mechanism — the
 * same `policies().createRule` call, the same quorum requirement, the same
 * `assertConstrainsDecodedRecipient` guard on the rule. What is new is only that
 * the address being admitted belongs to a person who just proved they are one.
 */
export async function permitBeneficiary(
  privy: PrivyClient,
  args: PermitBeneficiaryArgs
): Promise<PermitBeneficiaryResult> {
  if (args.authorizationPrivateKeys.length === 0) {
    throw new Error(
      "permitBeneficiary: a key-quorum authorization signature is required. There is no " +
        "unsigned path and none may be added (invariant 3)."
    );
  }
  const payee = getAddress(args.payee);
  const methods = args.methods ?? (["eth_signTransaction", "eth_sendTransaction"] as const);
  const spec: TransferPolicySpec = { ...args.spec, permittedAddresses: [payee] };

  const before = await privy.policies().get(args.policyId);
  const existing = new Set(
    ((before as unknown as { rules?: { name: string }[] }).rules ?? []).map((r) => r.name)
  );

  const rules: PolicyCreateParams.Rule[] = [];
  for (const method of methods) {
    const rule = buildPayeeAllowRule(spec, [payee], method, `Payee ${payee.slice(0, 10)} ${method}`);
    rules.push(rule);
    // Already carried. Adding it again would stack a duplicate rule that widens
    // nothing — the policy already permits this payee on this method.
    if (existing.has(rule.name)) continue;
    await privy.policies().createRule(args.policyId, {
      ...rule,
      authorization_context: {
        authorization_private_keys: [...args.authorizationPrivateKeys]
      }
    } as never);
  }

  // Read the policy back. A create call that returned 200 is not the same fact
  // as a policy that carries the rule.
  const after = await privy.policies().get(args.policyId);
  const ruleNamesAfter =
    ((after as unknown as { rules?: { name: string }[] }).rules ?? []).map((r) => r.name);

  return {
    rules,
    ruleNamesAfter,
    permitted: rules.every((r) => ruleNamesAfter.includes(r.name))
  };
}

// ---------------------------------------------------------------------------
// FR-8.6 / FR-8.7 / FR-8.8 — when a Selfie Check is required
// ---------------------------------------------------------------------------

export type SelfieCheckReason = "FIRST_CLAIM" | "ADDRESS_CHANGE" | "NEW_DEVICE";

export type SelfieCheckRequirement =
  | { required: true; reason: SelfieCheckReason }
  | { required: false; reason: "ALREADY_VERIFIED"; verifiedAt: Date };

/**
 * Decides whether this claim needs a fresh Selfie Check, from the append-only
 * verification ledger.
 *
 * The three MUSTs, in the order they are checked:
 *
 *   FR-8.6  no verification for this beneficiary at all  -> FIRST_CLAIM
 *   FR-8.7  none for *this address*                      -> ADDRESS_CHANGE
 *   FR-8.7  none from *this device*                      -> NEW_DEVICE
 *   FR-8.8  otherwise                                    -> no fresh check
 *
 * FR-8.8 is the deliberate exception in CLAUDE.md invariant 7, and it is a
 * narrow one: the continuity signal must already exist for the exact address the
 * money is going to, on a device that has carried it before. It is not "this
 * person verified once, so they are trusted now".
 *
 * `deviceId` is opaque and client-supplied. It can only ever make this function
 * ask for *more* proof, never less — an absent or unrecognised device is a
 * NEW_DEVICE check, and a forged one still lands on the address rule above it.
 */
export async function selfieCheckRequirement(
  db: BoltDb,
  args: { beneficiaryId: string; address: string; deviceId?: string | null }
): Promise<SelfieCheckRequirement> {
  const address = args.address.toLowerCase();

  const all = await db
    .select()
    .from(beneficiaryVerifications)
    .where(eq(beneficiaryVerifications.beneficiaryId, args.beneficiaryId));

  if (all.length === 0) return { required: true, reason: "FIRST_CLAIM" };

  const forAddress = all.filter((v) => v.address.toLowerCase() === address);
  if (forAddress.length === 0) return { required: true, reason: "ADDRESS_CHANGE" };

  const fromDevice = args.deviceId
    ? forAddress.filter((v) => v.deviceId === args.deviceId)
    : [];
  if (fromDevice.length === 0) return { required: true, reason: "NEW_DEVICE" };

  const latest = fromDevice.reduce((a, b) => (a.verifiedAt > b.verifiedAt ? a : b));
  return { required: false, reason: "ALREADY_VERIFIED", verifiedAt: latest.verifiedAt };
}

/**
 * The signal a beneficiary's Selfie Check is bound to.
 *
 * world-docs (/world-id/idkit/integrate step 4) says the backend must enforce
 * the same signal it asked for. Binding it to (beneficiary, address) is what
 * stops a proof minted to authorise one withdrawal address being replayed to
 * authorise a different one — which is precisely the account-takeover FR-8.7
 * exists to prevent.
 */
export const beneficiaryClaimSignal = (beneficiaryId: string, address: string): string =>
  `${beneficiaryId}:${address.toLowerCase()}`;

export interface RecordedVerification {
  id: string;
  reason: SelfieCheckReason;
  humanProofRef: Hex;
  world: SelfieCheckVerification;
}

/**
 * Verifies one Selfie Check with World and writes it to the ledger.
 *
 * Throws `SelfieCheckError` on anything short of a verified Selfie Check —
 * there is no soft-fail path, exactly as in the unlock ceremony. A claim whose
 * check did not verify has no row here, and `payoutToBeneficiary` will therefore
 * refuse to run.
 */
export async function recordBeneficiaryVerification(
  db: BoltDb,
  world: SelfieCheckConfig,
  args: {
    beneficiaryId: string;
    address: string;
    reason: SelfieCheckReason;
    deviceId?: string | null;
    /** The IDKit result, exactly as the widget returned it. Never reshaped. */
    idkitResult: unknown;
  }
): Promise<RecordedVerification> {
  const verification = await verifySelfieCheck(world, args.idkitResult);
  const humanProofRef = humanProofRefOf(verification.nullifier);
  const address = args.address.toLowerCase();

  const [row] = await db
    .insert(beneficiaryVerifications)
    .values({
      beneficiaryId: args.beneficiaryId,
      address,
      reason: args.reason,
      deviceId: args.deviceId ?? null,
      humanProofRef,
      nullifier: nullifierToDecimal(verification.nullifier),
      worldProof: verification.raw as Record<string, unknown>
    })
    .returning({ id: beneficiaryVerifications.id });
  if (!row) throw new Error("recordBeneficiaryVerification: insert returned no row");

  // The verified address becomes the beneficiary's current withdrawal address.
  // FR-8.8's "already verified" reads off the ledger above, not this column —
  // this is a convenience for the UI and for FR-6.7's public lookup.
  await db
    .update(beneficiaries)
    .set({ verifiedAddress: address })
    .where(eq(beneficiaries.id, args.beneficiaryId));

  return { id: row.id, reason: args.reason, humanProofRef, world: verification };
}

// ---------------------------------------------------------------------------
// FR-8.3 / FR-8.5 — the payout
// ---------------------------------------------------------------------------

export interface PayoutConfig {
  /** The locked `CLIENT_MONEY` wallet the money leaves. */
  walletId: string;
  accountAddress: string;
  usdcAddress: string;
  chainId: number;
  rpcUrl?: string;
  /**
   * Authorization keys for the wallet's owning key quorum. An org wallet is
   * owned by the organization's default key quorum, so an unsigned request is
   * refused at Privy's API before the policy is ever evaluated — which is a
   * second, independent gate, but not the one FR-8.3 is about. To make the
   * *enclave* the thing that decides, the request has to get past the quorum
   * first.
   */
  authorizationPrivateKeys: readonly string[];
}

export interface PayoutResult {
  /** bytes32 obligation id, as it appears in `ObligationAccrued`. */
  obligationId: Hex;
  amount: Usdc;
  /** The USDC transfer on Arc. `ObligationSettled.txRef`. */
  transferTxHash: Hex;
  settledTxHash: string;
  destination: string;
}

/**
 * Pays a beneficiary out of a locked account and records the settlement.
 *
 * Order, and why each step is where it is:
 *
 *   1. The World gate. `selfieCheckRequirement` must say no fresh check is
 *      needed — which is only true once one has been verified and written to the
 *      ledger for this exact address and device. If it says a check is required,
 *      nothing below runs and no money moves (FR-8.6: "before any payout
 *      executes to them").
 *   2. The enclave. The transfer is built and sent to Privy with no destination
 *      check of our own. If the beneficiary is not a permitted `transfer._to`,
 *      Privy refuses and the caller records the refusal verbatim.
 *   3. Broadcast. Phase 0 established Privy will not broadcast on Arc, so the
 *      enclave signs and BOLT sends the raw transaction itself.
 *   4. `ObligationSettled` on `BoltRegistry`, carrying the transfer hash. The
 *      subgraph subtracts it from `owed` and cuts a `CoverageSnapshot` — which
 *      is why the public page moves without anyone writing a number to it.
 */
export async function payoutToBeneficiary(
  privy: PrivyClient,
  db: BoltDb,
  registry: RegistryWriter,
  cfg: PayoutConfig,
  args: {
    beneficiaryId: string;
    /** Postgres obligation row, and the bytes32 id the chain knows it by. */
    obligationRowId: string;
    obligationId: Hex;
    amount: Usdc;
    destination: string;
    deviceId?: string | null;
  }
): Promise<PayoutResult> {
  // 1. WHO. Not a boolean we check and then ignore: without a verification row
  //    for this address there is no payout, and the only way a row exists is
  //    that World verified a Selfie Check.
  const gate = await selfieCheckRequirement(db, {
    beneficiaryId: args.beneficiaryId,
    address: args.destination,
    deviceId: args.deviceId
  });
  if (gate.required) {
    throw new SelfieCheckRequiredError(gate.reason, args.destination);
  }

  const destination = getAddress(args.destination);
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(cfg.rpcUrl ?? arcTestnet.rpcUrls.default.http[0])
  });
  const [nonce, fees] = await Promise.all([
    client.getTransactionCount({ address: getAddress(cfg.accountAddress), blockTag: "pending" }),
    client.estimateFeesPerGas()
  ]);

  const transaction = {
    from: getAddress(cfg.accountAddress),
    to: getAddress(cfg.usdcAddress),
    // Invariant 2: on Arc, USDC is also the native token, so a transfer() call
    // carrying native value would move twice what it says.
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
      args: [destination, args.amount]
    })
  };

  // 2. WHERE. No destination check here — see invariant 1.
  const response = (await privy
    .wallets()
    .ethereum()
    .signTransaction(cfg.walletId, {
      params: { transaction },
      authorization_context: {
        authorization_private_keys: [...cfg.authorizationPrivateKeys]
      }
    } as never)) as { signed_transaction?: string; data?: { signed_transaction?: string } };

  const signed = response.signed_transaction ?? response.data?.signed_transaction;
  if (!signed) {
    throw new Error(`payoutToBeneficiary: no signed_transaction in response: ${JSON.stringify(response)}`);
  }

  // 3. Broadcast.
  const transferTxHash = await client.sendRawTransaction({
    serializedTransaction: signed as Hex
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transferTxHash });
  if (receipt.status !== "success") {
    throw new Error(`payoutToBeneficiary: payout reverted on chain: ${transferTxHash}`);
  }

  // 4. FR-8.5.
  const settled = await registry.recordObligationSettled({
    obligationId: args.obligationId,
    amount: args.amount,
    txRef: transferTxHash
  });

  await db
    .update(obligations)
    .set({ status: "SETTLED", txRef: transferTxHash, settledAt: new Date() })
    .where(eq(obligations.id, args.obligationRowId));

  return {
    obligationId: args.obligationId,
    amount: args.amount,
    transferTxHash,
    settledTxHash: settled.transactionHash,
    destination
  };
}

/** Thrown when a payout is attempted before the World gate has been passed. */
export class SelfieCheckRequiredError extends Error {
  constructor(
    public readonly reason: SelfieCheckReason,
    public readonly address: string
  ) {
    super(
      `world: a Selfie Check is required before paying out to ${address} (${reason}). ` +
        `FR-8.6/FR-8.7 — no payout executes to a beneficiary who has not established ` +
        `eligibility, and no withdrawal address is honoured without a continuity signal.`
    );
    this.name = "SelfieCheckRequiredError";
  }
}

/** The outstanding obligations a beneficiary's account can be paid from. */
export async function outstandingObligations(
  db: BoltDb,
  args: { businessId: string; accountId: string }
): Promise<{ id: string; amount: Usdc }[]> {
  const rows = await db
    .select({ id: obligations.id, amount: obligations.amount })
    .from(obligations)
    .where(
      and(
        eq(obligations.businessId, args.businessId),
        eq(obligations.accountId, args.accountId),
        eq(obligations.status, "OUTSTANDING")
      )
    );
  return rows.map((r) => ({ id: r.id, amount: usdc(r.amount) }));
}
