import { describe, expect, it } from "vitest";
import { coverageRatioBps, isShortfall } from "../coverage.js";
import { usdc } from "../usdc.js";

describe("coverageRatioBps", () => {
  it("returns 10000 (100%) when held equals owed", () => {
    expect(coverageRatioBps(usdc(100n), usdc(100n))).toBe(10_000);
  });

  it("returns 5000 (50%) when held is half of owed", () => {
    expect(coverageRatioBps(usdc(50n), usdc(100n))).toBe(5_000);
  });

  it("returns 20000 (200%) when held is double owed", () => {
    expect(coverageRatioBps(usdc(200n), usdc(100n))).toBe(20_000);
  });

  it("treats zero owed as fully covered", () => {
    expect(coverageRatioBps(usdc(0n), usdc(0n))).toBe(10_000);
    expect(coverageRatioBps(usdc(50n), usdc(0n))).toBe(10_000);
  });
});

describe("isShortfall", () => {
  it("is true when held is below owed", () => {
    expect(isShortfall(usdc(50n), usdc(100n))).toBe(true);
  });

  it("is false when held meets or exceeds owed", () => {
    expect(isShortfall(usdc(100n), usdc(100n))).toBe(false);
    expect(isShortfall(usdc(150n), usdc(100n))).toBe(false);
  });

  it("is never a shortfall when nothing is owed", () => {
    expect(isShortfall(usdc(0n), usdc(0n))).toBe(false);
  });
});
