/**
 * FR-8.3 / FR-8.5 / FR-8.6 / FR-8.7 / FR-8.8 — the beneficiary claim endpoint.
 *
 * Three verbs on one route, because they are three steps of one flow and
 * splitting them across files would let the ordering drift:
 *
 *   GET  ?email=…   what does this beneficiary have, and does this claim need a
 *                   fresh Selfie Check? (FR-8.6/8.7/8.8)
 *   POST verify     forward a completed Selfie Check to World, verbatim, and
 *                   write it to the verification ledger
 *   POST withdraw   pay out — the enclave decides the destination
 *
 * Nothing here checks a destination (invariant 1). `payoutToBeneficiary` builds
 * the transfer and hands it to Privy; if the address is not a permitted
 * `transfer._to` the enclave refuses, and that refusal is stored verbatim and
 * returned to the caller as-is.
 *
 * NOTE: like every other Postgres-backed route in this repo, the DB half is not
 * live-testable from the build sandbox (direct Postgres ports are unreachable).
 * The same code path is exercised end to end against PGlite by
 * `pnpm --filter @bolt/privy phase8:payout` and by `beneficiary.test.ts`.
 */
import { and, eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { PrivyClient } from "@privy-io/node";
import {
  SelfieCheckError,
  createRegistryWriter,
  usdc,
  type SelfieCheckConfig
} from "@bolt/core";
import {
  SelfieCheckRequiredError,
  beneficiaryClaimSignal,
  payoutToBeneficiary,
  recordBeneficiaryVerification,
  recordPolicyRefusal,
  selfieCheckRequirement,
  type SelfieCheckReason
} from "@bolt/privy";
import {
  createDb,
  accounts,
  beneficiaries,
  beneficiaryVerifications,
  businesses,
  obligations,
  type BoltDb
} from "@bolt/db";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

const worldAction = (): string =>
  process.env.WORLD_BENEFICIARY_ACTION_ID ?? "bolt-beneficiary-claim";

/** Resolves the beneficiary and the locked account their money sits in. */
async function load(slug: string, email: string) {
  // Same cast as the unlock-approval route: `BoltDb` is the driver-agnostic
  // shape so the identical code runs against PGlite in tests.
  const db = createDb() as unknown as BoltDb;
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.slug, slug));
  if (!business) return null;

  const [beneficiary] = await db
    .select()
    .from(beneficiaries)
    .where(
      and(eq(beneficiaries.businessId, business.id), eq(beneficiaries.email, email.trim().toLowerCase()))
    );
  if (!beneficiary) return null;

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, business.id), eq(accounts.class, "CLIENT_MONEY")));

  return { db, businessId: business.id, beneficiary, account };
}

// ---------------------------------------------------------------------------
// GET — balance, withdrawal address, and whether a check is needed
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const email = url.searchParams.get("email");
  // Never trusted as an authentication factor — it can only ever cause a check
  // to be *asked for*. See the note on `beneficiary_verifications.device_id`.
  const deviceId = url.searchParams.get("deviceId");
  const address = url.searchParams.get("address");
  if (!slug || !email) {
    return Response.json({ error: "slug and email are required" }, { status: 400 });
  }

  const loaded = await load(slug, email);
  if (!loaded) return Response.json({ found: false });

  const { db, businessId, beneficiary } = loaded;
  const destination = address ?? beneficiary.verifiedAddress ?? beneficiary.walletAddress;
  if (!destination) {
    return Response.json({ found: true, address: null, outstanding: "0", selfieCheck: null });
  }

  const gate = await selfieCheckRequirement(db, {
    beneficiaryId: beneficiary.id,
    address: destination,
    deviceId
  });

  const owed = await db
    .select({ id: obligations.id, amount: obligations.amount })
    .from(obligations)
    .where(
      and(
        eq(obligations.businessId, businessId),
        eq(obligations.beneficiaryId, beneficiary.id),
        eq(obligations.status, "OUTSTANDING")
      )
    );

  return Response.json({
    found: true,
    // The wallet Privy pregenerated for this email, before they ever signed in.
    walletAddress: beneficiary.walletAddress,
    withdrawalAddress: destination,
    outstanding: owed.reduce((sum, o) => sum + o.amount, 0n).toString(),
    obligations: owed.map((o) => ({ id: o.id, amount: o.amount.toString() })),
    selfieCheck: gate,
    // The exact signal the proof must be bound to. The client sends it to IDKit;
    // the server checks the returned `signal_hash` against it again.
    signal: beneficiaryClaimSignal(beneficiary.id, destination),
    action: worldAction()
  });
}

// ---------------------------------------------------------------------------
// POST — verify a Selfie Check, or withdraw
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  op: z.literal("verify"),
  slug: z.string().min(1),
  email: z.string().email(),
  address: z.string().min(1),
  reason: z.enum(["FIRST_CLAIM", "ADDRESS_CHANGE", "NEW_DEVICE"]),
  deviceId: z.string().min(1).nullable().optional(),
  /** The IDKit result, exactly as the widget returned it. Never reshaped. */
  idkitResult: z.unknown()
});

const withdrawSchema = z.object({
  op: z.literal("withdraw"),
  slug: z.string().min(1),
  email: z.string().email(),
  address: z.string().min(1),
  obligationId: z.string().uuid(),
  deviceId: z.string().min(1).nullable().optional()
});

export async function POST(request: Request): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const op = (raw as { op?: string } | null)?.op;

  if (op === "verify") return handleVerify(verifySchema.parse(raw));
  if (op === "withdraw") return handleWithdraw(withdrawSchema.parse(raw));
  return Response.json({ error: 'op must be "verify" or "withdraw"' }, { status: 400 });
}

async function handleVerify(body: z.infer<typeof verifySchema>): Promise<Response> {
  const loaded = await load(body.slug, body.email);
  if (!loaded) return Response.json({ error: "unknown beneficiary" }, { status: 404 });
  const { db, beneficiary } = loaded;

  // FR-8.8 — a repeat verification for the same (beneficiary, address,
  // device) needs no fresh check. Checked up front, not just relied on
  // client-side: the same real person always produces the same World
  // nullifier for this app+action, so re-submitting one here would otherwise
  // hit the anti-replay unique index below and crash instead of succeeding —
  // and re-submission is a real scenario (a page reload, a double click),
  // not just a client bug to prevent.
  const gate = await selfieCheckRequirement(db, {
    beneficiaryId: beneficiary.id,
    address: body.address,
    deviceId: body.deviceId ?? null
  });
  if (!gate.required) {
    const [existing] = await db
      .select()
      .from(beneficiaryVerifications)
      .where(
        and(
          eq(beneficiaryVerifications.beneficiaryId, beneficiary.id),
          eq(beneficiaryVerifications.address, body.address.toLowerCase())
        )
      );
    return Response.json({
      verified: true,
      humanProofRef: existing?.humanProofRef ?? null,
      alreadyVerified: true
    });
  }

  const world: SelfieCheckConfig = {
    rpId: need("WORLD_RP_ID"),
    action: worldAction(),
    // world-docs /world-id/idkit/integrate step 4: the backend must enforce the
    // same signal it asked for. Recomputed here rather than taken from the
    // request — a client-supplied expectation would enforce nothing.
    expectedSignalHash: hashSignal(beneficiaryClaimSignal(beneficiary.id, body.address))
  };

  try {
    const recorded = await recordBeneficiaryVerification(db, world, {
      beneficiaryId: beneficiary.id,
      address: body.address,
      reason: body.reason as SelfieCheckReason,
      deviceId: body.deviceId ?? null,
      idkitResult: body.idkitResult
    });
    return Response.json({
      verified: true,
      humanProofRef: recorded.humanProofRef,
      action: recorded.world.action,
      environment: recorded.world.environment
    });
  } catch (error) {
    if (error instanceof SelfieCheckError) {
      // World's body, verbatim. A refused Selfie Check is an audit event in this
      // product, not an error toast.
      return Response.json(
        { verified: false, error: error.message, world: error.body },
        { status: 403 }
      );
    }
    // Anything else (a DB error, a bug) still gets a real JSON body — the
    // caller is a browser fetch, and an unhandled throw here previously
    // closed the connection with no body at all ("Unexpected end of JSON
    // input" client-side), which is a worse failure than an honest 500.
    return Response.json(
      { verified: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function handleWithdraw(body: z.infer<typeof withdrawSchema>): Promise<Response> {
  const loaded = await load(body.slug, body.email);
  if (!loaded?.account) return Response.json({ error: "unknown beneficiary" }, { status: 404 });
  const { db, businessId, beneficiary, account } = loaded;

  const [obligation] = await db
    .select()
    .from(obligations)
    .where(and(eq(obligations.id, body.obligationId), eq(obligations.beneficiaryId, beneficiary.id)));
  if (!obligation || obligation.status !== "OUTSTANDING") {
    return Response.json({ error: "no such outstanding obligation" }, { status: 404 });
  }

  const privy = new PrivyClient({
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET")
  });
  const registry = createRegistryWriter({
    registryAddress: getAddress(need("REGISTRY_ADDRESS")),
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl: process.env.ARC_RPC_URL
  });

  try {
    const result = await payoutToBeneficiary(
      privy,
      db,
      registry,
      {
        walletId: need("BOLT_CLIENT_MONEY_WALLET_ID"),
        accountAddress: account.address,
        usdcAddress: need("USDC_ADDRESS"),
        chainId: Number(need("ARC_CHAIN_ID")),
        rpcUrl: process.env.ARC_RPC_URL,
        authorizationPrivateKeys: [need("PRIVY_AUTHORIZATION_KEY")]
      },
      {
        beneficiaryId: beneficiary.id,
        obligationRowId: obligation.id,
        // The on-chain obligation id is derived at accrual time and stored with
        // the row's `txRef` lineage; here it is the id the subgraph knows.
        obligationId: (obligation.txRef ?? `0x${"00".repeat(32)}`) as Hex,
        amount: usdc(obligation.amount),
        destination: body.address,
        deviceId: body.deviceId ?? null
      }
    );
    return Response.json({
      paid: true,
      amount: result.amount.toString(),
      destination: result.destination,
      transferTx: result.transferTxHash,
      obligationSettledTx: result.settledTxHash
    });
  } catch (error) {
    if (error instanceof SelfieCheckRequiredError) {
      return Response.json(
        { paid: false, selfieCheckRequired: true, reason: error.reason, error: error.message },
        { status: 403 }
      );
    }
    // A policy refusal. Stored untouched (FR-2.4) and returned as-is — it is the
    // product working, and it is demo material.
    await recordPolicyRefusal(db, {
      businessId,
      accountId: account.id,
      error,
      attemptedAction: { beneficiaryClaim: true, to: body.address, obligationId: obligation.id }
    });
    return Response.json(
      { paid: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
