/**
 * FR-3.2 — **never delete this file.**
 *
 * Privy delivers webhooks at least once. A redelivered deposit that splits twice
 * pays a seller twice out of money that arrived once, and the shortfall shows up
 * as a coverage hole days later. Idempotency is not a nicety here; it is the
 * difference between the public page being true and being wrong.
 *
 * Runs against PGlite (in-memory WASM Postgres) rather than the real database —
 * production targets `DATABASE_URL`, but a unit test must not need a
 * network-reachable Postgres. Same schema, same drizzle writer, and crucially
 * the same `deposits_tx_log_idx` unique index doing the actual work.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  accounts as accountsTable,
  alerts,
  businesses,
  deposits,
  splits,
  type BoltDb
} from "@bolt/db";
import { usdc, type RegistryWriter } from "@bolt/core";
import {
  executeSplit,
  getActiveMandate,
  handleDepositWebhook,
  loadAccounts,
  publishMandate,
  recordDeposit,
  type SplitterConfig
} from "./splitter.js";
import { buildSplitterSignerPolicy } from "./splitter-policy.js";
import { assertConstrainsDecodedRecipient } from "./policy-builder.js";

const SCHEMA_SQL = fileURLToPath(
  new URL("../../db/drizzle/0000_swift_cardiac.sql", import.meta.url)
);

const USDC = "0x3600000000000000000000000000000000000000";
const CHAIN_ID = 5042002;
const TX = "0x" + "ab".repeat(32);
const OPERATING = "0x" + "e0".repeat(20);
const CLIENT = "0x" + "0e".repeat(20);
const RESERVE = "0x" + "3b".repeat(20);

let db: BoltDb;
let businessId: string;
let accountIds: Record<string, string>;

async function seed(): Promise<void> {
  const client = new PGlite();
  const raw = drizzle(client);
  for (const statement of readFileSync(SCHEMA_SQL, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await client.exec(statement);
  }
  db = raw as unknown as BoltDb;

  const [business] = await db
    .insert(businesses)
    .values({ slug: "acme", name: "Acme", adminAddress: "0x" + "11".repeat(20) })
    .returning({ id: businesses.id });
  businessId = business!.id;

  const rows = await db
    .insert(accountsTable)
    .values([
      { businessId, address: OPERATING, class: "OPERATING", label: "Operating" },
      { businessId, address: CLIENT, class: "CLIENT_MONEY", label: "Client money" },
      { businessId, address: RESERVE, class: "OBLIGATION_RESERVE", label: "Sales tax" }
    ])
    .returning({ id: accountsTable.id, class: accountsTable.class });
  accountIds = Object.fromEntries(rows.map((r) => [r.class, r.id]));

  await publishMandate(db, {
    businessId,
    version: 1,
    rulesHash: "0x" + "cc".repeat(32),
    quorumRef: "0x" + "dd".repeat(32),
    rules: [
      { destinationAccountId: accountIds.CLIENT_MONEY!, bps: 8800, description: "88% seller" },
      { destinationAccountId: accountIds.OBLIGATION_RESERVE!, bps: 400, description: "4% tax" },
      { destinationAccountId: accountIds.OPERATING!, bps: 800, description: "8% operating" }
    ]
  });
}

beforeEach(seed);

const depositArgs = (logIndex = 3) => ({
  businessId,
  accountId: accountIds.OPERATING!,
  txHash: TX,
  logIndex,
  amount: usdc(10_000_000n),
  mandateVersion: 1
});

describe("FR-3.2 — idempotent on (txHash, logIndex)", () => {
  it("records a deposit once; the identical redelivery is not new", async () => {
    const first = await recordDeposit(db, depositArgs());
    expect(first.isNew).toBe(true);

    const replay = await recordDeposit(db, depositArgs());
    expect(replay.isNew).toBe(false);
    expect(replay.deposit.id).toBe(first.deposit.id);

    const rows = await db.select().from(deposits);
    expect(rows).toHaveLength(1);
  });

  it("treats a different log in the same transaction as a different deposit", async () => {
    await recordDeposit(db, depositArgs(3));
    const other = await recordDeposit(db, depositArgs(4));
    expect(other.isNew).toBe(true);
    expect(await db.select().from(deposits)).toHaveLength(2);
  });

  it("replaying the webhook produces no second split", async () => {
    const registry = fakeRegistry();
    const privy = fakePrivy();
    const deps = webhookDeps(privy, registry);

    const first = await handleDepositWebhook(deps, signedRequest());
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const splitsAfterFirst = await db.select().from(splits);
    expect(splitsAfterFirst).toHaveLength(3);
    const signedAfterFirst = privy.signCalls.length;
    expect(signedAfterFirst).toBe(2); // the OPERATING share never moves

    const replay = await handleDepositWebhook(deps, signedRequest());
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    // The only things that matter: no new split rows, and no new signature
    // requests. A second signature is a second payment.
    expect(await db.select().from(splits)).toHaveLength(3);
    expect(privy.signCalls).toHaveLength(signedAfterFirst);
  });

  it("refuses to act on a payload whose signature does not verify", async () => {
    const privy = fakePrivy({ verifyThrows: true });
    const result = await handleDepositWebhook(webhookDeps(privy, fakeRegistry()), signedRequest());
    expect(result.status).toBe(401);
    expect(await db.select().from(deposits)).toHaveLength(0);
    expect(privy.signCalls).toHaveLength(0);
  });
});

describe("FR-3.4 — the mandate version is fixed at receipt time", () => {
  it("stores the active version on the deposit row", async () => {
    await handleDepositWebhook(webhookDeps(fakePrivy(), fakeRegistry()), signedRequest());
    const [row] = await db.select().from(deposits);
    expect(row!.mandateVersion).toBe(1);

    // A later mandate does not retroactively change the recorded version.
    await publishMandate(db, {
      businessId,
      version: 2,
      rulesHash: "0x" + "ee".repeat(32),
      quorumRef: "0x" + "ff".repeat(32),
      rules: [
        { destinationAccountId: accountIds.CLIENT_MONEY!, bps: 10_000, description: "all seller" }
      ]
    });
    expect((await getActiveMandate(db, businessId))!.version).toBe(2);
    const [unchanged] = await db.select().from(deposits);
    expect(unchanged!.mandateVersion).toBe(1);
  });
});

describe("FR-3.8 — a failed split fails loudly", () => {
  it("leaves the money visibly unallocated and raises a SEVERE alert", async () => {
    const privy = fakePrivy({ refuseTo: CLIENT });
    const { deposit } = await recordDeposit(db, depositArgs());
    const result = await executeSplit(
      privy as never,
      db,
      fakeRegistry(),
      splitterConfig(),
      deposit,
      (await getActiveMandate(db, businessId))!,
      await loadAccounts(db, businessId)
    );

    expect(result.unallocated).toBe(8_800_000n);
    const [failed] = await db
      .select()
      .from(splits)
      .where(eq(splits.accountId, accountIds.CLIENT_MONEY!));
    expect(failed!.txHash).toBeNull(); // unallocated, not quietly dropped

    const [alert] = await db.select().from(alerts);
    expect(alert!.severity).toBe("SEVERE");
    expect(alert!.kind).toBe("SPLIT_FAILURE");
  });
});

describe("FR-3.3 — the splitter's own policy", () => {
  it("permits only this business's own accounts, and constrains transfer._to", () => {
    const policy = buildSplitterSignerPolicy({
      businessName: "Acme",
      ownAccountAddresses: [OPERATING, CLIENT, RESERVE],
      usdcAddress: USDC,
      chainId: CHAIN_ID,
      ownerKeyQuorumId: "kq_test"
    });

    // The FR-2.1 guard applies to this policy too — a splitter policy without a
    // decoded-recipient condition would let a compromised splitter pay anyone.
    expect(() => assertConstrainsDecodedRecipient(policy)).not.toThrow();

    const allowed = policy.rules
      .filter((r) => r.action === "ALLOW")
      .flatMap((r) =>
        r.conditions
          .filter((c) => c.field === "transfer._to")
          .flatMap((c) => c.value as string[])
      )
      .map((a) => a.toLowerCase());
    expect(new Set(allowed)).toEqual(new Set([OPERATING, CLIENT, RESERVE]));
    expect(allowed).not.toContain("0x" + "99".repeat(20));
  });

  it("refuses to build a splitter with no permitted destinations", () => {
    expect(() =>
      buildSplitterSignerPolicy({
        businessName: "Acme",
        ownAccountAddresses: [],
        usdcAddress: USDC,
        chainId: CHAIN_ID,
        ownerKeyQuorumId: "kq_test"
      })
    ).toThrow(/cannot split/);
  });
});

// ---------------------------------------------------------------------------
// Doubles. Privy and Arc are exercised live in scripts/phase3-split.ts; here the
// point is the database behaviour, so the network is stubbed.
// ---------------------------------------------------------------------------

function splitterConfig(): SplitterConfig {
  return {
    sourceWalletId: "wallet_operating",
    sourceAddress: OPERATING,
    splitterAuthorizationKey: "splitter-key",
    usdcAddress: USDC,
    chainId: CHAIN_ID,
    onChainBusinessId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    beneficiaryRefFor: () => ("0x" + "bb".repeat(32)) as `0x${string}`
  };
}

function fakePrivy(opts: { verifyThrows?: boolean; refuseTo?: string } = {}) {
  const signCalls: { to: string }[] = [];
  return {
    signCalls,
    webhooks: () => ({
      verify: () => {
        if (opts.verifyThrows) throw new Error("Webhook verification failed");
        return payload();
      }
    }),
    wallets: () => ({
      ethereum: () => ({
        signTransaction: (_walletId: string, params: { params: { transaction: { data: string } } }) => {
          const to = "0x" + params.params.transaction.data.slice(34, 74);
          signCalls.push({ to });
          if (opts.refuseTo && to.toLowerCase() === opts.refuseTo.toLowerCase()) {
            const error = new Error('400 {"error":{"code":"policy_violation"}}');
            error.name = "BadRequestError";
            throw error;
          }
          return Promise.resolve({ signed_transaction: "0x02f8" });
        }
      })
    })
  };
}

function fakeRegistry(): RegistryWriter {
  const receipt = (event: string) =>
    Promise.resolve({
      transactionHash: ("0x" + event.length.toString(16).padStart(2, "0").repeat(32)) as `0x${string}`,
      status: "success"
    } as never);
  return {
    address: "0x0",
    getTransactionCount: () => Promise.resolve(0),
    estimateFeesPerGas: () => Promise.resolve({ maxFeePerGas: 1n, maxPriorityFeePerGas: 0n }),
    recordAccountRegistered: () => receipt("AccountRegistered"),
    recordPolicyRotated: () => receipt("PolicyRotated"),
    recordBusinessRegistered: () => receipt("BusinessRegistered"),
    recordDepositObserved: () => receipt("DepositObserved"),
    recordSplitExecuted: () => receipt("SplitExecuted"),
    recordObligationAccrued: () => receipt("ObligationAccrued")
  } as unknown as RegistryWriter;
}

function payload() {
  return {
    type: "wallet.funds_deposited",
    wallet_id: "wallet_operating",
    idempotency_key: "evt_1",
    caip2: `eip155:${CHAIN_ID}`,
    asset: { type: "erc20", address: USDC },
    amount: "10000000",
    transaction_hash: TX,
    sender: "0x" + "77".repeat(20),
    recipient: OPERATING,
    block: { number: 1, timestamp: 1 }
  };
}

function signedRequest() {
  return {
    rawBody: JSON.stringify(payload()),
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": "1",
      "svix-signature": "v1,fake"
    }
  };
}

function webhookDeps(privy: ReturnType<typeof fakePrivy>, registry: RegistryWriter) {
  return {
    privy: privy as never,
    db,
    registry,
    usdcAddress: USDC,
    chainId: CHAIN_ID,
    // The chain lookup that resolves the log index is stubbed here; the live
    // run in scripts/phase3-split.ts exercises the real one.
    async resolveTarget() {
      const accountsById = await loadAccounts(db, businessId);
      return {
        businessId,
        onChainBusinessId: ("0x" + "aa".repeat(32)) as `0x${string}`,
        account: accountsById.get(accountIds.OPERATING!)!,
        accountsById,
        cfg: splitterConfig()
      };
    }
  };
}

// `resolveDepositLog` calls Arc. Stub the RPC so these tests stay offline; the
// log index it returns is the one the fixture claims.
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionReceipt: () => Promise.resolve({ logs: [] }),
      getTransactionCount: () => Promise.resolve(0),
      estimateFeesPerGas: () => Promise.resolve({ maxFeePerGas: 1n, maxPriorityFeePerGas: 0n }),
      waitForTransactionReceipt: () => Promise.resolve({ status: "success" }),
      sendRawTransaction: () => Promise.resolve("0x" + "12".repeat(32))
    })
  };
});
