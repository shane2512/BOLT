import { defineChain } from "viem";

/**
 * Arc testnet. Values from arc-docs (/arc/references/connect-to-arc.mdx).
 *
 * USDC is Arc's native gas token *and* an ERC-20 at the address below, over the
 * same underlying balance. That is why every locked-account policy must pin both
 * `ethereum_transaction.to == USDC` and `ethereum_transaction.value == 0`.
 */
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.io";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as const;

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" }
  },
  testnet: true
});
