/**
 * Seeds the workflow-store copy of `acme-marketplace` (businesses + accounts)
 * from the already-real Privy provisioning in docs/evidence/phase2-state.json.
 *
 * This is deliberately NOT a re-run of phase2-provision.ts: that script creates
 * a new Privy organization and sends real BoltRegistry transactions on Arc —
 * this business is already live there. All this does is copy the real,
 * already-provisioned wallet addresses/policy ids into Postgres so
 * `/api/operator/unlock` (which looks accounts up by workflow-store UUID, not
 * by address) has a row to find. No Privy or chain calls.
 *
 *   pnpm --filter @bolt/db exec tsx scripts/seed-workflow-store.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { accounts, businesses, createDb } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const STATE_FILE = join(REPO, "docs", "evidence", "phase2-state.json");
if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} not found`);

interface Phase2Account {
  accountClass: "OPERATING" | "CLIENT_MONEY" | "OBLIGATION_RESERVE";
  label: string;
  address: string;
  policyId: string | null;
  policyHash: string | null;
}
interface Phase2State {
  provisioned: {
    slug: string;
    name: string;
    organizationId: string;
    accounts: Phase2Account[];
  };
}

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Phase2State;
const { slug, name, organizationId, accounts: realAccounts } = state.provisioned;

const db = createDb();

const existing = await db.select().from(businesses).where(eq(businesses.slug, slug));
if (existing.length > 0) {
  console.log(`"${slug}" already has a workflow-store row (${existing[0]!.id}) — nothing to do.`);
  process.exit(0);
}

const [biz] = await db
  .insert(businesses)
  .values({ slug, name, adminAddress: organizationId })
  .returning({ id: businesses.id });
console.log(`businesses: ${biz!.id} (${slug})`);

for (const a of realAccounts) {
  const [row] = await db
    .insert(accounts)
    .values({
      businessId: biz!.id,
      address: a.address,
      class: a.accountClass,
      label: a.label,
      policyId: a.policyId,
      policyHash: a.policyHash,
      yieldEnabled: false // yield was requested but refused for CLIENT_MONEY (invariant 4); reserve's real toggle isn't tracked here
    })
    .returning({ id: accounts.id });
  console.log(`  accounts: ${row!.id}  ${a.accountClass.padEnd(19)} ${a.address}`);
}

console.log("\ndone.");
