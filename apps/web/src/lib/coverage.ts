/**
 * Coverage arithmetic over indexed snapshots.
 *
 * Every figure here is derived from `CoverageSnapshot` rows the subgraph
 * indexed from `BoltRegistry` events. Nothing is read from Postgres and nothing
 * is interpolated: a point on the line is a block where held or owed actually
 * moved (CLAUDE.md invariant 8).
 */
import type { AccountClass, CoverageSnap } from "./chain";

export interface Combined {
  held: bigint;
  owed: bigint;
  ratioBps: number | null;
  blockNumber: string;
  timestamp: string;
}

/** Coverage across every class at once: total held against total owed. */
export function combine(snaps: CoverageSnap[]): Combined | null {
  if (!snaps.length) return null;
  const held = snaps.reduce((s, x) => s + BigInt(x.held), 0n);
  const owed = snaps.reduce((s, x) => s + BigInt(x.owed), 0n);
  const newest = snaps.reduce((a, b) =>
    Number(b.blockNumber) > Number(a.blockNumber) ? b : a
  );
  return {
    held,
    owed,
    ratioBps: owed === 0n ? null : Number((held * 10_000n) / owed),
    blockNumber: newest.blockNumber,
    timestamp: newest.timestamp
  };
}

/**
 * Replays the history forward, carrying each class's last known held/owed, and
 * emits the combined ratio at every indexed block. `windowDays` trims the tail
 * without changing what came before it, so the carried state stays correct.
 */
export function combinedSeries(
  history: CoverageSnap[],
  windowDays?: number
): [number, number][] {
  const state = new Map<AccountClass, { held: bigint; owed: bigint }>();
  const out: [number, number][] = [];
  const ordered = [...history].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const cutoff =
    windowDays && ordered.length
      ? Number(ordered[ordered.length - 1].timestamp) - windowDays * 86_400
      : null;

  for (const row of ordered) {
    state.set(row.class, { held: BigInt(row.held), owed: BigInt(row.owed) });
    if (cutoff !== null && Number(row.timestamp) < cutoff) continue;
    let held = 0n;
    let owed = 0n;
    for (const v of state.values()) {
      held += v.held;
      owed += v.owed;
    }
    if (owed === 0n) continue;
    out.push([Number(row.timestamp), Number((held * 10_000n) / owed)]);
  }
  return out;
}

/** One line per class, for the public page's 90-day chart. */
export function perClassSeries(
  history: CoverageSnap[],
  cls: AccountClass,
  windowDays?: number
): [number, number][] {
  const rows = [...history]
    .filter((r) => r.class === cls && BigInt(r.owed) > 0n)
    .sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const cutoff =
    windowDays && rows.length
      ? Number(rows[rows.length - 1].timestamp) - windowDays * 86_400
      : null;
  return rows
    .filter((r) => cutoff === null || Number(r.timestamp) >= cutoff)
    .map((r) => [Number(r.timestamp), Number(r.ratioBps)]);
}

/** Latest indexed snapshot per class, newest wins. */
export function latestPerClass(snaps: CoverageSnap[]): Map<AccountClass, CoverageSnap> {
  const m = new Map<AccountClass, CoverageSnap>();
  for (const s of snaps) {
    const cur = m.get(s.class);
    if (!cur || Number(s.blockNumber) > Number(cur.blockNumber)) m.set(s.class, s);
  }
  return m;
}
