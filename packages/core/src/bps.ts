/**
 * Basis points: integer, 10000 = 100%. A mandate's split ratios must sum to
 * exactly 10000 (FR-3.5) — validated at write time and asserted again
 * immediately before signing. Both call sites should call `assertBpsSumTo10000`;
 * do not duplicate the check by hand.
 */
export type Bps = number;

export const BPS_SCALE = 10_000;

/**
 * Throws unless every value is a non-negative integer and the values sum to
 * exactly 10000. Never soften this to "close enough" — a rounding error here
 * is a mandate that doesn't add up to the whole deposit.
 */
export function assertBpsSumTo10000(values: readonly Bps[]): void {
  if (values.length === 0) {
    throw new Error("bps: no ratios to sum");
  }
  let sum = 0;
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`bps: ${v} is not a non-negative integer`);
    }
    sum += v;
  }
  if (sum !== BPS_SCALE) {
    throw new Error(`bps: ratios sum to ${sum}, must sum to exactly ${BPS_SCALE}`);
  }
}

/** Applies a bps ratio to a Usdc amount, in base units, rounding down. */
export function applyBps(amount: bigint, bps: Bps): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`bps: ${bps} is not a non-negative integer`);
  }
  return (amount * BigInt(bps)) / BigInt(BPS_SCALE);
}
