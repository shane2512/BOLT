/**
 * FR-7 — the Solvency Monitor's reasoning, as pure functions.
 *
 * Every input to every function here comes from the deployed subgraph
 * (FR-7.1): `CoverageSnapshot`, `Deposit`/`Split`, `Mandate` and
 * `Unlock`/`Approval` entities, each of which is an indexed `BoltRegistry`
 * event or an on-chain USDC balance. There is no Postgres in this file, no
 * configuration file, and no constant standing in for a figure that ought to
 * come off the chain. That is what makes a finding checkable by a reader who
 * does not trust us: every `evidence` object carries the block numbers and
 * transaction hashes the conclusion was drawn from.
 *
 * It lives in `packages/core` rather than in `apps/monitor` for one reason:
 * the agent loop, the public `/[slug]` page and the natural-language endpoint
 * must all show the *same* findings. One implementation, three callers.
 *
 * Money stays `bigint` in USDC base units throughout (NFR-5). The two places a
 * float appears are both rates or scores rather than money — a projected
 * drain per day, and a z-score — and each is labelled as such.
 */
import type {
  BusinessResult,
  CoverageSnapshotWithTx,
  DepositWithSplitsResult,
  MandateResult,
  UnlockResult
} from "./subgraph-client.js";
import type { AccountClass } from "./account-class.js";

export type Severity = "INFO" | "WARNING" | "SEVERE";

export interface Finding {
  /** Matches `alerts.kind` in Postgres so a finding and an alert are the same thing. */
  kind:
    | "MANDATE_DRIFT"
    | "UNRATIFIED_MANDATE"
    | "UNALLOCATED_DEPOSIT"
    | "SHORTFALL_FORECAST"
    | "SHORTFALL_HISTORY"
    | "UNLOCK_ANOMALY";
  severity: Severity;
  title: string;
  /** Prose stating what was concluded and why. Not a dump of the query result. */
  message: string;
  /** Block numbers, tx hashes and figures backing the conclusion. */
  evidence: Record<string, unknown>;
  /**
   * Stable identity for the same finding across runs, so a loop that runs every
   * minute raises one alert rather than one per minute.
   */
  fingerprint: string;
}

/** Everything the Monitor reads, in one place. All of it indexed. */
export interface MonitorSnapshot {
  business: BusinessResult;
  coverage: CoverageSnapshotWithTx[];
  deposits: DepositWithSplitsResult[];
  mandates: MandateResult[];
  unlocks: UnlockResult[];
  indexedAtBlock: bigint;
}

const DAY_SECONDS = 86_400;
const BPS = 10_000n;

const iso = (unixSeconds: bigint): string =>
  new Date(Number(unixSeconds) * 1000).toISOString();

/** USDC base units → a human string. Display only; never fed back into arithmetic. */
export const formatUsdc = (units: bigint): string => {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac} USDC`;
};

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

// ---------------------------------------------------------------------------
// Shortfall forecast (FR-7.2)
// ---------------------------------------------------------------------------

export interface ClassForecast {
  class: AccountClass;
  held: bigint;
  owed: bigint;
  surplus: bigint;
  shortfallNow: boolean;
  /** Snapshots observed for this class. Two is the minimum for any trend. */
  samples: number;
  observationDays: number;
  /** Net change in surplus per day across the observed window. Negative = draining. */
  netPerDay: number;
  /** Days until surplus reaches zero at the observed rate. `null` when not depleting. */
  daysOfCover: number | null;
  firstBlock: bigint;
  lastBlock: bigint;
  firstTimestamp: bigint;
  lastTimestamp: bigint;
}

/**
 * Days of cover remaining per account class, projected from the flows the index
 * actually recorded — not from a configured burn rate.
 *
 * The projection is a straight line through the first and last `CoverageSnapshot`
 * of the window: `surplus` (held − owed) is the quantity that matters, because a
 * class can be draining held *and* shedding owed at the same rate and be no worse
 * off. A class whose surplus is flat or rising has no depletion date, and this
 * says so rather than inventing a large number.
 *
 * ponytail: two-point linear fit, deliberately. A regression over every snapshot
 * would be a better estimator on a long, noisy history; upgrade when there is
 * enough of one to be noisy.
 */
export function forecastCoverage(
  coverage: readonly CoverageSnapshotWithTx[]
): ClassForecast[] {
  const classes = [...new Set(coverage.map((c) => c.class))];
  const forecasts: ClassForecast[] = [];

  for (const cls of classes) {
    const rows = coverage
      .filter((c) => c.class === cls)
      .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last) continue;

    const observationSeconds = Number(last.timestamp - first.timestamp);
    const observationDays = observationSeconds / DAY_SECONDS;
    const deltaSurplus = Number(last.surplus - first.surplus);
    const netPerDay = observationDays > 0 ? deltaSurplus / observationDays : 0;

    // Days until the surplus reaches zero. A class sitting at exactly zero
    // surplus is *fully covered* — held equals owed to the base unit — so it
    // only has a depletion date if it is actually draining.
    const daysOfCover =
      last.surplus < 0n ? 0 : netPerDay < 0 ? Number(last.surplus) / -netPerDay : null;

    forecasts.push({
      class: cls,
      held: last.held,
      owed: last.owed,
      surplus: last.surplus,
      shortfallNow: last.shortfall,
      samples: rows.length,
      observationDays,
      netPerDay,
      daysOfCover,
      firstBlock: first.blockNumber,
      lastBlock: last.blockNumber,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp
    });
  }

  return forecasts;
}

function forecastFindings(snapshot: MonitorSnapshot): Finding[] {
  const findings: Finding[] = [];

  for (const f of forecastCoverage(snapshot.coverage)) {
    const evidence = {
      class: f.class,
      held: f.held.toString(),
      owed: f.owed.toString(),
      surplus: f.surplus.toString(),
      heldReadable: formatUsdc(f.held),
      owedReadable: formatUsdc(f.owed),
      snapshotsObserved: f.samples,
      windowFirstBlock: f.firstBlock.toString(),
      windowLastBlock: f.lastBlock.toString(),
      windowFirstTimestamp: iso(f.firstTimestamp),
      windowLastTimestamp: iso(f.lastTimestamp),
      observationDays: Number(f.observationDays.toFixed(4)),
      netSurplusChangePerDayBaseUnits: Math.round(f.netPerDay),
      daysOfCover: f.daysOfCover === null ? null : Number(f.daysOfCover.toFixed(2)),
      source: "CoverageSnapshot entities (subgraph)"
    };

    if (f.shortfallNow) {
      findings.push({
        kind: "SHORTFALL_FORECAST",
        severity: "SEVERE",
        title: `${f.class} is short now`,
        message:
          `${f.class} holds ${formatUsdc(f.held)} against ${formatUsdc(f.owed)} owed as of block ` +
          `${f.lastBlock} (${iso(f.lastTimestamp)}) — a hole of ${formatUsdc(abs(f.surplus))}. ` +
          `Days of cover remaining: zero, because cover has already run out.`,
        evidence,
        fingerprint: `SHORTFALL_FORECAST:${f.class}:now`
      });
      continue;
    }

    if (f.samples < 2 || f.observationDays <= 0) {
      findings.push({
        kind: "SHORTFALL_FORECAST",
        severity: "INFO",
        title: `${f.class}: no trend yet`,
        message:
          `${f.class} is covered — ${formatUsdc(f.held)} held against ${formatUsdc(f.owed)} owed at ` +
          `block ${f.lastBlock} — but ${f.samples} indexed snapshot${f.samples === 1 ? "" : "s"} over ` +
          `${f.observationDays.toFixed(2)} days is not enough history to project a depletion date. ` +
          `No forecast is offered rather than one invented from a single point.`,
        evidence,
        fingerprint: `SHORTFALL_FORECAST:${f.class}:insufficient`
      });
      continue;
    }

    if (f.daysOfCover === null) {
      findings.push({
        kind: "SHORTFALL_FORECAST",
        severity: "INFO",
        title: `${f.class}: cover stable or growing`,
        message:
          `${f.class}'s surplus moved ${f.netPerDay >= 0 ? "up" : "down"} by ` +
          `${Math.round(f.netPerDay)} base units per day across ${f.observationDays.toFixed(2)} days ` +
          `(blocks ${f.firstBlock}–${f.lastBlock}). It is not depleting, so there is no depletion ` +
          `date to project. Current cover: ${formatUsdc(f.held)} held against ${formatUsdc(f.owed)} owed.`,
        evidence,
        fingerprint: `SHORTFALL_FORECAST:${f.class}:stable`
      });
      continue;
    }

    const severity: Severity =
      f.daysOfCover < 7 ? "SEVERE" : f.daysOfCover < 30 ? "WARNING" : "INFO";
    findings.push({
      kind: "SHORTFALL_FORECAST",
      severity,
      title: `${f.class}: ${f.daysOfCover.toFixed(1)} days of cover remaining`,
      message:
        `${f.class} holds ${formatUsdc(f.held)} against ${formatUsdc(f.owed)} owed, a surplus of ` +
        `${formatUsdc(f.surplus)}. Across the ${f.observationDays.toFixed(2)} days between blocks ` +
        `${f.firstBlock} and ${f.lastBlock} that surplus fell by ${Math.abs(Math.round(f.netPerDay))} ` +
        `base units per day. At that rate cover reaches zero in ${f.daysOfCover.toFixed(1)} days. ` +
        `This is a straight-line projection from indexed flows, not a prediction of intent.`,
      evidence,
      fingerprint: `SHORTFALL_FORECAST:${f.class}:depleting`
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Shortfall episodes — what the NL interface answers "was it ever short" from
// ---------------------------------------------------------------------------

export interface ShortfallEpisode {
  class: AccountClass;
  startBlock: bigint;
  startTimestamp: bigint;
  endBlock: bigint;
  endTimestamp: bigint;
  /** Still open when the last indexed snapshot for the class is still short. */
  ongoing: boolean;
  worstRatioBps: bigint;
  worstDeficit: bigint;
  snapshots: number;
  startTx: string;
}

/**
 * Contiguous runs of `shortfall: true` in a class's snapshot history, with the
 * block and timestamp each run opened and closed at. FR-7.5 asks the Monitor to
 * answer "was this business ever short in August" with dates and block numbers;
 * this is where those come from.
 */
export function shortfallEpisodes(
  coverage: readonly CoverageSnapshotWithTx[]
): ShortfallEpisode[] {
  const episodes: ShortfallEpisode[] = [];

  for (const cls of [...new Set(coverage.map((c) => c.class))]) {
    const rows = coverage
      .filter((c) => c.class === cls)
      .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));

    let current: ShortfallEpisode | null = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (row.shortfall) {
        if (!current) {
          current = {
            class: cls,
            startBlock: row.blockNumber,
            startTimestamp: row.timestamp,
            endBlock: row.blockNumber,
            endTimestamp: row.timestamp,
            ongoing: true,
            worstRatioBps: row.ratioBps,
            worstDeficit: abs(row.surplus),
            snapshots: 0,
            startTx: row.txHash
          };
        }
        current.endBlock = row.blockNumber;
        current.endTimestamp = row.timestamp;
        current.snapshots += 1;
        if (row.ratioBps < current.worstRatioBps) current.worstRatioBps = row.ratioBps;
        if (abs(row.surplus) > current.worstDeficit) current.worstDeficit = abs(row.surplus);
        // The run closes at the first covered snapshot after it; if none comes,
        // it is still open at the indexer head.
        current.ongoing = i === rows.length - 1;
      } else if (current) {
        current.endBlock = row.blockNumber;
        current.endTimestamp = row.timestamp;
        current.ongoing = false;
        episodes.push(current);
        current = null;
      }
    }
    if (current) episodes.push(current);
  }

  return episodes.sort((a, b) => (a.startBlock < b.startBlock ? -1 : 1));
}

function shortfallHistoryFindings(snapshot: MonitorSnapshot): Finding[] {
  return shortfallEpisodes(snapshot.coverage)
    .filter((e) => !e.ongoing) // an open episode is already reported by the forecast
    .map((e) => ({
      kind: "SHORTFALL_HISTORY" as const,
      severity: "WARNING" as Severity,
      title: `${e.class} was short between blocks ${e.startBlock} and ${e.endBlock}`,
      message:
        `${e.class} fell below full cover at block ${e.startBlock} (${iso(e.startTimestamp)}) and was ` +
        `back in cover by block ${e.endBlock} (${iso(e.endTimestamp)}). At its worst the class held ` +
        `${(Number(e.worstRatioBps) / 100).toFixed(2)}% of what it owed, a deficit of ` +
        `${formatUsdc(e.worstDeficit)}. The episode is closed but it happened, and the indexed ` +
        `snapshots that record it cannot be edited.`,
      evidence: {
        class: e.class,
        startBlock: e.startBlock.toString(),
        startTimestamp: iso(e.startTimestamp),
        startTx: e.startTx,
        endBlock: e.endBlock.toString(),
        endTimestamp: iso(e.endTimestamp),
        worstRatioBps: e.worstRatioBps.toString(),
        worstDeficit: e.worstDeficit.toString(),
        snapshotsInEpisode: e.snapshots,
        source: "CoverageSnapshot entities (subgraph)"
      },
      fingerprint: `SHORTFALL_HISTORY:${e.class}:${e.startBlock}`
    }));
}

// ---------------------------------------------------------------------------
// Mandate drift (FR-7.3) — the compromised-backend detector
// ---------------------------------------------------------------------------

export interface SplitRatio {
  accountId: string;
  label: string;
  class: AccountClass;
  amount: bigint;
  /** `amount ÷ deposit` in basis points, floored. Display and reporting only. */
  bps: bigint;
}

export interface DepositRatios {
  depositId: string;
  amount: bigint;
  mandateVersion: bigint;
  blockNumber: bigint;
  timestamp: bigint;
  txHash: string;
  splitTotal: bigint;
  ratios: SplitRatio[];
}

/** A deposit's realized allocation, as the index recorded it. */
export function depositRatios(d: DepositWithSplitsResult): DepositRatios {
  // A deposit may produce more than one SplitExecuted per account in principle;
  // sum per account so the comparison is over allocations, not over events.
  const byAccount = new Map<string, SplitRatio>();
  for (const s of d.splits) {
    const existing = byAccount.get(s.account.id);
    if (existing) {
      existing.amount += s.amount;
    } else {
      byAccount.set(s.account.id, {
        accountId: s.account.id,
        label: s.account.label,
        class: s.account.class,
        amount: s.amount,
        bps: 0n
      });
    }
  }
  const ratios = [...byAccount.values()].sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
  for (const r of ratios) {
    r.bps = d.amount === 0n ? 0n : (r.amount * BPS) / d.amount;
  }

  return {
    depositId: d.id,
    amount: d.amount,
    mandateVersion: d.mandateVersion,
    blockNumber: d.blockNumber,
    timestamp: d.timestamp,
    txHash: d.txHash,
    splitTotal: d.splitTotal,
    ratios
  };
}

export interface DriftDetail {
  accountId: string;
  label: string;
  class: AccountClass;
  expected: bigint;
  actual: bigint;
  delta: bigint;
  expectedBps: bigint;
  actualBps: bigint;
}

export interface DivergentDeposit {
  deposit: DepositRatios;
  details: DriftDetail[];
  /** Total moved away from where the baseline says it should have gone. */
  misallocated: bigint;
  destinationSetChanged: boolean;
}

export interface DriftReport {
  mandateVersion: bigint;
  ratified: MandateResult | null;
  baseline: DepositRatios | null;
  conforming: DepositRatios[];
  divergent: DivergentDeposit[];
  /** True when the most recent deposit under this version is divergent. */
  ongoing: boolean;
}

/**
 * Compares each deposit's realized split against the allocation the *first*
 * deposit under the same mandate version produced, and reports every deposit
 * that diverges.
 *
 * Why the first deposit and not a configured ratio table: the published bps live
 * in Postgres, and Postgres is exactly what a compromised backend controls. The
 * chain carries the mandate's `rulesHash`, not the ratios themselves, so there is
 * no way to read the intended ratios off the index. What the index *does* carry,
 * immutably, is what the splitter actually did the first time it ran under a
 * quorum-ratified version. Anchoring on that means an attacker who takes the
 * backend today cannot retroactively make yesterday's baseline agree with them.
 *
 * The comparison is exact bigint cross-multiplication — `split_i · baseAmount`
 * against `baseSplit_i · amount` — so deposits of different sizes compare
 * correctly and no float ever touches a money figure. The tolerance is one base
 * unit, which is the most `computeSplits`'s cumulative-basis-point allocation can
 * differ by (`mandate.ts`).
 *
 * ponytail: the first deposit under a version is trusted. A splitter compromised
 * *before* the very first deposit of a brand-new mandate version would set its own
 * baseline. Upgrade path: put the ratios themselves — not just their hash —
 * behind `MandatePublished`, and anchor on that instead.
 */
export function detectDrift(
  deposits: readonly DepositWithSplitsResult[],
  mandates: readonly MandateResult[],
  toleranceUnits = 1n
): DriftReport[] {
  const byVersion = new Map<string, DepositWithSplitsResult[]>();
  for (const d of deposits) {
    const key = d.mandateVersion.toString();
    const arr = byVersion.get(key) ?? [];
    arr.push(d);
    byVersion.set(key, arr);
  }

  const reports: DriftReport[] = [];

  for (const [versionKey, group] of byVersion) {
    const ordered = [...group].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
    const version = BigInt(versionKey);
    const ratified = mandates.find((m) => m.version === version) ?? null;

    const baselineDeposit = ordered[0];
    if (!baselineDeposit) continue;
    const baseline = depositRatios(baselineDeposit);

    const conforming: DepositRatios[] = [];
    const divergent: DivergentDeposit[] = [];

    for (const d of ordered.slice(1)) {
      const actual = depositRatios(d);
      const accounts = new Set([
        ...baseline.ratios.map((r) => r.accountId),
        ...actual.ratios.map((r) => r.accountId)
      ]);

      const details: DriftDetail[] = [];
      let misallocated = 0n;
      let destinationSetChanged = false;

      for (const accountId of accounts) {
        const base = baseline.ratios.find((r) => r.accountId === accountId);
        const got = actual.ratios.find((r) => r.accountId === accountId);
        if (!base || !got) destinationSetChanged = true;

        const baseAmount = base?.amount ?? 0n;
        const gotAmount = got?.amount ?? 0n;
        // expected = baseAmount · amount / baselineAmount, exact in bigint.
        const expected =
          baseline.amount === 0n ? 0n : (baseAmount * actual.amount) / baseline.amount;
        const delta = gotAmount - expected;

        if (abs(delta) > toleranceUnits) {
          const meta = got ?? base!;
          details.push({
            accountId,
            label: meta.label,
            class: meta.class,
            expected,
            actual: gotAmount,
            delta,
            expectedBps:
              actual.amount === 0n ? 0n : (expected * BPS) / actual.amount,
            actualBps: actual.amount === 0n ? 0n : (gotAmount * BPS) / actual.amount
          });
          if (delta < 0n) misallocated += -delta;
        }
      }

      if (details.length === 0) {
        conforming.push(actual);
      } else {
        divergent.push({ deposit: actual, details, misallocated, destinationSetChanged });
      }
    }

    const lastDeposit = ordered[ordered.length - 1];
    reports.push({
      mandateVersion: version,
      ratified,
      baseline,
      conforming,
      divergent,
      ongoing: divergent.some((d) => d.deposit.depositId === lastDeposit?.id)
    });
  }

  return reports.sort((a, b) => (a.mandateVersion < b.mandateVersion ? -1 : 1));
}

function driftFindings(snapshot: MonitorSnapshot): Finding[] {
  const findings: Finding[] = [];
  const reports = detectDrift(snapshot.deposits, snapshot.mandates);
  const slug = snapshot.business.slug;

  // A deposit whose splits do not add up to the deposit is unallocated money
  // (FR-3.8) and is visible here whether or not the splitter said so.
  for (const d of snapshot.deposits) {
    if (d.splitTotal === d.amount) continue;
    const gap = d.amount - d.splitTotal;
    findings.push({
      kind: "UNALLOCATED_DEPOSIT",
      severity: "SEVERE",
      title: `Deposit at block ${d.blockNumber} is only partly allocated`,
      message:
        `The deposit observed in ${d.txHash} at block ${d.blockNumber} (${iso(d.timestamp)}) was ` +
        `${formatUsdc(d.amount)}, but the ${d.splits.length} SplitExecuted events indexed against it ` +
        `total ${formatUsdc(d.splitTotal)}. ${formatUsdc(abs(gap))} ${gap > 0n ? "never reached a destination account" : "was allocated twice or over-allocated"}. ` +
        `The chain says this, not the splitter's own report of what it did.`,
      evidence: {
        depositId: d.id,
        txHash: d.txHash,
        blockNumber: d.blockNumber.toString(),
        timestamp: iso(d.timestamp),
        depositAmount: d.amount.toString(),
        splitTotal: d.splitTotal.toString(),
        gap: gap.toString(),
        splits: d.splits.map((s) => ({
          account: s.account.id,
          class: s.account.class,
          amount: s.amount.toString(),
          txHash: s.txHash
        })),
        source: "DepositObserved + SplitExecuted events (subgraph)"
      },
      fingerprint: `UNALLOCATED_DEPOSIT:${d.id}`
    });
  }

  for (const report of reports) {
    const version = report.mandateVersion;
    const depositCount = report.conforming.length + report.divergent.length + 1;

    if (!report.ratified) {
      findings.push({
        kind: "UNRATIFIED_MANDATE",
        severity: "SEVERE",
        title: `Mandate version ${version} was never published on chain`,
        message:
          `${depositCount} deposit${depositCount === 1 ? " claims" : "s claim"} to have been split under ` +
          `mandate version ${version}, but no MandatePublished event for version ${version} exists for ` +
          `${slug}. FR-4.2 requires a key quorum to publish a mandate and to emit that event, so a version ` +
          `deposits reference but the chain has never seen is a version no quorum ratified — the ratios ` +
          `it was split by exist only in the backend's own database.`,
        evidence: {
          mandateVersion: version.toString(),
          depositsUnderVersion: depositCount,
          versionsPublishedOnChain: snapshot.mandates.map((m) => m.version.toString()),
          firstDeposit: {
            txHash: report.baseline?.txHash,
            blockNumber: report.baseline?.blockNumber.toString()
          },
          source: "DepositObserved.mandateVersion vs MandatePublished events (subgraph)"
        },
        fingerprint: `UNRATIFIED_MANDATE:${slug}:${version}`
      });
    }

    if (report.divergent.length === 0) {
      if (report.conforming.length === 0) continue; // one deposit: nothing to compare
      findings.push({
        kind: "MANDATE_DRIFT",
        severity: "INFO",
        title: `Mandate version ${version}: ${depositCount} deposits, no drift`,
        message:
          `Every one of the ${report.conforming.length} deposits after the first under mandate version ` +
          `${version} split in the same ratio as the first — ` +
          `${report.baseline?.ratios.map((r) => `${r.bps} bps ${r.class}`).join(", ")} — within one base ` +
          `unit of rounding. The splitter is doing what it did on day one.`,
        evidence: {
          mandateVersion: version.toString(),
          baselineDepositTx: report.baseline?.txHash,
          baselineBlock: report.baseline?.blockNumber.toString(),
          baselineRatios: report.baseline?.ratios.map((r) => ({
            account: r.accountId,
            class: r.class,
            bps: r.bps.toString()
          })),
          conformingDeposits: report.conforming.map((d) => ({
            txHash: d.txHash,
            blockNumber: d.blockNumber.toString()
          })),
          source: "Deposit + Split entities (subgraph)"
        },
        fingerprint: `MANDATE_DRIFT:${slug}:${version}:clean`
      });
      continue;
    }

    const totalMisallocated = report.divergent.reduce((s, d) => s + d.misallocated, 0n);
    const severity: Severity = report.divergent.length >= 2 ? "SEVERE" : "WARNING";

    // Losers and gainers, aggregated across every divergent deposit, because
    // "88% became 83%" is the sentence an operator needs, not a per-deposit table.
    const perAccount = new Map<string, { label: string; class: AccountClass; delta: bigint; expectedBps: bigint; actualBps: bigint }>();
    for (const dv of report.divergent) {
      for (const detail of dv.details) {
        const entry = perAccount.get(detail.accountId) ?? {
          label: detail.label,
          class: detail.class,
          delta: 0n,
          expectedBps: detail.expectedBps,
          actualBps: detail.actualBps
        };
        entry.delta += detail.delta;
        entry.expectedBps = detail.expectedBps;
        entry.actualBps = detail.actualBps;
        perAccount.set(detail.accountId, entry);
      }
    }
    const movement = [...perAccount.entries()]
      .sort((a, b) => (a[1].delta < b[1].delta ? -1 : 1))
      .map(
        ([id, e]) =>
          `${e.class} (${e.label}, ${id.slice(0, 10)}…) ${e.expectedBps} bps → ${e.actualBps} bps, ` +
          `${e.delta < 0n ? "−" : "+"}${formatUsdc(abs(e.delta)).replace(" USDC", "")} USDC`
      )
      .join("; ");

    // Coverage stays at 100% when the splitter accrues an obligation equal to what
    // it actually paid — the reason this check cannot be replaced by watching the
    // coverage line.
    const divergentBlocks = report.divergent.map((d) => d.deposit.blockNumber);
    const earliestDivergent = divergentBlocks.reduce((a, b) => (a < b ? a : b));
    const coverageMasked = !snapshot.coverage.some(
      (c) => c.blockNumber >= earliestDivergent && c.shortfall
    );

    findings.push({
      kind: "MANDATE_DRIFT",
      severity,
      title:
        `Splits diverged from mandate version ${version} on ` +
        `${report.divergent.length} deposit${report.divergent.length === 1 ? "" : "s"}`,
      message:
        `The first deposit under mandate version ${version} (block ${report.baseline?.blockNumber}, ` +
        `${report.baseline?.txHash}) split ` +
        `${report.baseline?.ratios.map((r) => `${r.bps} bps to ${r.class}`).join(", ")}. ` +
        `${report.conforming.length} later deposit${report.conforming.length === 1 ? "" : "s"} matched it. ` +
        `${report.divergent.length} did not: ${movement}. ` +
        `Across those deposits ${formatUsdc(totalMisallocated)} went somewhere the baseline ratio does not ` +
        `put it, while every one of them still reported mandateVersion ${version}. ` +
        (report.ongoing ? "The most recent deposit is divergent, so this is ongoing. " : "") +
        (coverageMasked
          ? "Coverage never dropped below 100% during this window, because the obligation accrued on each " +
            "deposit matches what was actually paid — the coverage line cannot see this, only the ratio " +
            "comparison can. "
          : "") +
        `This is the signature of a splitter paying ratios other than the ones its mandate version claims.`,
      evidence: {
        mandateVersion: version.toString(),
        mandateRatifiedOnChain: report.ratified
          ? { block: report.ratified.blockNumber.toString(), txHash: report.ratified.txHash, rulesHash: report.ratified.rulesHash }
          : null,
        baseline: {
          txHash: report.baseline?.txHash,
          blockNumber: report.baseline?.blockNumber.toString(),
          timestamp: report.baseline ? iso(report.baseline.timestamp) : null,
          amount: report.baseline?.amount.toString(),
          ratios: report.baseline?.ratios.map((r) => ({
            account: r.accountId,
            class: r.class,
            label: r.label,
            amount: r.amount.toString(),
            bps: r.bps.toString()
          }))
        },
        conformingDeposits: report.conforming.map((d) => ({
          txHash: d.txHash,
          blockNumber: d.blockNumber.toString()
        })),
        divergentDeposits: report.divergent.map((dv) => ({
          txHash: dv.deposit.txHash,
          blockNumber: dv.deposit.blockNumber.toString(),
          timestamp: iso(dv.deposit.timestamp),
          amount: dv.deposit.amount.toString(),
          misallocated: dv.misallocated.toString(),
          destinationSetChanged: dv.destinationSetChanged,
          perAccount: dv.details.map((d) => ({
            account: d.accountId,
            class: d.class,
            label: d.label,
            expected: d.expected.toString(),
            actual: d.actual.toString(),
            delta: d.delta.toString(),
            expectedBps: d.expectedBps.toString(),
            actualBps: d.actualBps.toString()
          }))
        })),
        totalMisallocated: totalMisallocated.toString(),
        totalMisallocatedReadable: formatUsdc(totalMisallocated),
        ongoing: report.ongoing,
        coverageStayedAtFullCover: coverageMasked,
        source: "Deposit + Split + Mandate entities (subgraph)"
      },
      fingerprint: `MANDATE_DRIFT:${slug}:${version}:${report.divergent
        .map((d) => d.deposit.depositId.slice(0, 10))
        .join(",")}`
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Unlock anomalies (FR-7.4) — against this business's own baseline
// ---------------------------------------------------------------------------

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Unlock frequency and size outside the business's own history (FR-7.4).
 *
 * Three checks, each against a baseline computed from *this* business's prior
 * unlocks only — there is no cross-business norm here, and no configured
 * threshold:
 *
 *  - **size**: an unlock more than three standard deviations above the mean of
 *    every unlock that preceded it.
 *  - **frequency**: an unlock arriving in less than a quarter of the median gap
 *    between the unlocks before it, once there are at least three gaps to take a
 *    median of.
 *  - **exceeds held**: an unlock for more than the account holds. Not a
 *    statistical anomaly at all — an arithmetic one, and worth saying out loud.
 */
function unlockFindings(snapshot: MonitorSnapshot): Finding[] {
  const findings: Finding[] = [];
  const unlocks = [...snapshot.unlocks].sort((a, b) =>
    a.requestedAtBlock < b.requestedAtBlock ? -1 : 1
  );
  const slug = snapshot.business.slug;
  const heldByAccount = new Map(snapshot.business.accounts.map((a) => [a.id.toLowerCase(), a.held]));

  if (unlocks.length === 0) return findings;

  if (unlocks.length < 3) {
    findings.push({
      kind: "UNLOCK_ANOMALY",
      severity: "INFO",
      title: `Unlock baseline not established (${unlocks.length} unlock${unlocks.length === 1 ? "" : "s"})`,
      message:
        `${slug} has ${unlocks.length} indexed unlock${unlocks.length === 1 ? "" : "s"}. Three are needed ` +
        `before "outside this business's own baseline" means anything, so no size or frequency judgement ` +
        `is offered here. The unlocks themselves are listed on the public page regardless.`,
      evidence: {
        unlocks: unlocks.map((u) => ({
          id: u.id,
          amount: u.amount.toString(),
          blockNumber: u.requestedAtBlock.toString(),
          timestamp: iso(u.requestedAtTimestamp)
        })),
        source: "Unlock entities (subgraph)"
      },
      fingerprint: `UNLOCK_ANOMALY:${slug}:baseline`
    });
  }

  for (let i = 0; i < unlocks.length; i++) {
    const u = unlocks[i]!;
    const prior = unlocks.slice(0, i);

    // --- size, against every unlock that came before it -------------------
    if (prior.length >= 3) {
      const amounts = prior.map((p) => Number(p.amount));
      const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const variance =
        amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
      const stdev = Math.sqrt(variance);
      const z = stdev > 0 ? (Number(u.amount) - mean) / stdev : 0;
      if (stdev > 0 && z > 3) {
        findings.push({
          kind: "UNLOCK_ANOMALY",
          severity: "WARNING",
          title: `Unlock at block ${u.requestedAtBlock} is ${z.toFixed(1)}σ above this business's norm`,
          message:
            `${slug} requested ${formatUsdc(u.amount)} from ${u.account.label} at block ` +
            `${u.requestedAtBlock} (${iso(u.requestedAtTimestamp)}). The ${prior.length} unlocks before it ` +
            `averaged ${formatUsdc(BigInt(Math.round(mean)))} with a standard deviation of ` +
            `${formatUsdc(BigInt(Math.round(stdev)))}, putting this one ${z.toFixed(1)} deviations out. ` +
            `Size alone is not misconduct — it is a reason to look at the reason text and the approver set.`,
          evidence: {
            unlockId: u.id,
            amount: u.amount.toString(),
            blockNumber: u.requestedAtBlock.toString(),
            timestamp: iso(u.requestedAtTimestamp),
            requestedTx: u.requestedTx,
            priorUnlockCount: prior.length,
            priorMeanBaseUnits: Math.round(mean),
            priorStdevBaseUnits: Math.round(stdev),
            zScore: Number(z.toFixed(3)),
            source: "Unlock entities (subgraph)"
          },
          fingerprint: `UNLOCK_ANOMALY:size:${u.id}`
        });
      }
    }

    // --- frequency, against the median gap of everything before it --------
    if (i >= 4) {
      const gaps: number[] = [];
      for (let j = 1; j <= i - 1; j++) {
        gaps.push(Number(unlocks[j]!.requestedAtTimestamp - unlocks[j - 1]!.requestedAtTimestamp));
      }
      const gap = Number(u.requestedAtTimestamp - unlocks[i - 1]!.requestedAtTimestamp);
      const med = median(gaps);
      if (med > 0 && gap < med / 4) {
        findings.push({
          kind: "UNLOCK_ANOMALY",
          severity: "WARNING",
          title: `Unlock at block ${u.requestedAtBlock} arrived ${(med / Math.max(gap, 1)).toFixed(1)}× faster than usual`,
          message:
            `This unlock followed the previous one after ${gap}s. The median gap across the ` +
            `${gaps.length} intervals before it was ${Math.round(med)}s, so it arrived in under a quarter ` +
            `of the usual spacing. Requests for ${formatUsdc(u.amount)} clustered this tightly are the ` +
            `shape a scripted drain makes; the World Selfie Check on each approval is what stops one ` +
            `completing, but the clustering itself is worth surfacing.`,
          evidence: {
            unlockId: u.id,
            blockNumber: u.requestedAtBlock.toString(),
            timestamp: iso(u.requestedAtTimestamp),
            previousUnlockBlock: unlocks[i - 1]!.requestedAtBlock.toString(),
            gapSeconds: gap,
            medianPriorGapSeconds: Math.round(med),
            priorGapCount: gaps.length,
            amount: u.amount.toString(),
            source: "Unlock entities (subgraph)"
          },
          fingerprint: `UNLOCK_ANOMALY:frequency:${u.id}`
        });
      }
    }

  }

  // --- arithmetic, not statistics -----------------------------------------
  // Reported once per account rather than once per unlock: eight open requests
  // against the same empty account are one fact about that account, and eight
  // identical alerts is how an operator learns to stop reading them.
  const overdrawnByAccount = new Map<string, UnlockResult[]>();
  for (const u of unlocks) {
    const held = heldByAccount.get(u.account.id.toLowerCase());
    if (held === undefined || u.status === "CANCELLED" || u.status === "EXECUTED") continue;
    if (u.amount <= held) continue;
    const arr = overdrawnByAccount.get(u.account.id) ?? [];
    arr.push(u);
    overdrawnByAccount.set(u.account.id, arr);
  }

  for (const [accountId, group] of overdrawnByAccount) {
    const held = heldByAccount.get(accountId.toLowerCase()) ?? 0n;
    const total = group.reduce((s, u) => s + u.amount, 0n);
    const latest = group[group.length - 1]!;
    findings.push({
      kind: "UNLOCK_ANOMALY",
      severity: "WARNING",
      title:
        `${group.length} open unlock${group.length === 1 ? "" : "s"} on ${latest.account.label} ` +
        `exceed${group.length === 1 ? "s" : ""} its balance`,
      message:
        `${latest.account.label} (${accountId}) holds ${formatUsdc(held)} on chain, but ` +
        `${group.length} unexecuted unlock request${group.length === 1 ? "" : "s"} against it total ` +
        `${formatUsdc(total)} — the most recent at block ${latest.requestedAtBlock} ` +
        `(${iso(latest.requestedAtTimestamp)}). None of them can settle in full at the current balance. ` +
        `Either the requests are stale, the balance has already moved, or the amounts were never ` +
        `grounded in the account.`,
      evidence: {
        account: accountId,
        accountClass: latest.account.class,
        accountHeld: held.toString(),
        openRequestCount: group.length,
        totalRequested: total.toString(),
        requests: group.map((u) => ({
          unlockId: u.id,
          amount: u.amount.toString(),
          status: u.status,
          blockNumber: u.requestedAtBlock.toString(),
          timestamp: iso(u.requestedAtTimestamp),
          requestedTx: u.requestedTx,
          approvalCount: u.approvalCount
        })),
        source: "Unlock entities vs Account.held (USDC balanceOf, subgraph)"
      },
      fingerprint: `UNLOCK_ANOMALY:exceeds-held:${accountId}:${group.length}`
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = { SEVERE: 0, WARNING: 1, INFO: 2 };

/**
 * Every check, over one indexed snapshot. Sorted most severe first, which is the
 * order the public page and the agent loop both want.
 */
export function runChecks(snapshot: MonitorSnapshot): Finding[] {
  return [
    ...driftFindings(snapshot),
    ...forecastFindings(snapshot),
    ...shortfallHistoryFindings(snapshot),
    ...unlockFindings(snapshot)
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
