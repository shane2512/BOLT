import type { Usdc } from "./usdc.js";
import { BPS_SCALE } from "./bps.js";

/**
 * Coverage ratio = held ÷ owed, per account class (glossary). Returned in
 * basis points (10000 = 100%) so it stays exact — bigint math, no float.
 * `owed === 0n` means nothing is owed: fully covered by definition.
 */
export function coverageRatioBps(held: Usdc, owed: Usdc): number {
  if (owed === 0n) return BPS_SCALE;
  return Number((held * BigInt(BPS_SCALE)) / owed);
}

/** Below 100% coverage is a shortfall. Never a shortfall when nothing is owed. */
export function isShortfall(held: Usdc, owed: Usdc): boolean {
  return owed > 0n && held < owed;
}
