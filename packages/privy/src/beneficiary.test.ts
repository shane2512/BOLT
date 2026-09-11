/**
 * FR-8.6 / FR-8.7 / FR-8.8 — **never delete this file.**
 *
 * Three of Phase 8's exit criteria are claims about *when a Selfie Check is
 * asked for*, and one of them (FR-8.8) is a deliberate decision NOT to ask.
 * That pairing is exactly what rots: someone widens FR-8.8 from "this address,
 * this device" to "this person has verified before" to smooth the flow, every
 * happy path still passes, and the anti-account-takeover control quietly becomes
 * a one-time formality.
 *
 * So this file asserts the decision table directly, and asserts that a payout
 * cannot reach Privy at all while a check is outstanding. The stub Privy records
 * whether it was reached; if the World gate ever stops short of preventing that,
 * these tests fail.
 *
 * PGlite (in-memory WASM Postgres), same schema and same unique indexes as
 * production — direct Postgres is unreachable from this sandbox.
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
  beneficiaries,
  beneficiaryVerifications,
  businesses,
  obligations,
  type BoltDb
} from "@bolt/db";
import {
  SelfieCheckError,
  usdc,
  type RegistryWriter,
  type SelfieCheckConfig
} from "@bolt/core";
import {
  SelfieCheckRequiredError,
  beneficiaryClaimSignal,
  payoutToBeneficiary,
  permitBeneficiary,
  recordBeneficiaryVerification,
  selfieCheckRequirement
} from "./beneficiary.js";

const MIGRATIONS = [
  "0000_swift_cardiac.sql",
  "0001_organic_wendell_vaughn.sql",
  "0002_tense_ken_ellis.sql",
  "0003_wandering_the_stranger.sql"
].map((f) => fileURLToPath(new URL(`../../db/drizzle/${f}`, import.meta.url)));

const CLIENT_MONEY = "0x" + "0e".repeat(20);
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const ADDRESS_A = "0x" + "a1".repeat(20);
const ADDRESS_B = "0x" + "b2".repeat(20);
const DEVICE_A = "device-a";
const DEVICE_B = "device-b";
const NULLIFIER_1 = "0x1f0d3c2b1a09876543210fedcba9876543210fedcba9876543210fedcba98765";
const NULLIFIER_2 = "0x0abc000000000000000000000000000000000000000000000000000000000002";
const ACTION = "bolt-beneficiary-claim";

/** A Selfie Check result shaped as IDKit returns it (world-docs, World ID 3.0). */
const idkitResult = (nullifier: string, signalHash: string) => ({
  protocol_version: "3.0",
  nonce: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  action: ACTION,
  environment: "sandbox",
  responses: [
    {
      identifier: "selfie",
      signal_hash: signalHash,
      proof: "0x1a2b3c",
      merkle_root: "0x0abc123",
      nullifier
    }
  ],
  user_presence_completed: true
});

function worldFetch(verdict: "verified" | "refused", nullifier: string) {
  return vi.fn(async () => {
    if (verdict === "refused") {
      return new Response(
        JSON.stringify({ success: false, code: "invalid_proof", detail: "Proof is invalid." }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        results: [{ identifier: "selfie", success: true, nullifier }],
        action: ACTION,
        nullifier,
        created_at: "2026-09-10T00:00:00Z",
        environment: "sandbox"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

const worldConfig = (verdict: "verified" | "refused", nullifier: string): SelfieCheckConfig => ({
  rpId: "rp_test",
  action: ACTION,
  fetchImpl: worldFetch(verdict, nullifier) as unknown as typeof fetch
});

/**
 * Privy, recording whether the signing path was reached at all, and echoing
 * created rules back from `policies().get` the way the live API does — so
 * `permitBeneficiary`'s read-back is a real check and not a tautology.
 */
function privyStub(acceptRules = true) {
  const reached = { signTransaction: 0, createRule: 0 };
  const created: { name: string; conditions: { field_source: string; field: string }[] }[] = [];
  const client = {
    wallets: () => ({
      ethereum: () => ({
        signTransaction: async () => {
          reached.signTransaction += 1;
          throw new Error("stub: signing not exercised in this test");
        }
      })
    }),
    policies: () => ({
      createRule: async (_policyId: string, rule: unknown) => {
        reached.createRule += 1;
        if (acceptRules) created.push(rule as (typeof created)[number]);
        return rule;
      },
      get: async () => ({ rules: created })
    })
  } as unknown as PrivyClient;
  return { client, reached, created };
}

const registryStub = (): RegistryWriter =>
  ({
    recordObligationSettled: async () => {
      throw new Error("stub: registry not exercised in this test");
    }
  }) as unknown as RegistryWriter;

// ---------------------------------------------------------------------------

let db: BoltDb;
let businessId: string;
let accountId: string;
let beneficiaryId: string;
let obligationRowId: string;

beforeEach(async () => {
  const pg = new PGlite();
  db = drizzle(pg) as unknown as BoltDb;
  for (const file of MIGRATIONS) {
    for (const stmt of readFileSync(file, "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }

  const [biz] = await db
    .insert(businesses)
    .values({ slug: "test-co", name: "Test Co", adminAddress: CLIENT_MONEY })
    .returning({ id: businesses.id });
  businessId = biz!.id;

  const [account] = await db
    .insert(accountsTable)
    .values({ businessId, address: CLIENT_MONEY, class: "CLIENT_MONEY", label: "Client money" })
    .returning({ id: accountsTable.id });
  accountId = account!.id;

  const [beneficiary] = await db
    .insert(beneficiaries)
    .values({ businessId, email: "seller@example.com", walletAddress: ADDRESS_A })
    .returning({ id: beneficiaries.id });
  beneficiaryId = beneficiary!.id;

  const [obligation] = await db
    .insert(obligations)
    .values({ businessId, accountId, beneficiaryId, amount: 1_000_000n, status: "OUTSTANDING" })
    .returning({ id: obligations.id });
  obligationRowId = obligation!.id;
});

/** Writes a verified check straight to the ledger, as World's answer would. */
function verified(address: string, deviceId: string, nullifier = NULLIFIER_1) {
  return recordBeneficiaryVerification(db, worldConfig("verified", nullifier), {
    beneficiaryId,
    address,
    reason: "FIRST_CLAIM",
    deviceId,
    idkitResult: idkitResult(nullifier, "0xdeadbeef")
  });
}

describe("selfieCheckRequirement — FR-8.6 / FR-8.7 / FR-8.8", () => {
  it("FR-8.6: a first claim requires a check", async () => {
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_A,
      deviceId: DEVICE_A
    });
    expect(gate).toEqual({ required: true, reason: "FIRST_CLAIM" });
  });

  it("FR-8.8: a repeat withdrawal to the same address on the same device needs no fresh check", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_A,
      deviceId: DEVICE_A
    });
    expect(gate.required).toBe(false);
  });

  it("FR-8.7: changing the withdrawal address forces a fresh check", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_B,
      deviceId: DEVICE_A
    });
    expect(gate).toEqual({ required: true, reason: "ADDRESS_CHANGE" });
  });

  it("FR-8.7: an unrecognised device forces a fresh check, same address", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_A,
      deviceId: DEVICE_B
    });
    expect(gate).toEqual({ required: true, reason: "NEW_DEVICE" });
  });

  it("a missing device id is treated as unrecognised, never as verified", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_A,
      deviceId: null
    });
    expect(gate).toEqual({ required: true, reason: "NEW_DEVICE" });
  });

  it("address comparison is case-insensitive — checksummed and lowercase are one address", async () => {
    await verified(ADDRESS_A.toUpperCase().replace("0X", "0x"), DEVICE_A);
    const gate = await selfieCheckRequirement(db, {
      beneficiaryId,
      address: ADDRESS_A,
      deviceId: DEVICE_A
    });
    expect(gate.required).toBe(false);
  });
});

describe("recordBeneficiaryVerification — the World gate has no soft-fail path", () => {
  it("a refused Selfie Check writes no row", async () => {
    await expect(
      recordBeneficiaryVerification(db, worldConfig("refused", NULLIFIER_1), {
        beneficiaryId,
        address: ADDRESS_A,
        reason: "FIRST_CLAIM",
        deviceId: DEVICE_A,
        idkitResult: idkitResult(NULLIFIER_1, "0xdeadbeef")
      })
    ).rejects.toBeInstanceOf(SelfieCheckError);

    const rows = await db.select().from(beneficiaryVerifications);
    expect(rows).toHaveLength(0);
  });

  it("a proof minted for another action is refused before the round trip", async () => {
    const cfg = worldConfig("verified", NULLIFIER_1);
    const proof = { ...idkitResult(NULLIFIER_1, "0xdeadbeef"), action: "bolt-unlock-approval" };
    await expect(
      recordBeneficiaryVerification(db, cfg, {
        beneficiaryId,
        address: ADDRESS_A,
        reason: "FIRST_CLAIM",
        idkitResult: proof
      })
    ).rejects.toBeInstanceOf(SelfieCheckError);
    // Never reached World: the action mismatch is caught locally.
    expect(cfg.fetchImpl).not.toHaveBeenCalled();
  });

  it("a proof bound to another address's signal is refused (FR-8.7 anti-replay)", async () => {
    const cfg: SelfieCheckConfig = {
      ...worldConfig("verified", NULLIFIER_1),
      expectedSignalHash: "0x00000000000000000000000000000000000000000000000000000000000000aa"
    };
    await expect(
      recordBeneficiaryVerification(db, cfg, {
        beneficiaryId,
        address: ADDRESS_B,
        reason: "ADDRESS_CHANGE",
        idkitResult: idkitResult(NULLIFIER_1, "0x00000000000000000000000000000000000000000000000000000000000000bb")
      })
    ).rejects.toBeInstanceOf(SelfieCheckError);
  });

  it("the same proof cannot authorise the same address twice (unique index, not a read-then-write)", async () => {
    await verified(ADDRESS_A, DEVICE_A, NULLIFIER_1);
    await expect(verified(ADDRESS_A, DEVICE_A, NULLIFIER_1)).rejects.toThrow();
  });

  it("the same human may verify again for a different address — FR-8.7 depends on it", async () => {
    await verified(ADDRESS_A, DEVICE_A, NULLIFIER_1);
    await expect(verified(ADDRESS_B, DEVICE_A, NULLIFIER_1)).resolves.toBeDefined();
  });

  it("records the nullifier as decimal and sets the current withdrawal address", async () => {
    await verified(ADDRESS_A, DEVICE_A, NULLIFIER_2);
    const [row] = await db.select().from(beneficiaryVerifications);
    expect(row!.nullifier).toBe(BigInt(NULLIFIER_2).toString(10));
    const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, beneficiaryId));
    expect(b!.verifiedAddress).toBe(ADDRESS_A.toLowerCase());
  });
});

describe("payoutToBeneficiary — the gate runs before Privy is reached at all", () => {
  const payout = (privy: PrivyClient, address: string, deviceId: string | null) =>
    payoutToBeneficiary(
      privy,
      db,
      registryStub(),
      {
        walletId: "wallet-1",
        accountAddress: CLIENT_MONEY,
        usdcAddress: USDC_ADDRESS,
        chainId: 5042002,
        authorizationPrivateKeys: ["key"]
      },
      {
        beneficiaryId,
        obligationRowId,
        obligationId: `0x${"11".repeat(32)}`,
        amount: usdc(1_000_000n),
        destination: address,
        deviceId
      }
    );

  it("FR-8.6: a first claim without a Selfie Check does not pay out, and never reaches Privy", async () => {
    const { client, reached } = privyStub();
    await expect(payout(client, ADDRESS_A, DEVICE_A)).rejects.toBeInstanceOf(
      SelfieCheckRequiredError
    );
    expect(reached.signTransaction).toBe(0);

    const [row] = await db.select().from(obligations).where(eq(obligations.id, obligationRowId));
    expect(row!.status).toBe("OUTSTANDING");
  });

  it("FR-8.7: a verified beneficiary redirecting to a new address does not pay out", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const { client, reached } = privyStub();
    await expect(payout(client, ADDRESS_B, DEVICE_A)).rejects.toMatchObject({
      name: "SelfieCheckRequiredError",
      reason: "ADDRESS_CHANGE"
    });
    expect(reached.signTransaction).toBe(0);
  });

  it("FR-8.8: a verified address and device gets past the gate and on to the enclave", async () => {
    await verified(ADDRESS_A, DEVICE_A);
    const { client, reached } = privyStub();
    // The stub throws at signTransaction; reaching it is the assertion.
    await expect(payout(client, ADDRESS_A, DEVICE_A)).rejects.toThrow(/stub: signing/);
    expect(reached.signTransaction).toBe(1);
  });
});

describe("permitBeneficiary — invariant 3, and invariant 2 on the widening rule", () => {
  const spec = {
    name: "Test Co — Client money",
    usdcAddress: USDC_ADDRESS,
    chainId: 5042002,
    ownerKeyQuorumId: "quorum-1"
  };

  it("refuses to widen without a quorum authorization key", async () => {
    const { client, reached } = privyStub();
    await expect(
      permitBeneficiary(client, {
        policyId: "policy-1",
        payee: ADDRESS_A,
        spec,
        authorizationPrivateKeys: []
      })
    ).rejects.toThrow(/authorization signature is required/);
    expect(reached.createRule).toBe(0);
  });

  it("every rule it sends constrains the decoded transfer._to", async () => {
    const { client } = privyStub();
    const result = await permitBeneficiary(client, {
      policyId: "policy-1",
      payee: ADDRESS_A,
      spec,
      authorizationPrivateKeys: ["key"]
    });
    for (const rule of result.rules) {
      const fields = rule.conditions.map((c) => `${c.field_source}.${c.field}`);
      expect(fields).toContain("ethereum_calldata.transfer._to");
      expect(fields).toContain("ethereum_transaction.to");
      expect(fields).toContain("ethereum_transaction.value");
      expect(fields).toContain("ethereum_calldata.function_name");
    }
    expect(result.permitted).toBe(true);
  });

  it("reports permitted: false when the policy does not come back carrying the rule", async () => {
    const { client } = privyStub(false); // createRule 200s, policy stays unchanged
    const result = await permitBeneficiary(client, {
      policyId: "policy-1",
      payee: ADDRESS_A,
      spec,
      authorizationPrivateKeys: ["key"]
    });
    expect(result.permitted).toBe(false);
  });
});

describe("beneficiaryClaimSignal", () => {
  it("binds the proof to one beneficiary and one address, case-normalised", () => {
    expect(beneficiaryClaimSignal("b-1", ADDRESS_A.toUpperCase().replace("0X", "0x"))).toBe(
      `b-1:${ADDRESS_A.toLowerCase()}`
    );
    expect(beneficiaryClaimSignal("b-1", ADDRESS_A)).not.toBe(
      beneficiaryClaimSignal("b-1", ADDRESS_B)
    );
  });
});
