/**
 * Display formatting only — no figure originates here. Every value passed in
 * already came from `@bolt/core`'s subgraph client (an indexed event or an
 * on-chain balance), per CLAUDE.md invariant 8.
 */

/** USDC base units (6 decimals) -> "1,234.56 USDC". */
export function fmtUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? "-" : "";
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole.toLocaleString("en-US")}.${frac} USDC`;
}

/** Basis points (10000 = 100%) -> "100.00%". */
export function fmtBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function fmtTimestamp(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
