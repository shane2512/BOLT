import { describe, expect, it } from "vitest";
import { usdc } from "../usdc.js";

describe("usdc", () => {
  it("wraps a non-negative bigint", () => {
    expect(usdc(100n)).toBe(100n);
  });

  it("rejects a negative bigint", () => {
    expect(() => usdc(-1n)).toThrow();
  });
});
