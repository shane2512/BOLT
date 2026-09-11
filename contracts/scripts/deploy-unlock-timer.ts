import hre from "hardhat";

// Deploys BoltUnlockTimer to arcTestnet (FR-5.4). Constructor arg = the same
// recorder EOA BoltRegistry uses, so one key drives both records.
//
//   pnpm --filter @bolt/contracts exec hardhat run scripts/deploy-unlock-timer.ts --network arcTestnet
//
// Put the resulting address in .env as UNLOCK_TIMER_ADDRESS.
async function main() {
  const recorder = process.env.DEPLOYER_ADDRESS;
  if (!recorder) {
    throw new Error("DEPLOYER_ADDRESS not set — check D:\\BOLT\\.env");
  }

  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const artifact = await hre.artifacts.readArtifact("BoltUnlockTimer");

  const hash = await deployer.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [recorder as `0x${string}`],
  });
  console.log("Deployment tx hash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);
  console.log("BoltUnlockTimer deployed to:", receipt.contractAddress);

  // Read the constant back off the deployed bytecode — the point of the whole
  // contract is that this number is not ours to change after the fact.
  const delay = await publicClient.readContract({
    address: receipt.contractAddress as `0x${string}`,
    abi: artifact.abi,
    functionName: "UNLOCK_DELAY",
  });
  console.log("UNLOCK_DELAY (seconds, read from chain):", delay);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
