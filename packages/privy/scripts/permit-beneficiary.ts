/**
 * FR-2.6 / FR-8.3 — widens the CLIENT_MONEY policy to admit one payee
 * address, through the real key quorum (invariant 3: no unsigned path).
 * This is the actual "unlock the lock a little" moment for a beneficiary
 * payout to reach the enclave at all — the CLIENT_MONEY policy default-denies
 * everything not already on its permitted list.
 *
 *   pnpm --filter @bolt/privy exec tsx scripts/permit-beneficiary.ts <address>
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrivyClient } from "@privy-io/node";
import { getAddress } from "viem";
import { permitBeneficiary } from "../src/index.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const payee = process.argv[2];
if (!payee) throw new Error("usage: permit-beneficiary.ts <address>");
getAddress(payee); // throws on a malformed address before touching Privy

const CLIENT_MONEY_POLICY_ID = "ufrjjsolxvvmf4uwiw6yl9h9"; // docs/evidence/phase2-state.json
const KEY_QUORUM_ID = "pwwre68io5ufavny68fasb6p"; // same

const privy = new PrivyClient({
  appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
  appSecret: need("PRIVY_APP_SECRET")
});

const result = await permitBeneficiary(privy, {
  policyId: CLIENT_MONEY_POLICY_ID,
  payee,
  spec: {
    name: "Acme Marketplace — Client money",
    usdcAddress: need("USDC_ADDRESS"),
    chainId: Number(need("ARC_CHAIN_ID")),
    ownerKeyQuorumId: KEY_QUORUM_ID
  },
  authorizationPrivateKeys: [need("PRIVY_AUTHORIZATION_KEY")]
});

console.log(`permitted: ${result.permitted}`);
console.log(`rules after:\n${result.ruleNamesAfter.join("\n")}`);
