import { z } from "zod";

/**
 * Typed GraphQL client for the deployed BOLT subgraph (Phase 4). A plain HTTP
 * POST against Subgraph Studio's query endpoint — no sponsor-specific auth
 * scheme to get wrong here, just a standard GraphQL request. Every response is
 * Zod-validated before use (house convention, CLAUDE.md conventions).
 *
 * `held`/`owed`/`ratioBps`/`surplus` all arrive as GraphQL `BigInt` scalars,
 * which The Graph serializes as decimal strings — never parsed as `number`.
 */

export class SubgraphQueryError extends Error {
  constructor(
    message: string,
    public readonly graphqlErrors?: unknown
  ) {
    super(message);
    this.name = "SubgraphQueryError";
  }
}

export async function querySubgraph<S extends z.ZodTypeAny>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  responseSchema: S
): Promise<z.infer<S>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    throw new SubgraphQueryError(`subgraph query failed: HTTP ${res.status}`);
  }

  const body: unknown = await res.json();
  const envelope = z
    .object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() })
    .parse(body);

  if (envelope.errors && envelope.errors.length > 0) {
    throw new SubgraphQueryError("subgraph returned GraphQL errors", envelope.errors);
  }

  return responseSchema.parse(envelope.data);
}

const bigIntString = z.string().transform((v) => BigInt(v));

const coverageSnapshotSchema = z.object({
  class: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"]),
  held: bigIntString,
  owed: bigIntString,
  ratioBps: bigIntString,
  shortfall: z.boolean(),
  surplus: bigIntString,
  trigger: z.string(),
  blockNumber: bigIntString,
  timestamp: bigIntString
});

export type CoverageSnapshotResult = z.infer<typeof coverageSnapshotSchema>;

/**
 * The three account classes a `CoverageSnapshot` can carry (`account-class.ts`
 * duplicated as a literal tuple here so it can sit in a GraphQL variable).
 */
const COVERAGE_CLASSES = ["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"] as const;

const COVERAGE_AT_BLOCK_QUERY = /* GraphQL */ `
  query CoverageAtBlock($businessId: Bytes!, $class: AccountClass!, $block: BigInt!) {
    coverageSnapshots(
      where: { business: $businessId, class: $class, blockNumber_lte: $block }
      orderBy: blockNumber
      orderDirection: desc
      first: 1
    ) {
      class
      held
      owed
      ratioBps
      shortfall
      surplus
      trigger
      blockNumber
      timestamp
    }
  }
`;

/**
 * Coverage for every account class of a business, as of the latest indexed
 * event at or before `atBlock` — FR-6.4, "coverage at an arbitrary past block".
 *
 * One query per class (run in parallel), each asking for that class's own
 * latest snapshot at-or-before the block. A single `first: 3` query ordered
 * by block across all classes together is NOT equivalent: when one class has
 * more recent activity than another, its rows crowd out the other classes'
 * more-recent-but-still-older rows, silently dropping or duplicating a class
 * (caught live against `acme-marketplace`'s real history — OPERATING's own
 * latest snapshot was crowded out by two OBLIGATION_RESERVE rows).
 */
export async function queryCoverageAtBlock(
  url: string,
  businessId: string,
  atBlock: bigint
): Promise<CoverageSnapshotResult[]> {
  const perClass = await Promise.all(
    COVERAGE_CLASSES.map((cls) =>
      querySubgraph(
        url,
        COVERAGE_AT_BLOCK_QUERY,
        { businessId, class: cls, block: atBlock.toString() },
        z.object({ coverageSnapshots: z.array(coverageSnapshotSchema) }).transform((d) => d.coverageSnapshots)
      )
    )
  );
  return perClass.flat();
}

const LATEST_COVERAGE_QUERY = /* GraphQL */ `
  query LatestCoverage($businessId: Bytes!, $class: AccountClass!) {
    coverageSnapshots(
      where: { business: $businessId, class: $class }
      orderBy: blockNumber
      orderDirection: desc
      first: 1
    ) {
      class
      held
      owed
      ratioBps
      shortfall
      surplus
      trigger
      blockNumber
      timestamp
    }
  }
`;

/**
 * Current coverage for every account class of a business — the latest indexed
 * `CoverageSnapshot` per class, with no block ceiling (FR-6.2). One query per
 * class in parallel, for the same reason `queryCoverageAtBlock` does: a
 * single un-classed `first: N` query can crowd one class's rows out with
 * another's (see that function's comment — a real bug caught live).
 */
export async function queryLatestCoverage(
  url: string,
  businessId: string
): Promise<CoverageSnapshotResult[]> {
  const perClass = await Promise.all(
    COVERAGE_CLASSES.map((cls) =>
      querySubgraph(
        url,
        LATEST_COVERAGE_QUERY,
        { businessId, class: cls },
        z.object({ coverageSnapshots: z.array(coverageSnapshotSchema) }).transform((d) => d.coverageSnapshots)
      )
    )
  );
  return perClass.flat();
}

const COVERAGE_HISTORY_QUERY = /* GraphQL */ `
  query CoverageHistory($businessId: Bytes!, $first: Int!) {
    coverageSnapshots(
      where: { business: $businessId }
      orderBy: blockNumber
      orderDirection: asc
      first: $first
    ) {
      class
      held
      owed
      ratioBps
      shortfall
      surplus
      trigger
      blockNumber
      timestamp
      txHash
    }
  }
`;

const coverageSnapshotWithTxSchema = coverageSnapshotSchema.extend({ txHash: z.string() });
export type CoverageSnapshotWithTx = z.infer<typeof coverageSnapshotWithTxSchema>;

/**
 * The full (or windowed) `CoverageSnapshot` history for a business, oldest
 * first — what draws FR-6.4's line. One immutable row per block where held or
 * owed moved for any class, so this is real indexed history, not a rollup.
 */
export async function queryCoverageHistory(
  url: string,
  businessId: string,
  first = 1000
): Promise<CoverageSnapshotWithTx[]> {
  return querySubgraph(
    url,
    COVERAGE_HISTORY_QUERY,
    { businessId, first },
    z.object({ coverageSnapshots: z.array(coverageSnapshotWithTxSchema) }).transform((d) => d.coverageSnapshots)
  );
}

const ACCOUNT_BY_ID_QUERY = /* GraphQL */ `
  query AccountById($id: ID!) {
    account(id: $id) {
      id
      class
      label
      held
      heldAtBlock
      owed
    }
  }
`;

const accountBalanceSchema = z.object({
  id: z.string(),
  class: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"]),
  label: z.string(),
  held: bigIntString,
  heldAtBlock: bigIntString,
  owed: bigIntString
});

export type AccountBalanceResult = z.infer<typeof accountBalanceSchema>;

/**
 * A single registered BOLT `Account` by address, or `null` when the address
 * isn't one — used for the beneficiary lookup (FR-6.7): a beneficiary wallet
 * is usually not a `BoltRegistry` account, so the caller falls back to a
 * direct on-chain balance read rather than treating this as an error.
 */
export async function queryAccountById(url: string, address: string): Promise<AccountBalanceResult | null> {
  const result = await querySubgraph(
    url,
    ACCOUNT_BY_ID_QUERY,
    { id: address.toLowerCase() },
    z.object({ account: accountBalanceSchema.nullable() }).transform((d) => d.account)
  );
  return result;
}

const accountSchema = z.object({
  id: z.string(),
  class: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"]),
  label: z.string(),
  policyHash: z.string(),
  held: bigIntString,
  heldAtBlock: bigIntString,
  owed: bigIntString,
  totalIn: bigIntString,
  totalOut: bigIntString,
  registeredAtBlock: bigIntString,
  registeredAtTimestamp: bigIntString,
  registeredTx: z.string()
});

export type AccountResult = z.infer<typeof accountSchema>;

const businessSchema = z.object({
  id: z.string(),
  slug: z.string(),
  admin: z.string(),
  registeredAtBlock: bigIntString,
  registeredAtTimestamp: bigIntString,
  registeredTx: z.string(),
  mandateVersion: bigIntString,
  depositCount: bigIntString,
  totalDeposited: bigIntString,
  accounts: z.array(accountSchema)
});

export type BusinessResult = z.infer<typeof businessSchema>;

const BUSINESS_BY_SLUG_QUERY = /* GraphQL */ `
  query BusinessBySlug($slug: String!) {
    businesses(where: { slug: $slug }, first: 1) {
      id
      slug
      admin
      registeredAtBlock
      registeredAtTimestamp
      registeredTx
      mandateVersion
      depositCount
      totalDeposited
      accounts(orderBy: registeredAtBlock, orderDirection: desc) {
        id
        class
        label
        policyHash
        held
        heldAtBlock
        owed
        totalIn
        totalOut
        registeredAtBlock
        registeredAtTimestamp
        registeredTx
      }
    }
  }
`;

/**
 * A business and every account ever registered under it, by public slug —
 * the entry point for `/[slug]` (FR-6.1). `null` when the slug isn't indexed.
 */
export async function queryBusinessBySlug(url: string, slug: string): Promise<BusinessResult | null> {
  const rows = await querySubgraph(
    url,
    BUSINESS_BY_SLUG_QUERY,
    { slug },
    z.object({ businesses: z.array(businessSchema) }).transform((d) => d.businesses)
  );
  return rows[0] ?? null;
}

const approvalSchema = z.object({
  approver: z.string(),
  humanProofRef: z.string(),
  blockNumber: bigIntString,
  timestamp: bigIntString,
  txHash: z.string()
});

const unlockSchema = z.object({
  id: z.string(),
  account: z.object({ id: z.string(), label: z.string(), class: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"]) }),
  amount: bigIntString,
  destination: z.string(),
  reasonHash: z.string(),
  status: z.enum(["REQUESTED", "EXECUTED", "CANCELLED"]),
  approvalCount: z.number(),
  requestedAtBlock: bigIntString,
  requestedAtTimestamp: bigIntString,
  requestedTx: z.string(),
  executedAtBlock: bigIntString.nullable(),
  executedAtTimestamp: bigIntString.nullable(),
  cancelReasonHash: z.string().nullable(),
  approvals: z.array(approvalSchema)
});

export type UnlockResult = z.infer<typeof unlockSchema>;

const UNLOCKS_QUERY = /* GraphQL */ `
  query UnlocksForBusiness($businessId: Bytes!) {
    unlocks(
      where: { business: $businessId }
      orderBy: requestedAtBlock
      orderDirection: desc
      first: 200
    ) {
      id
      account {
        id
        label
        class
      }
      amount
      destination
      reasonHash
      status
      approvalCount
      requestedAtBlock
      requestedAtTimestamp
      requestedTx
      executedAtBlock
      executedAtTimestamp
      cancelReasonHash
      approvals(orderBy: blockNumber, orderDirection: asc) {
        approver
        humanProofRef
        blockNumber
        timestamp
        txHash
      }
    }
  }
`;

/**
 * Every unlock ever requested for a business, newest first, with its
 * approvals (FR-6.5). Renders correctly but empty until Phase 6 ships —
 * do not fake rows to fill this in.
 */
export async function queryUnlocks(url: string, businessId: string): Promise<UnlockResult[]> {
  return querySubgraph(
    url,
    UNLOCKS_QUERY,
    { businessId },
    z.object({ unlocks: z.array(unlockSchema) }).transform((d) => d.unlocks)
  );
}

const depositSchema = z.object({
  id: z.string(),
  amount: bigIntString,
  mandateVersion: bigIntString,
  splitTotal: bigIntString,
  splits: z.array(
    z.object({
      amount: bigIntString,
      account: z.object({ id: z.string(), class: z.string() })
    })
  )
});

export type DepositResult = z.infer<typeof depositSchema>;

const depositWithSplitsSchema = z.object({
  id: z.string(),
  amount: bigIntString,
  mandateVersion: bigIntString,
  splitTotal: bigIntString,
  blockNumber: bigIntString,
  timestamp: bigIntString,
  txHash: z.string(),
  splits: z.array(
    z.object({
      amount: bigIntString,
      blockNumber: bigIntString,
      txHash: z.string(),
      account: z.object({
        id: z.string(),
        label: z.string(),
        class: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"])
      })
    })
  )
});

export type DepositWithSplitsResult = z.infer<typeof depositWithSplitsSchema>;

const DEPOSITS_QUERY = /* GraphQL */ `
  query DepositsForBusiness($businessId: Bytes!, $first: Int!) {
    deposits(
      where: { business: $businessId }
      orderBy: blockNumber
      orderDirection: asc
      first: $first
    ) {
      id
      amount
      mandateVersion
      splitTotal
      blockNumber
      timestamp
      txHash
      splits(orderBy: blockNumber, orderDirection: asc) {
        amount
        blockNumber
        txHash
        account {
          id
          label
          class
        }
      }
    }
  }
`;

/**
 * Every indexed deposit for a business with the splits it actually produced,
 * oldest first — the input to the Monitor's mandate-drift check (FR-7.3).
 *
 * Both halves of the comparison are on chain: `mandateVersion` comes from
 * `DepositObserved`, each split amount from a `SplitExecuted`. Nothing here is
 * the splitter's own account of what it did.
 */
export async function queryDeposits(
  url: string,
  businessId: string,
  first = 1000
): Promise<DepositWithSplitsResult[]> {
  return querySubgraph(
    url,
    DEPOSITS_QUERY,
    { businessId, first },
    z.object({ deposits: z.array(depositWithSplitsSchema) }).transform((d) => d.deposits)
  );
}

const mandateSchema = z.object({
  version: bigIntString,
  rulesHash: z.string(),
  quorumRef: z.string(),
  blockNumber: bigIntString,
  timestamp: bigIntString,
  txHash: z.string()
});

export type MandateResult = z.infer<typeof mandateSchema>;

const MANDATES_QUERY = /* GraphQL */ `
  query MandatesForBusiness($businessId: Bytes!) {
    mandates(
      where: { business: $businessId }
      orderBy: version
      orderDirection: asc
      first: 200
    ) {
      version
      rulesHash
      quorumRef
      blockNumber
      timestamp
      txHash
    }
  }
`;

/**
 * Every `MandatePublished` a business has on chain (FR-4.2). A mandate version
 * that deposits reference but that has no row here was never ratified by a key
 * quorum — which the Monitor treats as severe on its own, independently of
 * whether the ratios it produced look right.
 */
export async function queryMandates(url: string, businessId: string): Promise<MandateResult[]> {
  return querySubgraph(
    url,
    MANDATES_QUERY,
    { businessId },
    z.object({ mandates: z.array(mandateSchema) }).transform((d) => d.mandates)
  );
}

const META_QUERY = /* GraphQL */ `
  query IndexerHead {
    _meta {
      block {
        number
      }
      hasIndexingErrors
    }
  }
`;

/** The block the deployed subgraph has indexed up to. Every Monitor answer is as-of this block. */
export async function queryIndexerHead(
  url: string
): Promise<{ blockNumber: bigint; hasIndexingErrors: boolean }> {
  return querySubgraph(
    url,
    META_QUERY,
    {},
    z
      .object({
        _meta: z.object({
          block: z.object({ number: z.number() }),
          hasIndexingErrors: z.boolean()
        })
      })
      .transform((d) => ({
        blockNumber: BigInt(d._meta.block.number),
        hasIndexingErrors: d._meta.hasIndexingErrors
      }))
  );
}

const DEPOSIT_BY_TX_QUERY = /* GraphQL */ `
  query DepositByTx($txHash: Bytes!) {
    deposits(where: { txHash: $txHash }) {
      id
      amount
      mandateVersion
      splitTotal
      splits {
        amount
        account {
          id
          class
        }
      }
    }
  }
`;

/** A deposit and its splits, looked up by the transaction hash that observed it. */
export async function queryDepositByTx(url: string, txHash: string): Promise<DepositResult[]> {
  return querySubgraph(
    url,
    DEPOSIT_BY_TX_QUERY,
    { txHash },
    z.object({ deposits: z.array(depositSchema) }).transform((d) => d.deposits)
  );
}
