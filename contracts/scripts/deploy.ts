import hre from "hardhat";

// Deploys BoltRegistry to arcTestnet. Constructor arg = DEPLOYER_ADDRESS as the
// initial `recorder` (pre-switch plan; the splitter's address replaces it later
// via setRecorder, per docs/PHASES.md Phase 1).
async function main() {
  const deployerAddress = process.env.DEPLOYER_ADDRESS;
  if (!deployerAddress) {
    throw new Error("DEPLOYER_ADDRESS not set — check D:\\BOLT\\.env");
  }

  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const artifact = await hre.artifacts.readArtifact("BoltRegistry");

  const hash = await deployer.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [deployerAddress as `0x${string}`],
  });

  console.log("Deployment tx hash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);
  console.log("BoltRegistry deployed to:", receipt.contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
