/**
 * Deletes a beneficiary's stored Selfie Check verifications, so the next
 * claim attempt is treated as first-time again.
 *
 * This is a rehearsal tool, not a product feature: FR-8.8 (packages/privy/src/
 * beneficiary.ts, selfieCheckRequirement) deliberately skips a fresh check on
 * a repeat withdrawal to an address already verified — that's a real,
 * intentional invariant (CLAUDE.md invariant 7's stated exception), not a bug.
 * For a demo take that wants to show the check happening every time, run this
 * between takes rather than changing that logic — the flow you'd be showing
 * otherwise (skip-if-verified) is real too, just a different real moment.
 *
 *   pnpm --filter @bolt/db exec tsx scripts/reset-beneficiary-verification.ts <email>
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { beneficiaries, beneficiaryVerifications, businesses, createDb } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("usage: reset-beneficiary-verification.ts <email>");

const SLUG = "acme-marketplace";
const db = createDb();

const [business] = await db.select().from(businesses).where(eq(businesses.slug, SLUG));
if (!business) throw new Error(`no workflow-store row for "${SLUG}"`);

const [beneficiary] = await db
  .select()
  .from(beneficiaries)
  .where(and(eq(beneficiaries.businessId, business.id), eq(beneficiaries.email, email)));
if (!beneficiary) throw new Error(`no beneficiary row for ${email}`);

const deleted = await db
  .delete(beneficiaryVerifications)
  .where(eq(beneficiaryVerifications.beneficiaryId, beneficiary.id))
  .returning({ id: beneficiaryVerifications.id });

console.log(`removed ${deleted.length} verification(s) for ${email} — next claim will ask for a fresh Selfie Check.`);
