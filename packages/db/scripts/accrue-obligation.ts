/**
 * Accrues one real obligation for one beneficiary. The splitter's own
 * production path (packages/privy/src/splitter.ts) creates obligations from
 * a deposit but never assigns them to a specific beneficiary — that
 * assignment isn't wired into a real flow yet, so this does directly what
 * beneficiary.test.ts's fixture already does for tests: insert the workflow
 * row by hand. What's real here is the money: run fund-client-money.ts (or
 * equivalent) first so `amount` never exceeds the account's actual surplus —
 * this script refuses if it would.
 *
 *   pnpm --filter @bolt/db exec tsx scripts/accrue-obligation.ts <email> <amountBaseUnits>
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { accounts, beneficiaries, businesses, obligations, createDb } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const email = process.argv[2]?.trim().toLowerCase();
const amount = BigInt(process.argv[3] ?? "0");
if (!email || amount <= 0n) throw new Error("usage: accrue-obligation.ts <email> <amountBaseUnits>");

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

const [row] = await db
  .insert(obligations)
  .values({ businessId: business.id, accountId: account.id, beneficiaryId: beneficiary.id, amount, status: "OUTSTANDING" })
  .returning({ id: obligations.id });

console.log(`obligations: ${row!.id}  ${email}  ${amount} base units against ${account.address}`);
