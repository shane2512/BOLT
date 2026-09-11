import { describe, expect, it } from "vitest";
import { assertBpsSumTo10000, applyBps } from "../bps.js";

// NEVER DELETE THIS TEST. FR-3.5: split ratios must sum to exactly 10000,
// validated at write time and asserted again before signing. Per CLAUDE.md,
// this is one of the tests that must never be deleted.
describe("assertBpsSumTo10000", () => {
  it("accepts ratios that sum to exactly 10000", () => {
    expect(() => assertBpsSumTo10000([8800, 400, 800])).not.toThrow();
    expect(() => assertBpsSumTo10000([10000])).not.toThrow();
  });

  it("rejects ratios that sum to less than 10000", () => {
    expect(() => assertBpsSumTo10000([8800, 400, 799])).toThrow();
  });

  it("rejects ratios that sum to more than 10000", () => {
    expect(() => assertBpsSumTo10000([8800, 400, 801])).toThrow();
  });

  it("rejects a negative ratio", () => {
    expect(() => assertBpsSumTo10000([10100, -100])).toThrow();
  });

  it("rejects a non-integer ratio", () => {
    expect(() => assertBpsSumTo10000([8800.5, 400, 799.5])).toThrow();
  });

  it("rejects an empty list", () => {
    expect(() => assertBpsSumTo10000([])).toThrow();
  });
});

describe("applyBps", () => {
  it("splits an amount by ratio, rounding down", () => {
    expect(applyBps(100n, 8800)).toBe(88n);
    expect(applyBps(1n, 1)).toBe(0n); // rounds down, not up
  });

  it("rejects a negative bps value", () => {
    expect(() => applyBps(100n, -1)).toThrow();
  });
});
