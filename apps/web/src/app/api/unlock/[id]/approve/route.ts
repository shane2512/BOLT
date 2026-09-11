/**
 * FR-5.2 + FR-5.3 — one quorum member approves an unlock from their phone.
 *
 * This route is the adapter only. Everything that matters — World verifies
 * first, the nullifier is stored under a unique index, only then is a quorum
 * signature produced, then `UnlockApproved` on chain, then the 24h timer if that
 * was the final approval — lives in `approveUnlock` in `@bolt/privy`, so the
 * route, the unit tests and the Phase 6 evidence harness cannot drift apart.
 *
 * The IDKit result is forwarded to `approveUnlock` **unmodified**. world-docs is
 * explicit that the proof must not be remapped, re-encoded or trimmed before it
 * reaches the verifier, so this route does not parse it beyond checking that a
 * JSON body arrived.
 */
import type { Hex } from "viem";
import { z } from "zod";
import { createRegistryWriter, createUnlockTimer } from "@bolt/core";
import { createDb, type BoltDb } from "@bolt/db";
import { PrivyClient } from "@privy-io/node";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { approveUnlock } from "@bolt/privy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

const bodySchema = z.object({
  /** Which quorum member is approving. */
  approverId: z.string().min(1),
  /** The IDKit result, exactly as the widget returned it. */
  idkitResult: z.unknown()
});

/**
 * Where an approver's authorization key comes from.
 *
 * DEMO SHAPE, named as such. `UNLOCK_APPROVER_KEYS` is a JSON map of
 * `{ approverId: { address, authorizationPrivateKey } }` held server-side, which
 * is what lets a scripted or single-machine demo drive five members.
 *
 * The production shape, per privy-docs /controls/authorization-keys/keys/create/user,
 * is that each member is a *user* in the auth system and signs with a time-bound
 * user key requested against their own access token — the key never sits on our
 * server at all. That is a Phase 8-sized change (it needs Privy user auth in the
 * web app) and it does not change what the quorum enforces: three real
 * signatures from three registered members, counted in Privy's TEE. It changes
 * who holds the keys, which is a real difference and is why this comment exists
 * instead of a claim that five phones each hold their own.
 */
function approverFromEnv(approverId: string): {
  id: string;
  address: string;
  authorizationPrivateKey: string;
} {
  const map = JSON.parse(need("UNLOCK_APPROVER_KEYS")) as Record<
    string,
    { address: string; authorizationPrivateKey: string }
  >;
  const member = map[approverId];
  if (!member) throw new Error(`unknown approver "${approverId}"`);
  return { id: approverId, ...member };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "approverId and idkitResult are required" }, { status: 400 });
  }

  const privy = new PrivyClient({
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET")
  });
  const db = createDb() as unknown as BoltDb;
  const registry = createRegistryWriter({
    registryAddress: need("REGISTRY_ADDRESS") as Hex,
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl: process.env.ARC_RPC_URL
  });
  const timer = createUnlockTimer({
    timerAddress: need("UNLOCK_TIMER_ADDRESS") as Hex,
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl: process.env.ARC_RPC_URL
  });

  try {
    const result = await approveUnlock(privy, db, registry, timer, {
      appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
      appSecret: need("PRIVY_APP_SECRET"),
      onChainBusinessId: "0x" as Hex, // unused on the approval path
      usdcAddress: need("USDC_ADDRESS"),
      chainId: Number(need("ARC_CHAIN_ID")),
      rpcUrl: process.env.ARC_RPC_URL,
      world: {
        rpId: need("WORLD_RP_ID"),
        action: need("WORLD_ACTION_ID"),
        // FR-5.3 — the proof must be bound to *this* unlock. The widget passes
        // `signal: unlockRequestId`; the proof carries only the hash, so the
        // server recomputes it and compares.
        expectedSignalHash: hashSignal(id)
      }
    }, {
      unlockRequestId: id,
      approver: approverFromEnv(parsed.data.approverId),
      idkitResult: parsed.data.idkitResult
    });

    return Response.json({
      approved: true,
      approvals: result.approvals,
      threshold: result.threshold,
      // FR-5.3: the proof reference is public, by design.
      humanProofRef: result.humanProofRef,
      nullifier: result.world.nullifier,
      approvedTx: result.approvedTxHash,
      executableAt: result.armed ? result.armed.executableAt.toString() : null
    });
  } catch (error) {
    // Refusals are evidence. The message is passed through rather than
    // flattened to "approval failed" — a Selfie Check that World rejected and a
    // quorum that refused a signature are different problems and the approver
    // deserves to know which one they hit.
    return Response.json(
      { approved: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
