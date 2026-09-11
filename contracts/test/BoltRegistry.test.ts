import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
import { getAddress, keccak256, numberToHex, toBytes, type Address } from "viem";

chai.use(chaiAsPromised);

// Port of contracts/test/BoltRegistry.t.sol (Foundry) — same four cases,
// same fixture values, ported to hardhat-toolbox-viem. See CLAUDE.md Phase 1
// exit criterion: "a test emits and reads back one event of every type".

const ACCOUNT_CLASS = { OPERATING: 0, CLIENT_MONEY: 1, OBLIGATION_RESERVE: 2 } as const;

/** address(0xN) in Solidity — an arbitrary 20-byte constant, not a signer. */
const addr = (n: number): Address => getAddress(numberToHex(BigInt(n), { size: 20 }));

const businessId = keccak256(toBytes("business-1"));
const account = addr(0xacc0);
const destination = addr(0xd0e5);

async function deployFixture() {
  const [owner, recorderClient, strangerClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const registry = await hre.viem.deployContract("BoltRegistry", [recorderClient.account.address]);
  const asRecorder = await hre.viem.getContractAt("BoltRegistry", registry.address, {
    client: { wallet: recorderClient },
  });
  const asStranger = await hre.viem.getContractAt("BoltRegistry", registry.address, {
    client: { wallet: strangerClient },
  });

  return { registry, asRecorder, asStranger, owner, recorderClient, strangerClient, publicClient };
}

/** viem's getContractEvents, per the task's sanctioned option — no reliance on
 * hardhat-viem's optional `getEvents` sugar. */
async function events(
  publicClient: Awaited<ReturnType<typeof hre.viem.getPublicClient>>,
  registry: Awaited<ReturnType<typeof hre.viem.deployContract>>,
  eventName: string,
) {
  return publicClient.getContractEvents({
    address: registry.address,
    abi: registry.abi,
    eventName: eventName as never,
  });
}

describe("BoltRegistry", () => {
  it("emits and reads back one event of every type", async () => {
    const { registry, asRecorder, owner, publicClient } = await loadFixture(deployFixture);

    let hash = await asRecorder.write.recordBusinessRegistered([businessId, "acme", owner.account.address]);
    await publicClient.waitForTransactionReceipt({ hash });
    let logs = await events(publicClient, registry, "BusinessRegistered");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).businessId).to.equal(businessId);
    expect((logs[0].args as any).slug).to.equal("acme");
    expect(getAddress((logs[0].args as any).admin)).to.equal(getAddress(owner.account.address));

    const policyHash = keccak256(toBytes("policy-1"));
    hash = await asRecorder.write.recordAccountRegistered([
      businessId,
      account,
      ACCOUNT_CLASS.CLIENT_MONEY,
      policyHash,
      "client money",
    ]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "AccountRegistered");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).class).to.equal(ACCOUNT_CLASS.CLIENT_MONEY);
    expect((logs[0].args as any).policyHash).to.equal(policyHash);

    const newPolicyHash = keccak256(toBytes("policy-2"));
    const quorumRef = keccak256(toBytes("quorum-1"));
    hash = await asRecorder.write.recordPolicyRotated([businessId, account, policyHash, newPolicyHash, quorumRef]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "PolicyRotated");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).oldPolicyHash).to.equal(policyHash);
    expect((logs[0].args as any).newPolicyHash).to.equal(newPolicyHash);

    const rulesHash = keccak256(toBytes("rules-1"));
    hash = await asRecorder.write.recordMandatePublished([businessId, 1n, rulesHash, quorumRef]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "MandatePublished");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).version).to.equal(1n);

    const depositId = keccak256(toBytes("deposit-1"));
    hash = await asRecorder.write.recordDepositObserved([businessId, depositId, 1_000_000n, 1n]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "DepositObserved");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).amount).to.equal(1_000_000n);

    hash = await asRecorder.write.recordSplitExecuted([depositId, account, 880_000n]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "SplitExecuted");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).amount).to.equal(880_000n);

    const obligationId = keccak256(toBytes("obligation-1"));
    const beneficiaryRef = keccak256(toBytes("beneficiary-1"));
    hash = await asRecorder.write.recordObligationAccrued([businessId, obligationId, account, beneficiaryRef, 880_000n]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "ObligationAccrued");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).amount).to.equal(880_000n);
    expect(await registry.read.outstandingObligations([businessId, ACCOUNT_CLASS.CLIENT_MONEY])).to.equal(880_000n);

    const txRef = keccak256(toBytes("tx-1"));
    hash = await asRecorder.write.recordObligationSettled([obligationId, 880_000n, txRef]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "ObligationSettled");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).amount).to.equal(880_000n);
    expect(await registry.read.outstandingObligations([businessId, ACCOUNT_CLASS.CLIENT_MONEY])).to.equal(0n);

    const unlockId = keccak256(toBytes("unlock-1"));
    const reasonHash = keccak256(toBytes("reason-1"));
    const nowBlock = await publicClient.getBlock();
    const executableAt = nowBlock.timestamp + 86_400n;
    hash = await asRecorder.write.recordUnlockRequested([
      businessId,
      unlockId,
      account,
      500_000n,
      destination,
      reasonHash,
      executableAt,
    ]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "UnlockRequested");
    expect(logs).to.have.lengthOf(1);
    expect(getAddress((logs[0].args as any).destination)).to.equal(getAddress(destination));

    const humanProofRef = keccak256(toBytes("proof-1"));
    hash = await asRecorder.write.recordUnlockApproved([unlockId, owner.account.address, humanProofRef]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "UnlockApproved");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).humanProofRef).to.equal(humanProofRef);

    hash = await asRecorder.write.recordUnlockExecuted([unlockId, 500_000n]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "UnlockExecuted");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).amount).to.equal(500_000n);

    hash = await asRecorder.write.recordUnlockCancelled([unlockId, reasonHash]);
    await publicClient.waitForTransactionReceipt({ hash });
    logs = await events(publicClient, registry, "UnlockCancelled");
    expect(logs).to.have.lengthOf(1);
    expect((logs[0].args as any).reasonHash).to.equal(reasonHash);
  });

  it("only the recorder can record events", async () => {
    const { asStranger } = await loadFixture(deployFixture);
    await expect(
      asStranger.write.recordBusinessRegistered([businessId, "acme", account]),
    ).to.be.rejectedWith("BoltRegistry: not recorder");
  });

  it("only the owner can set the recorder", async () => {
    const { registry, asStranger, strangerClient, publicClient } = await loadFixture(deployFixture);

    await expect(
      asStranger.write.setRecorder([strangerClient.account.address]),
    ).to.be.rejectedWith("BoltRegistry: not owner");

    // registry (the fixture's default instance) is connected as the deployer,
    // i.e. owner — same as Foundry's address(this).
    const hash = await registry.write.setRecorder([strangerClient.account.address]);
    await publicClient.waitForTransactionReceipt({ hash });
    expect(getAddress(await registry.read.recorder())).to.equal(getAddress(strangerClient.account.address));
  });

  it("custodies nothing — never holds native value", async () => {
    const { registry, publicClient } = await loadFixture(deployFixture);
    const balance = await publicClient.getBalance({ address: registry.address });
    expect(balance).to.equal(0n);
  });
});
