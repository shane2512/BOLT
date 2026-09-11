import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-verify";

// Repo-root .env, not contracts/.env — DEPLOYER_PRIVATE_KEY / DEPLOYER_ADDRESS
// live in D:\BOLT\.env alongside the rest of the app's env vars.
loadEnv({ path: resolve(__dirname, "..", ".env") });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

/**
 * Arc mainnet — parametrized, not hard-coded, because Circle has not published it.
 *
 * arc-docs, re-checked 2026-09-11 (Phase 9 day 8, not Phase 0's day-1 answer):
 *   /arc/concepts/deployment-model.mdx  — Public Testnet "Live"; Private Mainnet
 *                                         and Public Mainnet both "Upcoming"
 *   /arc/references/rpc-endpoints.mdx   — "Mainnet endpoints and parameters are
 *                                         published separately when available"
 *   /arc/references/contract-addresses.mdx — "Mainnet addresses are not [published]"
 *
 * So there is no real mainnet chain id or RPC to write down, and inventing one
 * would be worse than leaving it blank. The network entry below is the same
 * entry as `arcTestnet` with its two chain parameters lifted into env vars:
 * paste the published values into ARC_MAINNET_RPC_URL / ARC_MAINNET_CHAIN_ID and
 * `pnpm contracts:deploy:mainnet` runs contracts/scripts/deploy.ts unchanged.
 *
 * The entry only materializes once both are set — Hardhat rejects a network with
 * an empty url, and a phantom `arcMainnet` that silently points at nothing is
 * exactly the kind of thing that looks deployed and isn't.
 */
const ARC_MAINNET_RPC_URL = process.env.ARC_MAINNET_RPC_URL;
const ARC_MAINNET_CHAIN_ID = process.env.ARC_MAINNET_CHAIN_ID;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  networks: {
    arcTestnet: {
      url: "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    ...(ARC_MAINNET_RPC_URL && ARC_MAINNET_CHAIN_ID
      ? {
          arcMainnet: {
            url: ARC_MAINNET_RPC_URL,
            chainId: Number(ARC_MAINNET_CHAIN_ID),
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
          },
        }
      : {}),
  },
  // arc-docs (arc/tutorials/deploy-on-arc.mdx §4.3) documents verification via
  // Foundry's `forge verify-contract --verifier blockscout --verifier-url
  // https://testnet.arcscan.app/api/` — there is no Hardhat-specific guidance for
  // Arc in the docs. This customChains entry is adapted (not sourced verbatim)
  // from that Blockscout endpoint into @nomicfoundation/hardhat-verify's format.
  // No arcMainnet entry here: arc-docs publishes no mainnet block explorer, and a
  // guessed verifier URL would fail at exactly the wrong moment. Add one when
  // Circle publishes it — it is two lines, in the same shape as arcTestnet below.
  etherscan: {
    apiKey: {
      arcTestnet: process.env.ARCSCAN_API_KEY || "not-needed",
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
};

export default config;
