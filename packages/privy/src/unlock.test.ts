/**
 * FR-5.3 / FR-5.7 — **never delete this file.**
 *
 * Two Phase 6 exit criteria are claims about *ordering*, and ordering is exactly
 * the kind of property that rots silently: someone moves the World call below
 * the Privy call to save a round trip, everything still passes a smoke test, and
 * the human gate quietly becomes decorative.
 *
 * So this file asserts the ordering directly. The stub Privy records whether it
 * was reached at all. If a failed Selfie Check ever stops short of preventing
 * that, these tests fail.
 *
 * PGlite (in-memory WASM Postgres), same schema and same unique indexes as
 * production — the anti-replay property is the index doing the work, not a
 * check-then-insert in application code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { PrivyClient } from "@privy-io/node";
import {
  accounts as accountsTable,
  businesses,
  unlockApprovals,
  unlockRequests,
  type BoltDb
} from "@bolt/db";
import {
  SelfieCheckError,
  humanProofRefOf,
  nullifierToDecimal,
  usdc,
  type RegistryWriter,
  type UnlockTimer
} from "@bolt/core";
import {
  PrivyQuorumError,
  approveUnlock,
  executeUnlock,
  signUnlockRequest,
  submitQuorumSignedUnlock,
  unlockSignableRequest,
  type UnlockCeremonyConfig
} from "./unlock.js";

const MIGRATIONS = [
  "0000_swift_cardiac.sql",
  "0001_organic_wendell_vaughn.sql",
  "0002_tense_ken_ellis.sql"
].map((f) => fileURLToPath(new URL(`../../db/drizzle/${f}`, import.meta.url)));

const CLIENT_MONEY = "0x" + "0e".repeat(20);
const PAYEE = "0x" + "d0".repeat(20);
const APPROVER_ADDRESSES = [1, 2, 3, 4, 5].map(
  (n) => `0x${String(n).repeat(2)}${"f".repeat(38)}`
);
const SIGNAL_HASH = "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4";
const NULLIFIERS = [
  "0x1f0d3c2b1a09876543210fedcba9876543210fedcba9876543210fedcba98765",
  "0x0abc000000000000000000000000000000000000000000000000000000000001",
  "0x0abc000000000000000000000000000000000000000000000000000000000002"
];

// A throwaway P-256 private key in base64 PKCS8 (no PEM headers) — the format
// `generateAuthorizationSignature` expects. Test-only; authorizes nothing real.
const TEST_P256_KEY =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2" +
  "OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r" +
  "1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G";

/** A Selfie Check result shaped as IDKit returns it (world-docs, World ID 3.0). */
const idkitResult = (action: string, nullifier = NULLIFIERS[0]!) => ({
  protocol_version: "3.0",
  nonce: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  action,
  environment: "sandbox",
  responses: [
    {
      identifier: "selfie",
      signal_hash: SIGNAL_HASH,
      proof: "0x1a2b3c",
      merkle_root: "0x0abc123",
      nullifier
    }
  ],
  user_presence_completed: true
});

// --- stubs -----------------------------------------------------------------

/** World's verifier. `verdict` decides what the endpoint answers. */
function worldFetch(
  verdict: "verified" | "refused" | "orb-not-selfie",
  nullifier = NULLIFIERS[0]!
) {
  return vi.fn(async () => {
    if (verdict === "refused") {
      return new Response(
        JSON.stringify({ success: false, code: "invalid_proof", detail: "Proof is invalid." }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const identifier = verdict === "orb-not-selfie" ? "orb" : "selfie";
    return new Response(
      JSON.stringify({
        success: true,
        results: [{ identifier, success: true, nullifier }],
        action: "bolt-unlock-approval",
        nullifier,
        created_at: "2026-09-10T00:00:00Z",
        environment: "sandbox"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

interface PrivyStub {
  client: PrivyClient;
  /** How many times BOLT reached Privy at all. */
  intentReads: number;
  /** Signatures Privy was asked to accept, per submitted request. */
  submissions: string[][];
  fetchImpl: typeof fetch;
}

/**
 * Privy: an intent proposing the unlock, and a wallet RPC endpoint that refuses
 * below the quorum threshold exactly as the live API does (verified against
 * api.privy.io — 401 at two of five, 200 at three).
 */
function privyStub(threshold = 3): PrivyStub {
  const stub: PrivyStub = {
    intentReads: 0,
    submissions: [],
    client: {
      intents: () => ({
        get: async () => {
          stub.intentReads += 1;
          return {
            intent_id: "intent_1",
            status: "pending",
            resource_id: "wallet_1",
            request_details: {
              method: "POST",
              url: "https://api.privy.io/v1/wallets/wallet_1/rpc",
              body: { method: "eth_signTransaction", params: { transaction: { nonce: 0 } } }
            },
            authorization_details: [
              {
                threshold,
                members: APPROVER_ADDRESSES.map((_, i) => ({
                  type: "key",
                  public_key: `key-${i}`,
                  signed_at: null
                }))
              }
            ]
          };
        }
      })
    } as unknown as PrivyClient,
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("privy-authorization-signature") ?? "";
      const signatures = header ? header.split(",") : [];
      stub.submissions.push(signatures);
      if (new Set(signatures).size < threshold) {
        return new Response(
          JSON.stringify({
            error:
              "Number of signatures in `privy-authorization-signature` header does not match " +
              "the wallet's authorization threshold"
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ method: "eth_signTransaction", data: { signed_transaction: "0x02f8" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch
  };
  return stub;
}

const registryStub = () => {
  const calls: { unlockId: string; approver: string; humanProofRef: string }[] = [];
  const writer = {
    recordUnlockApproved: vi.fn(async (args: Record<string, string>) => {
      calls.push(args as never);
      return { transactionHash: "0x" + "cc".repeat(32) } as never;
    }),
    recordUnlockExecuted: vi.fn(async () => ({ transactionHash: "0x" + "ff".repeat(32) }) as never)
  } as unknown as RegistryWriter;
  return { writer, calls };
};

const timerStub = () => {
  const armed: string[] = [];
  const released: string[] = [];
  const writer = {
    address: "0x" + "ee".repeat(20),
    delaySeconds: async () => 86_400n,
    arm: vi.fn(async (unlockId: string) => {
      armed.push(unlockId);
      return { transactionHash: "0x" + "dd".repeat(32) } as never;
    }),
    state: async () => ({ armedAt: 1n, executableAt: 86_401n, released: false }),
    secondsRemaining: async () => 86_400n,
    release: vi.fn(async (unlockId: string) => {
      released.push(unlockId);
      return { transactionHash: "0x" + "ab".repeat(32) } as never;
    })
  } as unknown as UnlockTimer;
  return { writer, armed, released };
};

// --- fixture ---------------------------------------------------------------

let db: BoltDb;
let unlockRequestId: string;

beforeEach(async () => {
  const client = new PGlite();
  db = drizzle(client) as unknown as BoltDb;
  for (const file of MIGRATIONS) {
    for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  const [business] = await db
    .insert(businesses)
    .values({ slug: "acme", name: "Acme", adminAddress: "0x" + "11".repeat(20) })
    .returning({ id: businesses.id });
  const [account] = await db
    .insert(accountsTable)
    .values({
      businessId: business!.id,
      address: CLIENT_MONEY,
      class: "CLIENT_MONEY",
      label: "Client money"
    })
    .returning({ id: accountsTable.id });

  const [request] = await db
    .insert(unlockRequests)
    .values({
      businessId: business!.id,
      accountId: account!.id,
      amount: usdc(25_000_000n),
      destination: PAYEE,
      reason: "Buyer confirmed delivery and waived the hold. Releasing the seller's escrow early.",
      reasonHash: "0x" + "aa".repeat(32),
      intentId: "intent_1"
    })
    .returning({ id: unlockRequests.id });
  unlockRequestId = request!.id;
});

const cfgFor = (privy: PrivyStub, world: typeof fetch): UnlockCeremonyConfig => ({
  appId: "app-id",
  appSecret: "app-secret",
  fetchImpl: privy.fetchImpl,
  onChainBusinessId: ("0x" + "bb".repeat(32)) as `0x${string}`,
  usdcAddress: "0x3600000000000000000000000000000000000000",
  chainId: 5042002,
  world: {
    rpId: "rp_test",
    action: "bolt-unlock-approval",
    fetchImpl: world,
    // The fixture proofs all carry this signal_hash.
    expectedSignalHash: SIGNAL_HASH
  }
});

const approver = (i: number) => ({
  id: `approver-${i}`,
  address: APPROVER_ADDRESSES[i]!,
  authorizationPrivateKey: TEST_P256_KEY
});

/** Drives n distinct humans through the full approval path. */
async function approve(
  n: number,
  privy: PrivyStub,
  registry: ReturnType<typeof registryStub>,
  timer: ReturnType<typeof timerStub>
) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const world = worldFetch("verified", NULLIFIERS[i]!);
    const cfg = cfgFor(privy, world as unknown as typeof fetch);
    results.push(
      await approveUnlock(privy.client, db, registry.writer, timer.writer, cfg, {
        unlockRequestId,
        approver: approver(i),
        idkitResult: idkitResult("bolt-unlock-approval", NULLIFIERS[i]!)
      })
    );
  }
  return results;
}

// --- the tests -------------------------------------------------------------

describe("FR-5.3 — the World Selfie Check gates the approval", () => {
  it("a refused Selfie Check never reaches Privy, never writes an approval, never records on chain", async () => {
    const privy = privyStub();
    const registry = registryStub();
    const timer = timerStub();

    await expect(
      approveUnlock(
        privy.client,
        db,
        registry.writer,
        timer.writer,
        cfgFor(privy, worldFetch("refused") as unknown as typeof fetch),
        {
          unlockRequestId,
          approver: approver(0),
          idkitResult: idkitResult("bolt-unlock-approval")
        }
      )
    ).rejects.toBeInstanceOf(SelfieCheckError);

    // The ordering claim, asserted four ways.
    expect(privy.intentReads).toBe(0);
    expect(privy.submissions).toHaveLength(0);
    expect(registry.writer.recordUnlockApproved).not.toHaveBeenCalled();
    expect(await db.select().from(unlockApprovals)).toHaveLength(0);
  });

  it("a verified proof of some other credential is not a Selfie Check", async () => {
    const privy = privyStub();
    await expect(
      approveUnlock(
        privy.client,
        db,
        registryStub().writer,
        timerStub().writer,
        cfgFor(privy, worldFetch("orb-not-selfie") as unknown as typeof fetch),
        {
          unlockRequestId,
          approver: approver(0),
          idkitResult: idkitResult("bolt-unlock-approval")
        }
      )
    ).rejects.toBeInstanceOf(SelfieCheckError);
    expect(privy.intentReads).toBe(0);
  });

  it("a proof scoped to a different action is refused before the round trip", async () => {
    const privy = privyStub();
    const world = worldFetch("verified");
    await expect(
      approveUnlock(
        privy.client,
        db,
        registryStub().writer,
        timerStub().writer,
        cfgFor(privy, world as unknown as typeof fetch),
        {
          unlockRequestId,
          approver: approver(0),
          idkitResult: idkitResult("some-other-action")
        }
      )
    ).rejects.toBeInstanceOf(SelfieCheckError);
    expect(world).not.toHaveBeenCalled();
    expect(privy.intentReads).toBe(0);
  });

  it("a proof bound to a different unlock is refused before the round trip", async () => {
    const privy = privyStub();
    const world = worldFetch("verified");
    const cfg = cfgFor(privy, world as unknown as typeof fetch);
    // Same person, same action, genuinely completed check — but the signal binds
    // it to some other unlock. Three real Selfie Checks for the wrong unlock
    // must not approve this one.
    cfg.world.expectedSignalHash = "0x0049ae54f2c7d13e1b2a166435c9efd736c690dffab385fd253691f55e81e3a5";

    await expect(
      approveUnlock(privy.client, db, registryStub().writer, timerStub().writer, cfg, {
        unlockRequestId,
        approver: approver(0),
        idkitResult: idkitResult("bolt-unlock-approval")
      })
    ).rejects.toBeInstanceOf(SelfieCheckError);
    expect(world).not.toHaveBeenCalled();
    expect(privy.intentReads).toBe(0);
  });

  it("records the World nullifier itself as the on-chain proof reference", async () => {
    const privy = privyStub();
    const registry = registryStub();
    const [result] = await approve(1, privy, registry, timerStub());

    // Padded, not hashed — a reader can check it against the proof World issued.
    expect(result!.humanProofRef).toBe(humanProofRefOf(NULLIFIERS[0]!));
    expect(registry.calls[0]?.humanProofRef).toBe(humanProofRefOf(NULLIFIERS[0]!));

    const [row] = await db.select().from(unlockApprovals);
    expect(row?.nullifier).toBe(nullifierToDecimal(NULLIFIERS[0]!));
    expect(row?.worldProof).toBeTruthy();
    expect(row?.quorumSignature).toBeTruthy();
  });

  it("one human cannot fill more than one of the five slots", async () => {
    const privy = privyStub();
    const cfg = cfgFor(privy, worldFetch("verified") as unknown as typeof fetch);

    await approveUnlock(privy.client, db, registryStub().writer, timerStub().writer, cfg, {
      unlockRequestId,
      approver: approver(0),
      idkitResult: idkitResult("bolt-unlock-approval")
    });

    // Same person (same nullifier), different claimed approver identity.
    await expect(
      approveUnlock(privy.client, db, registryStub().writer, timerStub().writer, cfg, {
        unlockRequestId,
        approver: approver(1),
        idkitResult: idkitResult("bolt-unlock-approval")
      })
    ).rejects.toThrow();

    expect(await db.select().from(unlockApprovals)).toHaveLength(1);
  });
});

describe("FR-5.7 — the quorum decides, not our code", () => {
  it("submits whatever signatures exist and lets Privy refuse two of five", async () => {
    const privy = privyStub(3);
    const registry = registryStub();
    const timer = timerStub();
    await approve(2, privy, registry, timer);

    await expect(
      executeUnlock(
        privy.client,
        db,
        registry.writer,
        timer.writer,
        cfgFor(privy, worldFetch("verified") as unknown as typeof fetch),
        unlockRequestId
      )
    ).rejects.toBeInstanceOf(PrivyQuorumError);

    // The two signatures were genuinely sent — the refusal is Privy's, not a
    // count kept here — and nothing on chain was touched.
    expect(privy.submissions.at(-1)).toHaveLength(2);
    expect(timer.released).toHaveLength(0);
    expect(registry.writer.recordUnlockExecuted).not.toHaveBeenCalled();
  });

  it("arms the 24h timer only once the quorum's threshold is met", async () => {
    const privy = privyStub(3);
    const timer = timerStub();
    const results = await approve(3, privy, registryStub(), timer);

    expect(results[0]!.armed).toBeNull();
    expect(results[1]!.armed).toBeNull();
    expect(results[2]!.armed).not.toBeNull();
    expect(timer.armed).toHaveLength(1);

    const [request] = await db
      .select()
      .from(unlockRequests)
      .where(eq(unlockRequests.id, unlockRequestId));
    expect(request?.status).toBe("APPROVED");
  });
});

describe("the signed request is stable across approvers", () => {
  it("produces the same bytes for every member, so signatures can be collected over days", () => {
    const request = unlockSignableRequest(
      { appId: "app-id", appSecret: "app-secret" },
      "wallet_1",
      { nonce: 0 }
    );
    // No expiry, no idempotency key, nothing that varies per signer.
    expect(request.headers).toEqual({ "privy-app-id": "app-id" });
    expect(signUnlockRequest(request, TEST_P256_KEY)).toBe(
      signUnlockRequest(request, TEST_P256_KEY)
    );
  });

  it("preserves Privy's refusal body verbatim", async () => {
    const privy = privyStub(3);
    const request = unlockSignableRequest(
      { appId: "app-id", appSecret: "app-secret" },
      "wallet_1",
      { nonce: 0 }
    );
    await expect(
      submitQuorumSignedUnlock(
        { appId: "app-id", appSecret: "app-secret", fetchImpl: privy.fetchImpl },
        request,
        ["sig-1"]
      )
    ).rejects.toMatchObject({
      status: 401,
      body: { error: expect.stringContaining("authorization threshold") }
    });
  });
});
