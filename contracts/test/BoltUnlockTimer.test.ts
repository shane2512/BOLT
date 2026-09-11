import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
import { keccak256, toBytes } from "viem";

chai.use(chaiAsPromised);

/**
 * FR-5.4 — the 24-hour timer.
 *
 * LOCAL TEST ONLY. Everything here runs on the in-process Hardhat network so
 * that `time.increase` can move the clock. The *refusal* half of this — "an
 * unlock cannot execute before the window" — is also proved live on Arc testnet
 * in docs/evidence/phase6-timer-*.json against the real deployed constant. The
 * *success* half ("it works once the window passes") cannot be proved live in a
 * single session without waiting 24 real hours, so it is asserted here, on a
 * local chain, and labelled as such rather than being faked by shortening
 * UNLOCK_DELAY.
 */

const unlockId = keccak256(toBytes("unlock-1"));
const ONE_DAY = 24 * 60 * 60;

async function deployFixture() {
  const [, recorderClient, strangerClient] = await hre.viem.getWalletClients();
  const timer = await hre.viem.deployContract("BoltUnlockTimer", [
    recorderClient.account.address,
  ]);
  const asRecorder = await hre.viem.getContractAt("BoltUnlockTimer", timer.address, {
    client: { wallet: recorderClient },
  });
  const asStranger = await hre.viem.getContractAt("BoltUnlockTimer", timer.address, {
    client: { wallet: strangerClient },
  });
  return { timer, asRecorder, asStranger };
}

describe("BoltUnlockTimer (local Hardhat network)", () => {
  it("publishes a 24-hour delay as an immutable constant", async () => {
    const { timer } = await loadFixture(deployFixture);
    expect(await timer.read.UNLOCK_DELAY()).to.equal(BigInt(ONE_DAY));
  });

  it("refuses release before the window has elapsed", async () => {
    const { asRecorder } = await loadFixture(deployFixture);
    await asRecorder.write.arm([unlockId]);

    await expect(asRecorder.write.release([unlockId])).to.be.rejectedWith(
      "24h timer has not elapsed",
    );

    // Nearly a day is still short. (Each mined block, reverted or not, advances
    // the local clock a second, so leave a little room.)
    await time.increase(ONE_DAY - 10);
    await expect(asRecorder.write.release([unlockId])).to.be.rejectedWith(
      "24h timer has not elapsed",
    );
  });

  it("allows release once the window has elapsed", async () => {
    const { asRecorder, timer } = await loadFixture(deployFixture);
    await asRecorder.write.arm([unlockId]);
    await time.increase(ONE_DAY);

    await asRecorder.write.release([unlockId]);
    const [, , released] = await timer.read.timers([unlockId]);
    expect(released).to.equal(true);

    // And only once.
    await expect(asRecorder.write.release([unlockId])).to.be.rejectedWith("already released");
  });

  it("refuses release for an unlock that was never armed", async () => {
    const { asRecorder } = await loadFixture(deployFixture);
    await expect(asRecorder.write.release([unlockId])).to.be.rejectedWith("not armed");
  });

  it("refuses arm and release from anyone but the recorder", async () => {
    const { asStranger } = await loadFixture(deployFixture);
    await expect(asStranger.write.arm([unlockId])).to.be.rejectedWith("not recorder");
    await expect(asStranger.write.release([unlockId])).to.be.rejectedWith("not recorder");
  });

  it("counts down from the final approval, not from the request", async () => {
    const { asRecorder, timer } = await loadFixture(deployFixture);
    await asRecorder.write.arm([unlockId]);
    const [armedAt, executableAt] = await timer.read.timers([unlockId]);
    expect(executableAt - armedAt).to.equal(BigInt(ONE_DAY));

    await time.increase(ONE_DAY / 2);
    const remaining = await timer.read.secondsRemaining([unlockId]);
    expect(remaining > 0n).to.equal(true);
    expect(remaining <= BigInt(ONE_DAY / 2)).to.equal(true);
  });
});
