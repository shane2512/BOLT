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

/** Same quantity, two decimal places, for headline figures. */
export function fmtUsdcShort(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? "-" : "";
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${sign}${whole.toLocaleString("en-US")}.${frac}`;
}

/** Basis points (10000 = 100%) -> "100.00%". */
export function fmtBps(bps: bigint | number): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function fmtTimestamp(unixSeconds: bigint | number | string): string {
  return new Date(Number(unixSeconds) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}

/** Human-readable age of a unix timestamp, e.g. "6 minutes ago". */
export function fmtAgo(unixSeconds: bigint | number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(now / 1000 - Number(unixSeconds)));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Block numbers read more like a counter with thin separators. */
export function fmtBlock(block: bigint | number | string): string {
  return Number(block).toLocaleString("en-US").replace(/,/g, " ");
}

/** "CLIENT_MONEY" -> "Client money". Enum values are never shown raw. */
export function titleiseClass(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
