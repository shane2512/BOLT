import { describe, expect, it } from "vitest";
import { detectDrift, forecastCoverage, shortfallEpisodes } from "../monitor.js";
import type {
  CoverageSnapshotWithTx,
  DepositWithSplitsResult,
  MandateResult
} from "../subgraph-client.js";

/**
 * The drift detector is the compromised-backend detector (FR-7.3). These tests
 * are the smallest thing that fails if it stops working: a clean history must
 * produce no divergence, a skimmed deposit must be caught with the exact number
 * of base units that moved, and a deposit of a *different size* in the correct
 * ratio must not be mistaken for drift — which is the bug a naive
 * amount-comparison would ship with.
 */

const CLIENT = "0x0eb2a7667e56dd07131000ee0d99b6d218592d8b";
const RESERVE = "0x3b467cdd0949edc45b9d9f163c9dcf7028605d14";
const OPERATING = "0xe0d6fc2fdb556a26c173c6e5fa90d6b5283ff060";

let nonce = 0;
function deposit(
  amount: bigint,
  shares: [string, bigint][],
  opts: { block?: bigint; mandateVersion?: bigint } = {}
): DepositWithSplitsResult {
  nonce += 1;
  const block = opts.block ?? BigInt(1000 + nonce);
  const classOf = (id: string) =>
    id === CLIENT ? "CLIENT_MONEY" : id === RESERVE ? "OBLIGATION_RESERVE" : "OPERATING";
  return {
    id: `0xdep${nonce}`,
    amount,
    mandateVersion: opts.mandateVersion ?? 1n,
    splitTotal: shares.reduce((s, [, a]) => s + a, 0n),
    blockNumber: block,
    timestamp: 1_700_000_000n + block,
    txHash: `0xtx${nonce}`,
    splits: shares.map(([account, splitAmount]) => ({
      amount: splitAmount,
      blockNumber: block,
      txHash: `0xtx${nonce}`,
      account: { id: account, label: classOf(account), class: classOf(account) as never }
    }))
  };
}

const ratified: MandateResult[] = [
  {
    version: 1n,
    rulesHash: "0xrules",
    quorumRef: "0xquorum",
    blockNumber: 900n,
    timestamp: 1_700_000_900n,
    txHash: "0xmandate"
  }
];

// 88% client money / 4% tax reserve / 8% operating — the Phase 3 mandate.
const correct = (amount: bigint, block?: bigint) =>
  deposit(
    amount,
    [
      [CLIENT, (amount * 8800n) / 10_000n],
      [RESERVE, (amount * 400n) / 10_000n],
      [OPERATING, (amount * 800n) / 10_000n]
    ],
    { block }
  );

describe("detectDrift", () => {
  it("reports no divergence when every deposit splits in the baseline ratio", () => {
    const [report] = detectDrift(
      [correct(10_000_000n, 100n), correct(10_000_000n, 200n), correct(10_000_000n, 300n)],
      ratified
    );
    expect(report!.divergent).toHaveLength(0);
    expect(report!.conforming).toHaveLength(2);
    expect(report!.ongoing).toBe(false);
  });

  it("does not mistake a differently-sized deposit for drift", () => {
    // The bug this guards: comparing split *amounts* instead of *ratios*.
    const [report] = detectDrift(
      [correct(10_000_000n, 100n), correct(2_000_000n, 200n), correct(37_500_001n, 300n)],
      ratified
    );
    expect(report!.divergent).toHaveLength(0);
  });

  it("catches a splitter skimming 5% out of client money, with the exact shortfall", () => {
    const skimmed = deposit(
      2_000_000n,
      [
        [CLIENT, 1_660_000n], // 8300 bps, not 8800
        [RESERVE, 80_000n],
        [OPERATING, 260_000n] // 1300 bps, not 800
      ],
      { block: 300n }
    );
    const [report] = detectDrift(
      [correct(10_000_000n, 100n), correct(2_000_000n, 200n), skimmed],
      ratified
    );

    expect(report!.divergent).toHaveLength(1);
    const divergent = report!.divergent[0]!;
    // 5% of 2.000000 USDC = 0.100000 USDC moved out of client money.
    expect(divergent.misallocated).toBe(100_000n);
    expect(report!.ongoing).toBe(true);

    const client = divergent.details.find((d) => d.accountId === CLIENT)!;
    expect(client.expected).toBe(1_760_000n);
    expect(client.actual).toBe(1_660_000n);
    expect(client.delta).toBe(-100_000n);
    expect(client.expectedBps).toBe(8800n);
    expect(client.actualBps).toBe(8300n);
    expect(divergent.destinationSetChanged).toBe(false);
  });

  it("tolerates one base unit of cumulative-bps rounding but not two", () => {
    const base = correct(10_000_000n, 100n);
    const off1 = deposit(
      10_000_000n,
      [[CLIENT, 8_800_001n], [RESERVE, 400_000n], [OPERATING, 799_999n]],
      { block: 200n }
    );
    const off2 = deposit(
      10_000_000n,
      [[CLIENT, 8_800_002n], [RESERVE, 400_000n], [OPERATING, 799_998n]],
      { block: 300n }
    );
    expect(detectDrift([base, off1], ratified)[0]!.divergent).toHaveLength(0);
    expect(detectDrift([base, off2], ratified)[0]!.divergent).toHaveLength(1);
  });

  it("flags a destination that appears or disappears", () => {
    const rerouted = deposit(
      10_000_000n,
      [[CLIENT, 8_800_000n], [RESERVE, 400_000n], ["0xdeadbeef", 800_000n]],
      { block: 300n }
    );
    const [report] = detectDrift([correct(10_000_000n, 100n), rerouted], ratified);
    expect(report!.divergent[0]!.destinationSetChanged).toBe(true);
  });

  it("separates versions and marks one with no MandatePublished as unratified", () => {
    const reports = detectDrift(
      [correct(10_000_000n, 100n), correct(10_000_000n, 200n), deposit(
        10_000_000n,
        [[CLIENT, 5_000_000n], [RESERVE, 400_000n], [OPERATING, 4_600_000n]],
        { block: 300n, mandateVersion: 2n }
      )],
      ratified
    );
    expect(reports).toHaveLength(2);
    expect(reports[0]!.ratified).not.toBeNull();
    expect(reports[1]!.mandateVersion).toBe(2n);
    // Version 2 has no MandatePublished and only one deposit, so it cannot be
    // compared — but the missing ratification is itself the finding.
    expect(reports[1]!.ratified).toBeNull();
    expect(reports[1]!.divergent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

function snap(
  cls: CoverageSnapshotWithTx["class"],
  block: bigint,
  timestamp: bigint,
  held: bigint,
  owed: bigint
): CoverageSnapshotWithTx {
  return {
    class: cls,
    held,
    owed,
    ratioBps: owed === 0n ? 10_000n : (held * 10_000n) / owed,
    shortfall: owed > 0n && held < owed,
    surplus: held - owed,
    trigger: "UsdcTransfer",
    blockNumber: block,
    timestamp,
    txHash: `0x${block}`
  };
}

describe("forecastCoverage", () => {
  it("projects days of cover from the observed drain, not from a constant", () => {
    // 10 USDC surplus falling by 1 USDC/day over 4 days -> 6 left -> 6 days.
    const history = [0, 1, 2, 3, 4].map((day) =>
      snap(
        "CLIENT_MONEY",
        BigInt(100 + day),
        1_700_000_000n + BigInt(day * 86_400),
        10_000_000n - BigInt(day) * 1_000_000n,
        0n
      )
    );
    const [f] = forecastCoverage(history);
    expect(f!.netPerDay).toBeCloseTo(-1_000_000, 0);
    expect(f!.daysOfCover).toBeCloseTo(6, 2);
  });

  it("offers no depletion date when the surplus is flat, including at exactly full cover", () => {
    const flatPositive = [0, 1].map((day) =>
      snap("CLIENT_MONEY", BigInt(100 + day), 1_700_000_000n + BigInt(day * 86_400), 500n, 100n)
    );
    expect(forecastCoverage(flatPositive)[0]!.daysOfCover).toBeNull();

    // held === owed is fully covered, not zero days of cover. This is the exact
    // shape split-on-receipt produces, so getting it wrong would fire a SEVERE
    // alert on every healthy business.
    const exactCover = [0, 1].map((day) =>
      snap("CLIENT_MONEY", BigInt(100 + day), 1_700_000_000n + BigInt(day * 86_400), 8_800_000n, 8_800_000n)
    );
    const [f] = forecastCoverage(exactCover);
    expect(f!.shortfallNow).toBe(false);
    expect(f!.daysOfCover).toBeNull();
  });
});

describe("shortfallEpisodes", () => {
  it("returns the block range of a closed episode and marks an open one ongoing", () => {
    const history = [
      snap("CLIENT_MONEY", 100n, 1_700_000_000n, 100n, 100n),
      snap("CLIENT_MONEY", 200n, 1_700_000_100n, 60n, 100n), // short
      snap("CLIENT_MONEY", 300n, 1_700_000_200n, 40n, 100n), // worse
      snap("CLIENT_MONEY", 400n, 1_700_000_300n, 100n, 100n), // recovered
      snap("OBLIGATION_RESERVE", 500n, 1_700_000_400n, 1n, 10n) // still short
    ];
    const episodes = shortfallEpisodes(history);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.startBlock).toBe(200n);
    expect(episodes[0]!.endBlock).toBe(400n);
    expect(episodes[0]!.ongoing).toBe(false);
    expect(episodes[0]!.worstRatioBps).toBe(4000n);
    expect(episodes[0]!.worstDeficit).toBe(60n);
    expect(episodes[1]!.ongoing).toBe(true);
  });
});
