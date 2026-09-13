/**
 * Onboards one real beneficiary email: pregenerates a Privy wallet for it
 * (FR-8.1 — reuses the Privy user if one already exists for the email) and
 * writes the workflow-store row so /api/beneficiary/claim can find it. No
 * policy widening here — that's a separate, deliberate step
 * (permitBeneficiary), run only when actually testing a withdrawal.
 *
 *   pnpm --filter @bolt/privy exec tsx scripts/add-beneficiary.ts <email>
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { eq } from "drizzle-orm";
import { businesses, createDb } from "@bolt/db";
import { pregenerateBeneficiaryWallet, persistBeneficiary } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const email = process.argv[2];
if (!email) throw new Error("usage: add-beneficiary.ts <email>");

const SLUG = "acme-marketplace";
const db = createDb();

const [business] = await db.select().from(businesses).where(eq(businesses.slug, SLUG));
if (!business) throw new Error(`no workflow-store row for "${SLUG}" — run seed-workflow-store.ts first`);

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});

console.log(`pregenerating a wallet for ${email} ...`);
const pregenerated = await pregenerateBeneficiaryWallet(privy, email);
console.log(`  ${pregenerated.reused ? "reused existing" : "created new"} Privy user: ${pregenerated.privyUserId}`);
console.log(`  address: ${pregenerated.address}`);

const row = await persistBeneficiary(db, business.id, pregenerated);
console.log(`\nbeneficiaries: ${row.id}  ${email}  ${pregenerated.address}`);
console.log(`explorer: https://testnet.arcscan.app/address/${pregenerated.address}`);
