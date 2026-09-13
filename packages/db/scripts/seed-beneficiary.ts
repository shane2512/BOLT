/**
 * Seeds the workflow-store beneficiary row from the already-real pregenerated
 * Privy wallet in docs/evidence/phase8-pregenerated-wallet.json — same
 * reasoning as seed-workflow-store.ts: this wallet and its balance are real,
 * already on Arc testnet; this only copies the reference into Postgres so
 * /api/beneficiary/claim (which looks a beneficiary up by business+email, not
 * by address) has a row to find. No Privy or chain calls.
 *
 *   pnpm --filter @bolt/db exec tsx scripts/seed-beneficiary.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { eq, and } from "drizzle-orm";
import { beneficiaries, businesses, createDb } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const EVIDENCE = join(REPO, "docs", "evidence", "phase8-pregenerated-wallet.json");
if (!existsSync(EVIDENCE)) throw new Error(`${EVIDENCE} not found`);

const wallet = JSON.parse(readFileSync(EVIDENCE, "utf8")) as {
  email: string;
  privy_user_id: string;
  address: string;
};

const SLUG = "acme-marketplace";
const db = createDb();

const [business] = await db.select().from(businesses).where(eq(businesses.slug, SLUG));
if (!business) throw new Error(`no workflow-store row for "${SLUG}" — run seed-workflow-store.ts first`);

const email = wallet.email.trim().toLowerCase();
const existing = await db
  .select()
  .from(beneficiaries)
  .where(and(eq(beneficiaries.businessId, business.id), eq(beneficiaries.email, email)));

if (existing.length > 0) {
  console.log(`"${email}" already has a beneficiary row (${existing[0]!.id}) — nothing to do.`);
  process.exit(0);
}

const [row] = await db
  .insert(beneficiaries)
  .values({
    businessId: business.id,
    email,
    privyUserId: wallet.privy_user_id,
    walletAddress: wallet.address
  })
  .returning({ id: beneficiaries.id });

console.log(`beneficiaries: ${row!.id}  ${email}  ${wallet.address}`);
console.log("\ndone. Note: no obligation row was seeded, so the claim page will honestly show $0 owed");
console.log("until a real deposit creates one — ask if you want that too.");
