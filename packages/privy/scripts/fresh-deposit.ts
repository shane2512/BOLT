/**
 * One-off: send a genuinely fresh USDC transfer from the deployer EOA to the
 * OPERATING account, so phase3-split.ts's cached fundingTxHash (and therefore
 * its derived depositId/obligationId) is a real, new deposit rather than the
 * same cached one being overwritten. Prints the new tx hash so it can be
 * written into docs/evidence/phase3-state.json before re-running phase3-split.
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config as loadEnv } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const RPC = process.env.ARC_RPC_URL!;
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID);
const USDC = getAddress(process.env.USDC_ADDRESS!);
const OPERATING = getAddress("0xe0D6fc2FDb556a26C173C6E5FA90d6B5283fF060");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`);

const chain = { id: CHAIN_ID, name: "arc-testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const publicClient = createPublicClient({ chain, transport: http(RPC) });

const AMOUNT = 10_000_000n; // 10.00 USDC

const data = encodeFunctionData({
  abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "_to", type: "address" }, { name: "_value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
  functionName: "transfer",
  args: [OPERATING, AMOUNT]
});

const hash = await wallet.sendTransaction({ to: USDC, data, value: 0n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(JSON.stringify({ hash, status: receipt.status, blockNumber: receipt.blockNumber.toString() }, null, 2));
