/**
 * FR-3.5 — **never delete this file.**
 *
 * Split ratios are basis points summing to exactly 10000, validated on write and
 * asserted again before signing. A mandate that sums to 9999 hands a hundredth
 * of a percent of every deposit to nobody; one that sums to 10001 promises money
 * that does not exist. Both are silent until an audit, which is exactly the
 * failure mode BOLT exists to remove.
 */
import { describe, expect, it } from "vitest";
import { computeSplits, validateMandateRules } from "../mandate.js";
import { usdc } from "../usdc.js";

const seller = "acct-seller";
const tax = "acct-tax";
const operating = "acct-operating";

/** 88% seller · 4% sales tax · 8% operating — the plain-language example in FR-4.3. */
const mandate = [
  { destinationAccountId: seller, bps: 8800 },
  { destinationAccountId: tax, bps: 400 },
  { destinationAccountId: operating, bps: 800 }
];

describe("FR-3.5 — ratios must sum to exactly 10000, at write time", () => {
  it("accepts a mandate summing to 10000", () => {
    expect(() => validateMandateRules(mandate)).not.toThrow();
  });

  it("rejects a mandate summing to less than 10000", () => {
    expect(() =>
      validateMandateRules([
        { destinationAccountId: seller, bps: 8800 },
        { destinationAccountId: tax, bps: 400 }
      ])
    ).toThrow(/sum to 9200, must sum to exactly 10000/);
  });

  it("rejects a mandate summing to more than 10000", () => {
    expect(() =>
      validateMandateRules([
        { destinationAccountId: seller, bps: 9000 },
        { destinationAccountId: tax, bps: 1500 }
      ])
    ).toThrow(/sum to 10500, must sum to exactly 10000/);
  });

  it("rejects a negative or fractional share", () => {
    expect(() =>
      validateMandateRules([
        { destinationAccountId: seller, bps: 10_050 },
        { destinationAccountId: tax, bps: -50 }
      ])
    ).toThrow(/not a non-negative integer/);
    expect(() =>
      validateMandateRules([
        { destinationAccountId: seller, bps: 9999.5 },
        { destinationAccountId: tax, bps: 0.5 }
      ])
    ).toThrow(/not a non-negative integer/);
  });

  it("rejects an empty mandate rather than treating it as 'keep everything'", () => {
    expect(() => validateMandateRules([])).toThrow(/no rules/);
  });

  it("rejects the same destination twice, which would hide a bad sum", () => {
    expect(() =>
      validateMandateRules([
        { destinationAccountId: seller, bps: 5000 },
        { destinationAccountId: seller, bps: 5000 }
      ])
    ).toThrow(/appears twice/);
  });
});

describe("FR-3.5 — the same assertion runs again on the signing path", () => {
  it("computeSplits refuses a bad mandate even if it somehow reached the splitter", () => {
    expect(() =>
      computeSplits(usdc(1_000_000n), [
        { destinationAccountId: seller, bps: 8800 },
        { destinationAccountId: tax, bps: 400 }
      ])
    ).toThrow(/must sum to exactly 10000/);
  });
});

describe("computeSplits", () => {
  it("splits a clean amount by the mandate", () => {
    expect(computeSplits(usdc(10_000_000n), mandate)).toEqual([
      { destinationAccountId: seller, amount: 8_800_000n },
      { destinationAccountId: tax, amount: 400_000n },
      { destinationAccountId: operating, amount: 800_000n }
    ]);
  });

  it("loses no base unit to rounding — allocations always sum to the deposit", () => {
    // 1 base unit is the hardest case: every exact share rounds to zero.
    for (const amount of [1n, 3n, 7n, 999n, 1_000_001n, 123_456_789n]) {
      const splits = computeSplits(usdc(amount), mandate);
      expect(splits.reduce((s, a) => s + a.amount, 0n)).toBe(amount);
    }
  });

  it("is deterministic, so mandate drift is detectable (FR-7.3)", () => {
    const a = computeSplits(usdc(123_456_789n), mandate);
    const b = computeSplits(usdc(123_456_789n), mandate);
    expect(a).toEqual(b);
  });
});
