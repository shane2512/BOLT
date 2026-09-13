/**
 * The shapes the API routes actually put on the wire.
 *
 * `jsonSafe` in `lib/operator-session.ts` turns every `bigint` into a decimal
 * string, so these mirror `@bolt/core`'s result types with `string` where the
 * server had `bigint`. Declared here rather than imported so the client bundle
 * never pulls the subgraph client in behind them.
 */

export type AccountClass = "OPERATING" | "CLIENT_MONEY" | "OBLIGATION_RESERVE";

export interface ChainAccount {
  id: string;
  class: AccountClass;
  label: string;
  policyHash: string;
  held: string;
  heldAtBlock: string;
  owed: string;
  totalIn: string;
  totalOut: string;
  registeredAtBlock: string;
  registeredAtTimestamp: string;
  registeredTx: string;
}

export interface ChainBusiness {
  id: string;
  slug: string;
  admin: string;
  registeredAtBlock: string;
  registeredAtTimestamp: string;
  registeredTx: string;
  mandateVersion: string;
  depositCount: string;
  totalDeposited: string;
  accounts: ChainAccount[];
}

export interface CoverageSnap {
  class: AccountClass;
  held: string;
  owed: string;
  ratioBps: string;
  shortfall: boolean;
  surplus: string;
  trigger: string;
  blockNumber: string;
  timestamp: string;
  txHash?: string;
}

export interface UnlockApproval {
  approver: string;
  humanProofRef: string | null;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

export interface Unlock {
  id: string;
  account: { id: string; label: string; class: AccountClass };
  amount: string;
  destination: string;
  reasonHash: string;
  status: "REQUESTED" | "EXECUTED" | "CANCELLED";
  approvalCount: number;
  requestedAtBlock: string;
  requestedAtTimestamp: string;
  requestedTx: string;
  executedAtBlock: string | null;
  executedAtTimestamp: string | null;
  cancelReasonHash: string | null;
  approvals: UnlockApproval[];
}

export interface DepositSplit {
  amount: string;
  blockNumber: string;
  txHash: string;
  account: { id: string; label: string; class: AccountClass };
}

export interface Deposit {
  id: string;
  amount: string;
  mandateVersion: string;
  splitTotal: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  splits: DepositSplit[];
}

export interface Mandate {
  version: string;
  rulesHash: string;
  quorumRef: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

export interface PolicyRotation {
  id: string;
  account: { id: string; label: string; class: AccountClass };
  oldPolicyHash: string;
  newPolicyHash: string;
  quorumRef: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

export interface Finding {
  kind:
    | "MANDATE_DRIFT"
    | "UNRATIFIED_MANDATE"
    | "UNALLOCATED_DEPOSIT"
    | "SHORTFALL_FORECAST"
    | "SHORTFALL_HISTORY"
    | "UNLOCK_ANOMALY";
  severity: "INFO" | "WARNING" | "SEVERE";
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  fingerprint: string;
}

/** `GET /api/operator/business` and the public page's own read. */
export interface ChainPayload {
  found: boolean;
  slug?: string;
  business?: ChainBusiness;
  indexedAtBlock?: string;
  latestCoverage?: CoverageSnap[];
  coverageHistory?: CoverageSnap[];
  unlocks?: Unlock[];
  deposits?: Deposit[];
  mandates?: Mandate[];
  policyRotations?: PolicyRotation[];
  findings?: Finding[];
  error?: string;
}

/** `GET /api/operator/workflow` — Postgres config and workflow state only. */
export interface WorkflowPayload {
  reachable: boolean;
  known?: boolean;
  slug?: string;
  detail?: string;
  error?: string;
  business?: { id: string; slug: string; name: string };
  accounts?: {
    id: string;
    businessId: string;
    class: AccountClass;
    label: string;
    address: string;
    policyId: string | null;
    policyHash: string | null;
    yieldEnabled?: boolean;
  }[];
  unlocks?: WorkflowUnlock[];
  mandates?: {
    id: string;
    version: number;
    rulesHash: string;
    quorumRef: string | null;
    publishedAt: string | null;
    rules: {
      id: string;
      mandateId: string;
      description: string;
      destinationAccountId: string;
      bps: number;
    }[];
  }[];
  obligations?: {
    id: string;
    accountId: string;
    beneficiaryId: string | null;
    amount: string;
    status: string;
    txRef: string | null;
  }[];
  beneficiaries?: {
    id: string;
    email: string;
    walletAddress: string | null;
    verifiedAddress: string | null;
    createdAt: string;
  }[];
  alerts?: {
    id: string;
    kind: string;
    severity: "INFO" | "WARNING" | "SEVERE";
    message: string;
    evidence: unknown;
    createdAt: string;
    resolvedAt: string | null;
  }[];
  refusals?: {
    id: string;
    accountId: string | null;
    rawError: unknown;
    attemptedAction: unknown;
    occurredAt: string;
  }[];
}

export interface WorkflowUnlock {
  id: string;
  businessId: string;
  accountId: string;
  amount: string;
  destination: string;
  reason: string;
  reasonHash: string;
  status: string;
  executableAt: string | null;
  intentId: string | null;
  keyQuorumId: string | null;
  createdAt: string;
  approvals: {
    id: string;
    unlockRequestId: string;
    approver: string;
    humanProofRef: string;
    nullifier: string | null;
    quorumSignature: string | null;
    approvedAt: string;
  }[];
}

/**
 * Arc testnet's public constants, mirrored from `@bolt/core`'s `arc.ts` rather
 * than imported: importing the package index would pull the subgraph client and
 * zod into the browser bundle for two literals. If arc.ts changes, change these.
 */
export const ARC = {
  name: "Arc Testnet",
  chainId: 5042002,
  usdc: "0x3600000000000000000000000000000000000000",
  explorer: "https://testnet.arcscan.app"
} as const;

export const CLASS_LABEL: Record<AccountClass, string> = {
  CLIENT_MONEY: "Client money",
  OBLIGATION_RESERVE: "Obligation reserve",
  OPERATING: "Operating"
};

export const isLocked = (c: AccountClass): boolean => c !== "OPERATING";

/** What each class's lock permits, in plain words. Never a policy dump. */
export const LOCK_WORDS: Record<AccountClass, string> = {
  CLIENT_MONEY: "can only pay verified sellers",
  OBLIGATION_RESERVE: "can only pay the revenue authority",
  OPERATING: ""
};

/** Yield is decided by the class, not by a setting (invariant 4). */
export const YIELD_WORDS: Record<AccountClass, string> = {
  CLIENT_MONEY: "earns nothing",
  OBLIGATION_RESERVE: "earns while idle",
  OPERATING: "earns nothing"
};

/** Where a reader goes to check any of this without trusting us. */
export const addressUrl = (a: string): string => `${ARC.explorer}/address/${a}`;
export const txUrl = (h: string): string => `${ARC.explorer}/tx/${h}`;
export const blockUrl = (b: string | number): string => `${ARC.explorer}/block/${b}`;
