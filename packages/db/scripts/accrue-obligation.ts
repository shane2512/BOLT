/**
 * Accrues one real obligation for one beneficiary — on chain AND in
 * Postgres. The splitter's own production path (packages/privy/src/
 * splitter.ts) creates obligations from a deposit but never assigns them to
 * a specific beneficiary — that assignment isn't wired into a real flow yet,
 * so the Postgres row is inserted by hand, same as beneficiary.test.ts's
 * fixture does for tests. What must NOT be skipped is the on-chain half:
 * `/api/beneficiary/claim`'s withdraw path reads `obligations.txRef` as the
 * on-chain obligationId and calls `recordObligationSettled(obligationId,
 * ...)` after the real transfer — if no matching `ObligationAccrued` was
 * ever recorded, that call reverts with "unknown obligation" *after* the
 * money has already moved, leaving Postgres inconsistent with the chain.
 * (Found the hard way — see docs/evidence if this gets written up.)
 *
 * Run fund-client-money.ts (or equivalent) first so `amount` never exceeds
 * the account's real surplus — this script does not check that for you.
 *
 *   pnpm --filter @bolt/db exec tsx scripts/accrue-obligation.ts <email> <amountBaseUnits> <fundingTxHash> <fundingLogIndex>
 *
 * <fundingTxHash>/<fundingLogIndex> identify the real USDC Transfer event
 * that funded the CLIENT_MONEY account for this obligation (find it with
 * `getLogs` on the USDC contract, event Transfer, to: the CLIENT_MONEY
 * address) — the same (depositId, account) pair the real splitter would
 * derive an obligationId from.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { businessIdOf, depositIdOf, obligationIdOf, createRegistryWriter } from "@bolt/core";
import { accounts, beneficiaries, businesses, obligations, createDb } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const email = process.argv[2]?.trim().toLowerCase();
const amount = BigInt(process.argv[3] ?? "0");
const fundingTxHash = process.argv[4];
const fundingLogIndex = Number(process.argv[5]);
if (!email || amount <= 0n || !fundingTxHash || Number.isNaN(fundingLogIndex)) {
  throw new Error("usage: accrue-obligation.ts <email> <amountBaseUnits> <fundingTxHash> <fundingLogIndex>");
}

const SLUG = "acme-marketplace";
const db = createDb();

const [business] = await db.select().from(businesses).where(eq(businesses.slug, SLUG));
if (!business) throw new Error(`no workflow-store row for "${SLUG}"`);

const [beneficiary] = await db
  .select()
  .from(beneficiaries)
  .where(and(eq(beneficiaries.businessId, business.id), eq(beneficiaries.email, email)));
if (!beneficiary) throw new Error(`no beneficiary row for ${email} — run add-beneficiary.ts first`);

const [account] = await db
  .select()
  .from(accounts)
  .where(and(eq(accounts.businessId, business.id), eq(accounts.class, "CLIENT_MONEY")));
if (!account) throw new Error("no CLIENT_MONEY account on record");

const depositId = depositIdOf(fundingTxHash, fundingLogIndex);
const obligationId = obligationIdOf(depositId, account.address);

const registry = createRegistryWriter({
  registryAddress: need("REGISTRY_ADDRESS") as `0x${string}`,
  recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as `0x${string}`,
  rpcUrl: process.env.ARC_RPC_URL
});
const receipt = await registry.recordObligationAccrued({
  businessId: businessIdOf(SLUG),
  obligationId,
  account: account.address as `0x${string}`,
  beneficiaryRef: `0x${beneficiary.id.replace(/-/g, "").padStart(64, "0")}` as `0x${string}`,
  amount
});
console.log(`ObligationAccrued: ${receipt.transactionHash} (${receipt.status})`);

const [row] = await db
  .insert(obligations)
  .values({
    businessId: business.id,
    accountId: account.id,
    beneficiaryId: beneficiary.id,
    amount,
    status: "OUTSTANDING",
    txRef: obligationId // read back as the on-chain obligationId until settled
  })
  .returning({ id: obligations.id });

console.log(`obligations: ${row!.id}  ${email}  ${amount} base units against ${account.address}`);
