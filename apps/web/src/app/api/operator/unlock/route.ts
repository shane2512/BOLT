/**
 * B8 / FR-5.1 — open an unlock ceremony from the dashboard.
 *
 * This is the only write in the operator dashboard, and it is worth being
 * precise about what it can and cannot do:
 *
 *   It **proposes**. `requestUnlock` writes the workflow row, creates the
 *   Privy intent the quorum's members will later approve from their own
 *   phones, and records `UnlockRequested` on `BoltRegistry`. It produces no
 *   signature and moves nothing.
 *
 *   The destination is **not checked here**. If it is not already a permitted
 *   payee under the account's policy, the enclave refuses when the quorum tries
 *   to execute, and that refusal is the evidence (invariant 1). An app-layer
 *   "is this allowed?" would be the exact thing BOLT claims does not exist.
 *
 *   Nothing here can shorten the 24-hour delay. `executableAt` on the event is
 *   a floor read off the deployed `BoltUnlockTimer`; the authoritative value is
 *   set when the final approval arms the timer, and anyone can read it back off
 *   the contract.
 *
 * Wiring follows `packages/privy/scripts/phase6-unlock.ts`, which is the live
 * path this reuses rather than re-derives. `walletId` is resolved from the
 * account address via `privy.wallets().list({ address })` — the workflow store
 * records an account's address and policy, not its Privy wallet id.
 *
 * The request identifies the account by **address**, not by the workflow
 * store's own row id: the dashboard's account picker is built from the
 * subgraph (`/api/operator/business`), which only ever carries an account's
 * on-chain address — it has no way to know a Postgres UUID it never reads.
 */
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";
import { PrivyClient } from "@privy-io/node";
import type { Hex } from "viem";
import { businessIdOf, createRegistryWriter, createUnlockTimer, usdc } from "@bolt/core";
import { requestUnlock, type UnlockCeremonyConfig } from "@bolt/privy";
import type { BoltDb } from "@bolt/db";
import { jsonSafe, withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set on this deployment`);
  return value;
};

const bodySchema = z.object({
  business: z.string().min(1),
  accountAddress: z.string().min(1),
  /** USDC base units. A string because money is bigint, never number. */
  amount: z.string().regex(/^\d+$/, "amount must be USDC base units, as digits"),
  destination: z.string().min(1),
  reason: z.string().min(10, "the reason is what approvers read — write a real one").max(2000)
});

export const POST = withOperator(async (request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const input = parsed.data;

  const { accounts, businesses, createDb } = await import("@bolt/db");
  // `createDb` returns the schema-typed drizzle instance; `requestUnlock` takes
  // the schema-agnostic `BoltDb` so the same code runs against PGlite in tests.
  const db = createDb() as unknown as BoltDb;

  const [business] = await db.select().from(businesses).where(eq(businesses.slug, input.business));
  if (!business) {
    return {
      ok: false as const,
      error: `No workflow row exists for "${input.business}". A ceremony needs one — it is where the reason text and the collected approvals live.`
    };
  }
  let normalizedAddress: `0x${string}`;
  try {
    normalizedAddress = getAddress(input.accountAddress);
  } catch {
    return { ok: false as const, error: `"${input.accountAddress}" is not a valid address.` };
  }
  const [account] = await db.select().from(accounts).where(eq(accounts.address, normalizedAddress));
  if (!account || account.businessId !== business.id) {
    return {
      ok: false as const,
      error: "That account does not belong to this business's workflow-store row."
    };
  }
  if (account.class === "OPERATING") {
    // Not a safety control — an operating account has no policy to unlock
    // from, so a ceremony over it would be theatre.
    return {
      ok: false as const,
      error:
        "An operating account carries no policy, so there is nothing to unlock. It holds the business's own money and is already spendable."
    };
  }

  const privy = new PrivyClient({
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET")
  });

  const wallets = await privy
    .wallets()
    .list({ address: getAddress(account.address) as `0x${string}` });
  const walletId = wallets.data?.[0]?.id;
  if (!walletId) {
    return {
      ok: false as const,
      error: `Privy has no wallet at ${account.address}. The workflow store and the Privy organization have diverged; a ceremony cannot be opened against an account Privy does not hold.`
    };
  }

  const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
  const registry = createRegistryWriter({
    registryAddress: need("REGISTRY_ADDRESS") as Hex,
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl
  });
  const timer = createUnlockTimer({
    timerAddress: need("UNLOCK_TIMER_ADDRESS") as Hex,
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl
  });

  const cfg: UnlockCeremonyConfig = {
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET"),
    onChainBusinessId: businessIdOf(input.business),
    usdcAddress: need("USDC_ADDRESS"),
    chainId: Number(need("ARC_CHAIN_ID")),
    rpcUrl,
    world: {
      rpId: process.env.WORLD_RP_ID ?? "",
      action: process.env.WORLD_ACTION_ID ?? ""
    }
  };

  const record = await requestUnlock(privy, db, registry, timer, cfg, {
    businessId: business.id,
    accountId: account.id,
    walletId,
    accountAddress: account.address,
    amount: usdc(BigInt(input.amount)),
    destination: input.destination.trim(),
    reason: input.reason
  });

  return jsonSafe({
    ok: true as const,
    ...record,
    approvalLinkBase: `/approve/${record.id}`,
    note: "Nothing has moved. The quorum's members now approve from their own devices, each behind a World Selfie Check; the 24-hour on-chain timer starts only after the final approval."
  });
});
