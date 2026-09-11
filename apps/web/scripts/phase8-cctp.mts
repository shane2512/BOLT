/**
 * FR-8.4 — CCTP withdrawal off Arc, proven end to end.
 *
 * The same `kit.bridge()` call the beneficiary's "Withdraw to another chain"
 * button makes (`apps/web/src/app/claim/WithdrawToChain.tsx`). The **only**
 * difference is the adapter's signer: the button wraps the beneficiary's Privy
 * embedded wallet as an EIP-1193 provider, which needs a browser session and an
 * emailed one-time code; this script uses a private-key adapter so the route
 * itself — Arc Testnet → CCTP burn → Circle attestation → mint on the
 * destination — can be verified from a terminal.
 *
 * Arc's App Kit is doing the work: `@circle-fin/bridge-kit` "abstracts the
 * underlying CCTP flow so you can bridge without orchestrating the low-level
 * burn, attestation, and mint steps yourself" (arc-docs /app-kit/bridge), and
 * `ArcTestnet` is a first-class chain in it, carrying CCTP domain 26 and the v2
 * TokenMessenger addresses.
 *
 * No `CIRCLE_API_KEY` is involved. arc-docs documents an API key as optional
 * (and only for Swap, or for the Circle Wallets adapter); Bridge with a viem
 * adapter needs none, which is why FR-8.4 did not have to be cut.
 *
 *   pnpm --filter @bolt/web phase8:cctp [--to Base_Sepolia] [--amount 0.50]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { ArcTestnet } from "@circle-fin/bridge-kit/chains";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { privateKeyToAccount } from "viem/accounts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "evidence");
loadEnv({ path: join(REPO, ".env") });

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in ${join(REPO, ".env")}`);
  return v;
};

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const DESTINATION = arg("--to", "Base_Sepolia");
const AMOUNT = arg("--amount", "0.50");

const privateKey = need("DEPLOYER_PRIVATE_KEY");
const address = privateKeyToAccount(privateKey as `0x${string}`).address;

console.log(`bridging ${AMOUNT} USDC  Arc_Testnet -> ${DESTINATION}`);
console.log(`signer  : ${address}`);
console.log(`cctp    : domain ${ArcTestnet.cctp.domain}, v2 TokenMessenger ${ArcTestnet.cctp.contracts.v2.tokenMessenger}`);

const adapter = createViemAdapterFromPrivateKey({ privateKey });
const kit = new BridgeKit();

// Step payloads carry BigInts. A plain JSON.stringify in this handler throws,
// and the kit catches handler errors *into the step*, so a bug here surfaces as
// `approve: state error, "Do not know how to serialize a BigInt"` and reads like
// an SDK failure. Serialize with a replacer.
const safe = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)) ?? "";

const steps: { method: string; values: unknown }[] = [];
kit.on("*", (payload: { method?: string; values?: unknown }) => {
  console.log(`  ${payload.method}`, safe(payload.values ?? {}).slice(0, 240));
  steps.push({ method: payload.method ?? "?", values: JSON.parse(safe(payload.values ?? null)) });
});

let result: unknown = null;
let error: unknown = null;
try {
  // No `address`: a user-controlled adapter resolves it from the connected
  // wallet and rejects the field outright ("Address should not be provided for
  // user-controlled adapters"). Undocumented on the bridge page, whose examples
  // pass `{ adapter, chain }` — which is in fact the correct shape.
  result = await kit.bridge({
    from: { adapter, chain: ArcTestnet },
    to: { adapter, chain: DESTINATION },
    amount: AMOUNT,
    token: "USDC"
  } as never);
  console.log(`\nstate: ${(result as { state?: string }).state}`);
} catch (e) {
  error = e instanceof Error ? { name: e.name, message: e.message } : String(e);
  console.log(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
}

if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  join(EVIDENCE, "phase8-cctp.json"),
  JSON.stringify(
    {
      requirement:
        "FR-8.4 (MAY) — withdrawal to another chain via CCTP, initiated from one button. Also " +
        "BOLT's Arc App Kit integration: @circle-fin/bridge-kit is Arc's Bridge App Kit.",
      app_kit: {
        package: "@circle-fin/bridge-kit",
        doc: "arc-docs /app-kit and /app-kit/bridge",
        why_here:
          "The payout out of a locked account is signed in Privy's enclave against a policy that " +
          "decodes transfer._to; handing that transaction to another SDK to build would move the " +
          "exact calldata the policy checks away from the file responsible for it, for no gain. " +
          "The App Kit sits on the beneficiary's own leg instead: once the money is theirs, " +
          "moving it off Arc is a bridging problem, and hand-rolling CCTP's burn -> attestation " +
          "-> mint is precisely what an App Kit exists to remove.",
        circle_api_key_required: false
      },
      route: {
        from: { chain: "Arc_Testnet", chain_id: ArcTestnet.chainId, usdc: ArcTestnet.usdcAddress },
        to: DESTINATION,
        amount: AMOUNT,
        cctp_domain: ArcTestnet.cctp.domain,
        cctp_v2: ArcTestnet.cctp.contracts.v2
      },
      signer: {
        address,
        note:
          "A private-key adapter, so the route is verifiable from a terminal. The claim page's " +
          "button uses createViemAdapterFromProvider over the beneficiary's Privy embedded " +
          "wallet — same kit.bridge() call, different signer."
      },
      steps,
      result,
      error
    },
    (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    2
  ) + "\n"
);
console.log("   -> docs/evidence/phase8-cctp.json");
