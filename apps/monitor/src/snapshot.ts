/**
 * Loading the Monitor's world, and shaping it for the natural-language
 * interface.
 *
 * FR-7.1 is absolute: the deployed subgraph is the *only* data source. Every
 * call below goes through `@bolt/core`'s subgraph client — there is no RPC read,
 * no Postgres read, no cached JSON and no constant standing in for a figure. If
 * the subgraph is unreachable the Monitor says so and answers nothing, which is
 * the correct behaviour for an agent whose entire claim is that it reads the
 * same public index anyone else can.
 */
import {
  queryBusinessBySlug,
  queryCoverageHistory,
  queryDeposits,
  queryIndexerHead,
  queryMandates,
  queryUnlocks,
  runChecks,
  shortfallEpisodes,
  depositRatios,
  formatUsdc,
  type Finding,
  type MonitorSnapshot
} from "@bolt/core";

export class BusinessNotIndexed extends Error {
  constructor(slug: string) {
    super(`no business with slug "${slug}" is indexed by the subgraph`);
    this.name = "BusinessNotIndexed";
  }
}

/** Everything the Monitor knows about one business, as of the indexer head. */
export async function loadSnapshot(
  subgraphUrl: string,
  slug: string
): Promise<MonitorSnapshot> {
  const business = await queryBusinessBySlug(subgraphUrl, slug);
  if (!business) throw new BusinessNotIndexed(slug);

  const [coverage, deposits, mandates, unlocks, head] = await Promise.all([
    queryCoverageHistory(subgraphUrl, business.id),
    queryDeposits(subgraphUrl, business.id),
    queryMandates(subgraphUrl, business.id),
    queryUnlocks(subgraphUrl, business.id),
    queryIndexerHead(subgraphUrl)
  ]);

  return { business, coverage, deposits, mandates, unlocks, indexedAtBlock: head.blockNumber };
}

const iso = (unixSeconds: bigint): string =>
  new Date(Number(unixSeconds) * 1000).toISOString();

/**
 * The snapshot flattened into the JSON the model reasons over.
 *
 * Two rules shaped this: every fact carries the block number and, where one
 * exists, the transaction hash it came from — so an answer can cite them and a
 * reader can check them; and nothing is summarised away that a question might
 * need, because the model cannot go back and ask a second query.
 *
 * ponytail: the whole history goes in one prompt. Fine at the scale a hackathon
 * testnet produces (hundreds of snapshots). If it ever stops fitting, give the
 * model the subgraph client as a tool and let it query — the queries already
 * exist in `@bolt/core`.
 */
export function evidenceBundle(snapshot: MonitorSnapshot, findings: Finding[]) {
  return {
    asOf: {
      indexedAtBlock: snapshot.indexedAtBlock.toString(),
      note:
        "Every figure below is an indexed BoltRegistry event or an on-chain USDC " +
        "balance read by the subgraph. Amounts are USDC base units (6 decimals) " +
        "unless a field says 'Readable'."
    },
    business: {
      slug: snapshot.business.slug,
      businessId: snapshot.business.id,
      admin: snapshot.business.admin,
      registeredAtBlock: snapshot.business.registeredAtBlock.toString(),
      registeredAt: iso(snapshot.business.registeredAtTimestamp),
      depositCount: snapshot.business.depositCount.toString(),
      totalDeposited: snapshot.business.totalDeposited.toString(),
      latestMandateVersionOnChain: snapshot.business.mandateVersion.toString()
    },
    accounts: snapshot.business.accounts.map((a) => ({
      address: a.id,
      class: a.class,
      label: a.label,
      held: a.held.toString(),
      heldReadable: formatUsdc(a.held),
      heldAtBlock: a.heldAtBlock.toString(),
      owed: a.owed.toString(),
      totalIn: a.totalIn.toString(),
      totalOut: a.totalOut.toString(),
      registeredAtBlock: a.registeredAtBlock.toString(),
      policyHash: a.policyHash
    })),
    coverageHistory: snapshot.coverage.map((c) => ({
      blockNumber: c.blockNumber.toString(),
      timestamp: iso(c.timestamp),
      class: c.class,
      held: c.held.toString(),
      owed: c.owed.toString(),
      ratioBps: c.ratioBps.toString(),
      shortfall: c.shortfall,
      surplus: c.surplus.toString(),
      trigger: c.trigger,
      txHash: c.txHash
    })),
    shortfallEpisodes: shortfallEpisodes(snapshot.coverage).map((e) => ({
      class: e.class,
      startBlock: e.startBlock.toString(),
      startTimestamp: iso(e.startTimestamp),
      endBlock: e.endBlock.toString(),
      endTimestamp: iso(e.endTimestamp),
      ongoing: e.ongoing,
      worstRatioBps: e.worstRatioBps.toString(),
      worstDeficit: e.worstDeficit.toString()
    })),
    depositsAndSplits: snapshot.deposits.map((d) => {
      const r = depositRatios(d);
      return {
        depositId: d.id,
        txHash: d.txHash,
        blockNumber: d.blockNumber.toString(),
        timestamp: iso(d.timestamp),
        amount: d.amount.toString(),
        amountReadable: formatUsdc(d.amount),
        mandateVersionClaimed: d.mandateVersion.toString(),
        splitTotal: d.splitTotal.toString(),
        splits: r.ratios.map((s) => ({
          account: s.accountId,
          class: s.class,
          label: s.label,
          amount: s.amount.toString(),
          realizedBps: s.bps.toString()
        }))
      };
    }),
    mandatesPublishedOnChain: snapshot.mandates.map((m) => ({
      version: m.version.toString(),
      rulesHash: m.rulesHash,
      quorumRef: m.quorumRef,
      blockNumber: m.blockNumber.toString(),
      timestamp: iso(m.timestamp),
      txHash: m.txHash,
      note:
        "MandatePublished carries the hash of the rules, not the ratios themselves. " +
        "The ratios a deposit was actually split by are in depositsAndSplits."
    })),
    unlocks: snapshot.unlocks.map((u) => ({
      unlockId: u.id,
      account: u.account.id,
      accountClass: u.account.class,
      accountLabel: u.account.label,
      amount: u.amount.toString(),
      amountReadable: formatUsdc(u.amount),
      destination: u.destination,
      reasonHash: u.reasonHash,
      status: u.status,
      approvalCount: u.approvalCount,
      requestedAtBlock: u.requestedAtBlock.toString(),
      requestedAt: iso(u.requestedAtTimestamp),
      requestedTx: u.requestedTx,
      executedAtBlock: u.executedAtBlock?.toString() ?? null,
      executedAt: u.executedAtTimestamp ? iso(u.executedAtTimestamp) : null,
      approvals: u.approvals.map((a) => ({
        approver: a.approver,
        worldSelfieCheckProofRef: a.humanProofRef,
        blockNumber: a.blockNumber.toString(),
        timestamp: iso(a.timestamp),
        txHash: a.txHash
      }))
    })),
    findings: findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      title: f.title,
      message: f.message,
      evidence: f.evidence
    }))
  };
}

/** Load, check and bundle in one step — what both the loop and `/ask` want. */
export async function analyse(
  subgraphUrl: string,
  slug: string
): Promise<{ snapshot: MonitorSnapshot; findings: Finding[]; bundle: ReturnType<typeof evidenceBundle> }> {
  const snapshot = await loadSnapshot(subgraphUrl, slug);
  const findings = runChecks(snapshot);
  return { snapshot, findings, bundle: evidenceBundle(snapshot, findings) };
}
