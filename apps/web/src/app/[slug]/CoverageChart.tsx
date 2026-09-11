import type { CoverageSnapshotWithTx } from "@bolt/core";
import { fmtBps, fmtTimestamp } from "./format";

/**
 * FR-6.4 — coverage over time as a line, from indexed `CoverageSnapshot`
 * history. Every point below is one immutable, on-chain-triggered snapshot;
 * nothing here is interpolated, rounded off to "current", or invented.
 *
 * Hand-rolled SVG rather than a charting dependency — one line chart doesn't
 * earn a new package (nothing already in the stack does line charts).
 */

const CLASS_COLOR: Record<string, string> = {
  OPERATING: "#2563eb",
  CLIENT_MONEY: "#16a34a",
  OBLIGATION_RESERVE: "#d97706"
};

const WIDTH = 720;
const HEIGHT = 280;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;

export default function CoverageChart({ history }: { history: CoverageSnapshotWithTx[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-gray-500">No coverage history indexed yet.</p>;
  }

  const byClass = new Map<string, CoverageSnapshotWithTx[]>();
  for (const row of history) {
    const arr = byClass.get(row.class) ?? [];
    arr.push(row);
    byClass.set(row.class, arr);
  }

  const minBlock = history.reduce((m, r) => (r.blockNumber < m ? r.blockNumber : m), history[0].blockNumber);
  const maxBlock = history.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), history[0].blockNumber);
  const maxRatioBps = history.reduce((m, r) => (r.ratioBps > m ? r.ratioBps : m), 10_000n);
  const blockSpan = maxBlock - minBlock === 0n ? 1n : maxBlock - minBlock;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (block: bigint): number => PAD_LEFT + (Number(block - minBlock) / Number(blockSpan)) * plotW;
  const y = (ratioBps: bigint): number =>
    PAD_TOP + plotH - (Number(ratioBps) / Number(maxRatioBps)) * plotH;

  const gridlineBps = [0n, 5_000n, 10_000n].filter((v) => v <= maxRatioBps || v === 10_000n);

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="Coverage ratio over time, per account class">
        {/* gridlines */}
        {gridlineBps.map((bps) => (
          <g key={bps.toString()}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(bps)} y2={y(bps)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={4} y={y(bps) + 4} fontSize={10} fill="#6b7280">
              {fmtBps(bps)}
            </text>
          </g>
        ))}
        {/* axis labels: first/last block */}
        <text x={PAD_LEFT} y={HEIGHT - 8} fontSize={10} fill="#6b7280">
          block {minBlock.toString()}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 8} fontSize={10} fill="#6b7280" textAnchor="end">
          block {maxBlock.toString()}
        </text>

        {[...byClass.entries()].map(([cls, rows]) => {
          const points = rows.map((r) => `${x(r.blockNumber)},${y(r.ratioBps)}`).join(" ");
          const color = CLASS_COLOR[cls] ?? "#6b7280";
          return (
            <g key={cls}>
              <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
              {rows.map((r) => (
                <circle key={r.blockNumber.toString() + r.trigger} cx={x(r.blockNumber)} cy={y(r.ratioBps)} r={3} fill={color}>
                  {/* React special-cases <title> children to a single string (even inside
                      SVG) — multiple JSX expression children here caused a real
                      hydration mismatch, caught live. One template string, not a list. */}
                  <title>
                    {`${cls} @ block ${r.blockNumber.toString()} (${fmtTimestamp(r.timestamp)}) — ${fmtBps(r.ratioBps)} coverage, held ${r.held.toString()}, owed ${r.owed.toString()}, trigger: ${r.trigger}, tx ${r.txHash}`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 mt-2 text-xs">
        {[...byClass.keys()].map((cls) => (
          <span key={cls} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CLASS_COLOR[cls] ?? "#6b7280" }} />
            {cls} ({byClass.get(cls)?.length} points)
          </span>
        ))}
      </div>
    </div>
  );
}
