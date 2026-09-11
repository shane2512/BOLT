import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Hex,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./arc.js";
import type { AccountClass } from "./account-class.js";

/**
 * `BoltRegistry` fragments BOLT writes to. The contract custodies nothing and is
 * append-only — it records what happened, it does not decide what may happen
 * (invariant 1). Deployed at `REGISTRY_ADDRESS`; the deployer EOA is `recorder`.
 *
 * Only the members BOLT calls or reads are declared here. Keep in sync with
 * `contracts/src/BoltRegistry.sol` — the deployed contract is immutable, so this
 * list only ever grows.
 */
export const BOLT_REGISTRY_ABI = [
  {
    type: "function",
    name: "recordAccountRegistered",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "class", type: "uint8" },
      { name: "policyHash", type: "bytes32" },
      { name: "label", type: "string" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordPolicyRotated",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "oldPolicyHash", type: "bytes32" },
      { name: "newPolicyHash", type: "bytes32" },
      { name: "quorumRef", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordBusinessRegistered",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "slug", type: "string" },
      { name: "admin", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordMandatePublished",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "version", type: "uint256" },
      { name: "rulesHash", type: "bytes32" },
      { name: "quorumRef", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "MandatePublished",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "version", type: "uint256", indexed: false },
      { name: "rulesHash", type: "bytes32", indexed: false },
      { name: "quorumRef", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "function",
    name: "recordDepositObserved",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "depositId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "mandateVersion", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordSplitExecuted",
    stateMutability: "nonpayable",
    inputs: [
      { name: "depositId", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordObligationAccrued",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "obligationId", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "beneficiaryRef", type: "bytes32" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordObligationSettled",
    stateMutability: "nonpayable",
    inputs: [
      { name: "obligationId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "txRef", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "ObligationSettled",
    inputs: [
      { name: "obligationId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "txRef", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "function",
    name: "recordUnlockRequested",
    stateMutability: "nonpayable",
    inputs: [
      { name: "businessId", type: "bytes32" },
      { name: "unlockId", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destination", type: "address" },
      { name: "reasonHash", type: "bytes32" },
      { name: "executableAt", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordUnlockApproved",
    stateMutability: "nonpayable",
    inputs: [
      { name: "unlockId", type: "bytes32" },
      { name: "approver", type: "address" },
      { name: "humanProofRef", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "recordUnlockExecuted",
    stateMutability: "nonpayable",
    inputs: [
      { name: "unlockId", type: "bytes32" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "UnlockRequested",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "unlockId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "destination", type: "address", indexed: false },
      { name: "reasonHash", type: "bytes32", indexed: false },
      { name: "executableAt", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "UnlockApproved",
    inputs: [
      { name: "unlockId", type: "bytes32", indexed: true },
      { name: "approver", type: "address", indexed: false },
      { name: "humanProofRef", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "UnlockExecuted",
    inputs: [
      { name: "unlockId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "DepositObserved",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "depositId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "mandateVersion", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "SplitExecuted",
    inputs: [
      { name: "depositId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ObligationAccrued",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "obligationId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: false },
      { name: "beneficiaryRef", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "BusinessRegistered",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "slug", type: "string", indexed: false },
      { name: "admin", type: "address", indexed: false }
    ]
  },
  {
    type: "event",
    name: "AccountRegistered",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "class", type: "uint8", indexed: false },
      { name: "policyHash", type: "bytes32", indexed: false },
      { name: "label", type: "string", indexed: false }
    ]
  },
  {
    type: "event",
    name: "PolicyRotated",
    inputs: [
      { name: "businessId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "oldPolicyHash", type: "bytes32", indexed: false },
      { name: "newPolicyHash", type: "bytes32", indexed: false },
      { name: "quorumRef", type: "bytes32", indexed: false }
    ]
  }
] as const;

/** Matches `BoltRegistry.AccountClass`. Order is part of the deployed contract. */
export const ACCOUNT_CLASS_ORDINAL: Record<AccountClass, number> = {
  OPERATING: 0,
  CLIENT_MONEY: 1,
  OBLIGATION_RESERVE: 2
};

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;

/** bytes32 identifiers for off-chain values the events reference. */
export const bytes32Of = (value: string): Hex => keccak256(toHex(value));
export const businessIdOf = (slug: string): Hex => bytes32Of(slug);
export const quorumRefOf = (keyQuorumId: string): Hex => bytes32Of(keyQuorumId);

/**
 * A deposit's on-chain id is derived from the thing that makes it unique on
 * chain — `(txHash, logIndex)` — so `DepositObserved` carries the same identity
 * the idempotency key uses (FR-3.2). Two deliveries of one deposit produce the
 * same `depositId`, which is what makes a double-emit visible in the index
 * rather than silently doubling the amount.
 */
export const depositIdOf = (txHash: string, logIndex: number): Hex =>
  bytes32Of(`${txHash.toLowerCase()}:${logIndex}`);

/** One obligation per (deposit, receiving account). Same reasoning as above. */
export const obligationIdOf = (depositId: Hex, accountAddress: string): Hex =>
  bytes32Of(`${depositId}:${accountAddress.toLowerCase()}`);

/**
 * An unlock's on-chain id, derived from the Postgres row id so the workflow row
 * and the chain record name the same thing without a second registry of ids.
 */
export const unlockIdOf = (unlockRequestId: string): Hex => bytes32Of(unlockRequestId);

/**
 * FR-5.1 — the free-text reason never goes on chain, only `keccak256(utf8(reason))`.
 * A reader who is shown the text on the public page can recompute this and check
 * it against `UnlockRequested.reasonHash` themselves (invariant 8).
 */
export const reasonHashOf = (reason: string): Hex => bytes32Of(reason);

/**
 * FR-5.3 — the World Selfie Check proof reference recorded with an approval.
 *
 * A World nullifier is already a 256-bit field element rendered as a 0x-prefixed
 * hex string (world-docs /world-id/idkit/integrate.mdx step 6), so it goes on
 * chain **as itself**, left-padded to bytes32 — not hashed. Hashing it would
 * make the on-chain value uncheckable against the proof World actually issued.
 */
export const humanProofRefOf = (nullifier: string): Hex => {
  const hex = nullifier.startsWith("0x") ? nullifier.slice(2) : nullifier;
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    throw new Error(`humanProofRefOf: not a 256-bit hex nullifier: ${nullifier}`);
  }
  return `0x${hex.toLowerCase().padStart(64, "0")}` as Hex;
};

/**
 * The hash the public page and the subgraph use to tie an on-chain
 * `AccountRegistered` to the Privy policy that was actually attached. Keys are
 * sorted so the hash depends on the policy's content, not on the order our
 * builder happened to construct the object in.
 */
export function policyHashOf(policy: unknown): Hex {
  return keccak256(toHex(canonicalJson(policy)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface RegistryWriterOptions {
  registryAddress: Hex;
  /** The `recorder` EOA's key. BoltRegistry is not a locked account — no Privy signing here. */
  recorderPrivateKey: Hex;
  rpcUrl?: string;
}

export interface RegistryWriter {
  readonly address: Hex;
  /** Pending nonce for an address, for the sign-and-self-broadcast path. */
  getTransactionCount(address: Hex): Promise<number>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  recordAccountRegistered(args: {
    businessId: Hex;
    account: Hex;
    accountClass: AccountClass;
    policyHash: Hex;
    label: string;
  }): Promise<TransactionReceipt>;
  recordPolicyRotated(args: {
    businessId: Hex;
    account: Hex;
    oldPolicyHash: Hex;
    newPolicyHash: Hex;
    quorumRef: Hex;
  }): Promise<TransactionReceipt>;
  recordBusinessRegistered(args: {
    businessId: Hex;
    slug: string;
    admin: Hex;
  }): Promise<TransactionReceipt>;
  /**
   * FR-4.2 — a published mandate's on-chain record. `quorumRef` is the key
   * quorum that authorised publication; the ratios themselves stay off chain
   * and are committed to by `rulesHash`.
   */
  recordMandatePublished(args: {
    businessId: Hex;
    version: number;
    rulesHash: Hex;
    quorumRef: Hex;
  }): Promise<TransactionReceipt>;
  recordDepositObserved(args: {
    businessId: Hex;
    depositId: Hex;
    amount: bigint;
    mandateVersion: number;
  }): Promise<TransactionReceipt>;
  recordSplitExecuted(args: {
    depositId: Hex;
    account: Hex;
    amount: bigint;
  }): Promise<TransactionReceipt>;
  recordObligationAccrued(args: {
    businessId: Hex;
    obligationId: Hex;
    account: Hex;
    beneficiaryRef: Hex;
    amount: bigint;
  }): Promise<TransactionReceipt>;
  /**
   * FR-8.5 — a beneficiary payout. `txRef` is the Arc transaction hash of the
   * USDC transfer the enclave signed, so the settlement record and the movement
   * of money name each other and a reader can check both on the explorer.
   */
  recordObligationSettled(args: {
    obligationId: Hex;
    amount: bigint;
    txRef: Hex;
  }): Promise<TransactionReceipt>;
  /** FR-5.1 / FR-5.5 — the unlock ceremony's three records. */
  recordUnlockRequested(args: {
    businessId: Hex;
    unlockId: Hex;
    account: Hex;
    amount: bigint;
    destination: Hex;
    reasonHash: Hex;
    executableAt: bigint;
  }): Promise<TransactionReceipt>;
  recordUnlockApproved(args: {
    unlockId: Hex;
    approver: Hex;
    humanProofRef: Hex;
  }): Promise<TransactionReceipt>;
  recordUnlockExecuted(args: { unlockId: Hex; amount: bigint }): Promise<TransactionReceipt>;
}

/**
 * Writes to `BoltRegistry` with the recorder EOA and waits for the receipt.
 * Callers that need proof (Phase exit criteria) should re-read the receipt
 * straight from the RPC rather than trusting this return value alone.
 */
export function createRegistryWriter(opts: RegistryWriterOptions): RegistryWriter {
  const transport = http(opts.rpcUrl ?? arcTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  const wallet = createWalletClient({
    chain: arcTestnet,
    transport,
    account: privateKeyToAccount(opts.recorderPrivateKey)
  });

  return {
    address: opts.registryAddress,
    getTransactionCount: (address) =>
      publicClient.getTransactionCount({ address, blockTag: "pending" }),
    estimateFeesPerGas: async () => {
      const fees = await publicClient.estimateFeesPerGas();
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n
      };
    },
    async recordAccountRegistered(args: {
      businessId: Hex;
      account: Hex;
      accountClass: AccountClass;
      policyHash: Hex;
      label: string;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordAccountRegistered",
        args: [
          args.businessId,
          args.account,
          ACCOUNT_CLASS_ORDINAL[args.accountClass],
          args.policyHash,
          args.label
        ]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordPolicyRotated(args: {
      businessId: Hex;
      account: Hex;
      oldPolicyHash: Hex;
      newPolicyHash: Hex;
      quorumRef: Hex;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordPolicyRotated",
        args: [
          args.businessId,
          args.account,
          args.oldPolicyHash,
          args.newPolicyHash,
          args.quorumRef
        ]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordBusinessRegistered(args: { businessId: Hex; slug: string; admin: Hex }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordBusinessRegistered",
        args: [args.businessId, args.slug, args.admin]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordMandatePublished(args: {
      businessId: Hex;
      version: number;
      rulesHash: Hex;
      quorumRef: Hex;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordMandatePublished",
        args: [args.businessId, BigInt(args.version), args.rulesHash, args.quorumRef]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordDepositObserved(args: {
      businessId: Hex;
      depositId: Hex;
      amount: bigint;
      mandateVersion: number;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordDepositObserved",
        args: [args.businessId, args.depositId, args.amount, BigInt(args.mandateVersion)]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordSplitExecuted(args: { depositId: Hex; account: Hex; amount: bigint }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordSplitExecuted",
        args: [args.depositId, args.account, args.amount]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordObligationAccrued(args: {
      businessId: Hex;
      obligationId: Hex;
      account: Hex;
      beneficiaryRef: Hex;
      amount: bigint;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordObligationAccrued",
        args: [
          args.businessId,
          args.obligationId,
          args.account,
          args.beneficiaryRef,
          args.amount
        ]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordObligationSettled(args: { obligationId: Hex; amount: bigint; txRef: Hex }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordObligationSettled",
        args: [args.obligationId, args.amount, args.txRef]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordUnlockRequested(args: {
      businessId: Hex;
      unlockId: Hex;
      account: Hex;
      amount: bigint;
      destination: Hex;
      reasonHash: Hex;
      executableAt: bigint;
    }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordUnlockRequested",
        args: [
          args.businessId,
          args.unlockId,
          args.account,
          args.amount,
          args.destination,
          args.reasonHash,
          args.executableAt
        ]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordUnlockApproved(args: { unlockId: Hex; approver: Hex; humanProofRef: Hex }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordUnlockApproved",
        args: [args.unlockId, args.approver, args.humanProofRef]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    async recordUnlockExecuted(args: { unlockId: Hex; amount: bigint }) {
      const hash = await wallet.writeContract({
        address: opts.registryAddress,
        abi: BOLT_REGISTRY_ABI,
        functionName: "recordUnlockExecuted",
        args: [args.unlockId, args.amount]
      });
      return publicClient.waitForTransactionReceipt({ hash });
    }
  };
}

// ---------------------------------------------------------------------------
// BoltUnlockTimer — FR-5.4
// ---------------------------------------------------------------------------

/**
 * `BoltUnlockTimer`, deployed separately from `BoltRegistry` so the registry's
 * address (and with it every block of coverage history the subgraph has indexed)
 * survives Phase 6. See contracts/src/BoltUnlockTimer.sol for why.
 */
export const BOLT_UNLOCK_TIMER_ABI = [
  {
    type: "function",
    name: "UNLOCK_DELAY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "arm",
    stateMutability: "nonpayable",
    inputs: [{ name: "unlockId", type: "bytes32" }],
    outputs: [{ name: "executableAt", type: "uint64" }]
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "unlockId", type: "bytes32" }],
    outputs: []
  },
  {
    type: "function",
    name: "timers",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "armedAt", type: "uint64" },
      { name: "executableAt", type: "uint64" },
      { name: "released", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "secondsRemaining",
    stateMutability: "view",
    inputs: [{ name: "unlockId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "event",
    name: "UnlockArmed",
    inputs: [
      { name: "unlockId", type: "bytes32", indexed: true },
      { name: "armedAt", type: "uint64", indexed: false },
      { name: "executableAt", type: "uint64", indexed: false }
    ]
  },
  {
    type: "event",
    name: "UnlockReleased",
    inputs: [
      { name: "unlockId", type: "bytes32", indexed: true },
      { name: "releasedAt", type: "uint64", indexed: false }
    ]
  }
] as const;

export interface UnlockTimerState {
  armedAt: bigint;
  executableAt: bigint;
  released: boolean;
}

export interface UnlockTimer {
  readonly address: Hex;
  /** Seconds of delay, read off the deployed bytecode — never a local constant. */
  delaySeconds(): Promise<bigint>;
  state(unlockId: Hex): Promise<UnlockTimerState>;
  secondsRemaining(unlockId: Hex): Promise<bigint>;
  /** Start the clock. Called when the final quorum approval is recorded. */
  arm(unlockId: Hex): Promise<TransactionReceipt>;
  /**
   * The gate. Reverts on chain until the window has elapsed — the unlock flow
   * lands this transaction *before* asking Privy to sign anything, so an early
   * execution attempt fails against the deployed constant rather than against a
   * check in our code.
   */
  release(unlockId: Hex): Promise<TransactionReceipt>;
}

export function createUnlockTimer(opts: {
  timerAddress: Hex;
  recorderPrivateKey: Hex;
  rpcUrl?: string;
}): UnlockTimer {
  const transport = http(opts.rpcUrl ?? arcTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  const wallet = createWalletClient({
    chain: arcTestnet,
    transport,
    account: privateKeyToAccount(opts.recorderPrivateKey)
  });

  const write = async (functionName: "arm" | "release", unlockId: Hex) => {
    const hash = await wallet.writeContract({
      address: opts.timerAddress,
      abi: BOLT_UNLOCK_TIMER_ABI,
      functionName,
      args: [unlockId]
    });
    return publicClient.waitForTransactionReceipt({ hash });
  };

  return {
    address: opts.timerAddress,
    delaySeconds: () =>
      publicClient.readContract({
        address: opts.timerAddress,
        abi: BOLT_UNLOCK_TIMER_ABI,
        functionName: "UNLOCK_DELAY"
      }),
    async state(unlockId) {
      const [armedAt, executableAt, released] = await publicClient.readContract({
        address: opts.timerAddress,
        abi: BOLT_UNLOCK_TIMER_ABI,
        functionName: "timers",
        args: [unlockId]
      });
      return { armedAt: BigInt(armedAt), executableAt: BigInt(executableAt), released };
    },
    secondsRemaining: (unlockId) =>
      publicClient.readContract({
        address: opts.timerAddress,
        abi: BOLT_UNLOCK_TIMER_ABI,
        functionName: "secondsRemaining",
        args: [unlockId]
      }),
    arm: (unlockId) => write("arm", unlockId),
    release: (unlockId) => write("release", unlockId)
  };
}
