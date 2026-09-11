/**
 * Money is always `bigint`, in USDC base units (6 decimals). Never `number`.
 * `Usdc` is a branded bigint so a raw bigint can't slip into a money-typed slot
 * without going through `usdc()`.
 */
export type Usdc = bigint & { readonly __brand: "Usdc" };

export function usdc(baseUnits: bigint): Usdc {
  if (baseUnits < 0n) throw new RangeError("Usdc cannot be negative");
  return baseUnits as Usdc;
}

export const ZERO_USDC: Usdc = usdc(0n);
