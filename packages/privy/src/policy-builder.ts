/**
 * The lock. Generates the Privy policy for a locked BOLT account.
 *
 * Enforcement lives here only in the sense that this file *describes* the
 * constraint — the constraint itself is evaluated inside Privy's secure enclave
 * before the signing key is reassembled. Nothing in this package may ever check
 * a destination itself (CLAUDE.md invariant 1).
 *
 * Grammar worked from:
 *   privy-docs /controls/policies/overview.mdx        — field sources, ANDed conditions, default-deny
 *   privy-docs /controls/policies/example-policies/ethereum.mdx — ethereum_calldata + inline abi
 *   privy-docs /controls/policies/create-a-policy.mdx — owner_id at creation
 *   @privy-io/node@0.34.0 resources/policies.d.ts     — PolicyCreateParams / PolicyCondition / AbiSchema
 * and verified live against Arc testnet in Phase 0 (docs/evidence/phase0-summary.json).
 */
import { getAddress, isAddress } from "viem";
import type { AccountClass } from "@bolt/core";
import type {
  AbiSchema,
  PolicyCondition,
  PolicyCreateParams,
  PolicyMethod
} from "@privy-io/node/resources";

/**
 * The ABI the policy pins. `transfer`'s recipient input is named `_to`, so the
 * decoded field path is `transfer._to` exactly as invariant 2 requires.
 *
 * NEVER swap this for a stock ABI (viem's `erc20Abi` names the same input
 * `recipient`), and never let a caller supply one: the field path is derived
 * from whatever ABI the condition carries, so a different ABI silently changes
 * which parameter the enclave checks. Phase 0 doc research, Finding 1.
 */
export const BOLT_ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_from", type: "address" },
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "_owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const satisfies AbiSchema;

/**
 * The only decoded-calldata fields that count as constraining the payee.
 * Segment 1 is the ABI's function `name` — `transferFrom`, never `transfer_from`
 * (Phase 0 doc research corrected CLAUDE.md on this).
 */
export const DECODED_RECIPIENT_FIELDS = ["transfer._to", "transferFrom._to"] as const;

export interface TransferPolicySpec {
  /** Policy display name. */
  name: string;
  /**
   * Permitted payees. An empty set is legal and means "nothing may leave" —
   * default-deny with no ALLOW rule.
   */
  permittedAddresses: readonly string[];
  /** USDC ERC-20 contract. On Arc this is also the native gas token. */
  usdcAddress: string;
  chainId: number;
  /** Key quorum that owns the policy. Required — see invariant 3. */
  ownerKeyQuorumId: string;
}

export interface LockedAccountSpec extends TransferPolicySpec {
  /**
   * OBLIGATION_RESERVE takes exactly one permitted address (FR-2.3);
   * CLIENT_MONEY takes the set of verified beneficiary addresses.
   */
  accountClass: AccountClass;
}

/**
 * Phase 0 proved Privy will not broadcast on Arc (401, "App is not authorized to
 * transact on chain eip155:5042002"), so `eth_signTransaction` + viem
 * self-broadcast is the live path. `eth_sendTransaction` carries the identical
 * rule so nothing widens if Privy authorizes Arc later. Every other method —
 * personal_sign, wallet_sendCalls, exportPrivateKey — stays denied by default.
 */
const LOCKED_METHODS = [
  "eth_signTransaction",
  "eth_sendTransaction"
] as const satisfies readonly PolicyMethod[];

/**
 * Privy string comparisons are case-sensitive and we do not control the casing
 * the enclave sees. Listing both spellings of the same address is not a
 * widening — it is the same address twice — and it makes a casing mismatch fail
 * closed rather than silently never matching. Phase 0 doc research, Finding 2.
 */
function bothCasings(address: string): [string, string] {
  if (!isAddress(address, { strict: false })) {
    throw new Error(`policy-builder: "${address}" is not an EVM address`);
  }
  return [address.toLowerCase(), getAddress(address)];
}

function allowConditions(
  spec: TransferPolicySpec,
  payees: readonly string[]
): PolicyCondition[] {
  return [
    // The token contract — NOT the payee. Also excludes a bare native-value send,
    // which on Arc moves real USDC without ever touching this address.
    {
      field_source: "ethereum_transaction",
      field: "to",
      operator: "in",
      value: bothCasings(spec.usdcAddress)
    },
    {
      field_source: "ethereum_transaction",
      field: "chain_id",
      operator: "in",
      value: [String(spec.chainId), `0x${spec.chainId.toString(16)}`]
    },
    // Required, not optional: on Arc a transfer() call could otherwise carry
    // native value alongside it, moving the same underlying balance.
    {
      field_source: "ethereum_transaction",
      field: "value",
      operator: "eq",
      value: "0"
    },
    {
      field_source: "ethereum_calldata",
      field: "function_name",
      abi: BOLT_ERC20_ABI,
      operator: "eq",
      value: "transfer"
    },
    // The whole product. The decoded recipient, not transaction.to.
    {
      field_source: "ethereum_calldata",
      field: "transfer._to",
      abi: BOLT_ERC20_ABI,
      operator: "in",
      value: payees.flatMap(bothCasings)
    }
  ];
}

/**
 * One ALLOW rule permitting `payees` on one method.
 *
 * Exported because Phase 8 widens a live `CLIENT_MONEY` policy in place — adding
 * a newly verified beneficiary as a permitted destination (FR-2.6 / FR-8.3) —
 * and a widening rule assembled by hand at the call site is exactly how a
 * `transfer._to` condition goes missing. Everything that reaches Privy as an
 * ALLOW rule is built here and checked by `assertConstrainsDecodedRecipient`.
 */
export function buildPayeeAllowRule(
  spec: TransferPolicySpec,
  payees: readonly string[],
  method: PolicyMethod,
  /** Privy caps rule names at 50 characters. */
  name = `USDC transfer to payee (${method})`
): PolicyCreateParams.Rule {
  if (payees.length === 0) {
    throw new Error("policy-builder: an ALLOW rule with no payee permits nothing — omit it");
  }
  const rule: PolicyCreateParams.Rule = {
    name: name.slice(0, 50),
    method,
    action: "ALLOW",
    conditions: allowConditions(spec, payees)
  };
  // The guard runs on every ALLOW rule that leaves this file, not only on whole
  // policies — a rule added to a live policy never passes through a policy body.
  assertConstrainsDecodedRecipient({
    version: "1.0",
    name: spec.name,
    chain_type: "ethereum",
    owner_id: spec.ownerKeyQuorumId,
    rules: [rule]
  });
  return rule;
}

/**
 * FR-2.8 (SHOULD). Default-deny already closes the allowance route — Phase 0
 * proved it empirically — but an explicit DENY cannot be widened by a later
 * permissive rule and makes the intent legible to anyone reading the policy.
 */
function denyRule(
  method: PolicyMethod,
  fn: "approve" | "transferFrom"
): PolicyCreateParams.Rule {
  return {
    name: `Deny ${fn} (${method})`,
    method,
    action: "DENY",
    conditions: [
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi: BOLT_ERC20_ABI,
        operator: "eq",
        value: fn
      }
    ]
  };
}

/**
 * FR-2.1 — the guard. Throws unless every ALLOW rule constrains the *decoded*
 * recipient, plus the rest of invariant 2's condition set.
 *
 * Only ALLOW rules are checked: a DENY rule narrows further and cannot let money
 * out, so requiring a `transfer._to` on it would be meaningless.
 *
 * There is a never-delete test for this. Do not weaken it and do not add an
 * escape hatch — a policy that reaches Privy without these conditions is a
 * policy that permits paying anyone on earth.
 */
export function assertConstrainsDecodedRecipient(policy: PolicyCreateParams): void {
  for (const rule of policy.rules) {
    if (rule.action !== "ALLOW") continue;

    const has = (source: PolicyCondition["field_source"], field: string): boolean =>
      rule.conditions.some((c) => c.field_source === source && c.field === field);

    const recipientField = DECODED_RECIPIENT_FIELDS.find((f) => has("ethereum_calldata", f));
    if (recipientField === undefined) {
      throw new Error(
        `FR-2.1 violated: ALLOW rule "${rule.name}" has no decoded-calldata recipient ` +
          `condition (one of ${DECODED_RECIPIENT_FIELDS.join(", ")}). Constraining ` +
          `ethereum_transaction.to alone permits paying anyone on earth, because on a ` +
          `USDC transfer that field is the token contract, not the payee.`
      );
    }

    const missing = (
      [
        ["ethereum_transaction", "to"],
        ["ethereum_transaction", "value"],
        ["ethereum_calldata", "function_name"]
      ] as const
    )
      .filter(([source, field]) => !has(source, field))
      .map(([source, field]) => `${source}.${field}`);
    if (missing.length > 0) {
      throw new Error(
        `FR-2.1 violated: ALLOW rule "${rule.name}" constrains ${recipientField} but is ` +
          `missing ${missing.join(", ")}.`
      );
    }

    const fnName = recipientField.split(".")[0];
    const fnCondition = rule.conditions.find(
      (c) => c.field_source === "ethereum_calldata" && c.field === "function_name"
    );
    if (fnCondition?.value !== fnName) {
      throw new Error(
        `FR-2.1 violated: ALLOW rule "${rule.name}" constrains ${recipientField} but pins ` +
          `function_name to ${JSON.stringify(fnCondition?.value)} — the decoded recipient ` +
          `belongs to a function the rule does not require.`
      );
    }
  }
}

/**
 * Builds the policy for a locked account. `OPERATING` accounts get no policy at
 * all — they hold the business's own money and are deliberately spendable.
 *
 * The returned object goes straight to `privy.policies().create()`, and the
 * resulting policy id to `privy.wallets().create({policy_ids})`, so the account
 * is never unlocked even briefly (FR-1.3).
 *
 * There is no trailing `DENY *`: Privy default-denies, and an explicit wildcard
 * DENY takes precedence over ALLOW and would refuse the permitted transfer too.
 */
export function buildLockedAccountPolicy(spec: LockedAccountSpec): PolicyCreateParams {
  if (spec.accountClass === "OPERATING") {
    throw new Error(
      "policy-builder: OPERATING accounts carry no policy — they are the business's " +
        "own money and are deliberately spendable. Do not lock them."
    );
  }
  if (spec.accountClass === "OBLIGATION_RESERVE" && spec.permittedAddresses.length > 1) {
    throw new Error(
      `FR-2.3 violated: OBLIGATION_RESERVE permits exactly one destination, got ` +
        `${spec.permittedAddresses.length}.`
    );
  }
  return buildTransferPolicy(spec);
}

/**
 * The condition set every BOLT policy shares: USDC on Arc, zero native value,
 * `function_name == transfer`, and a decoded `transfer._to` inside a fixed
 * allowlist. `buildLockedAccountPolicy` wraps it with the account-class rules;
 * `buildSplitterSignerPolicy` (splitter-policy.ts) wraps it with a different
 * allowlist for a different actor. Both go through
 * `assertConstrainsDecodedRecipient` before they leave this file.
 *
 * Exported so a second caller cannot end up hand-rolling a near-copy of the
 * conditions and drifting from invariant 2. Prefer one of the two wrappers.
 */
export function buildTransferPolicy(spec: TransferPolicySpec): PolicyCreateParams {
  if (!spec.ownerKeyQuorumId) {
    throw new Error(
      "policy-builder: ownerKeyQuorumId is required. Without an owner a policy can be " +
        "updated by the app secret alone, which is the admin override invariant 3 forbids."
    );
  }

  const payees = [...new Set(spec.permittedAddresses.map((a) => a.toLowerCase()))];

  const rules: PolicyCreateParams.Rule[] = [];
  for (const method of LOCKED_METHODS) {
    // No payees yet (a CLIENT_MONEY account with no verified beneficiary) means
    // no ALLOW rule at all: the account is maximally locked, not accidentally open.
    if (payees.length > 0) {
      rules.push(buildPayeeAllowRule(spec, payees, method));
    }
    rules.push(denyRule(method, "approve"));
    rules.push(denyRule(method, "transferFrom"));
  }

  const policy: PolicyCreateParams = {
    version: "1.0",
    name: spec.name,
    chain_type: "ethereum",
    owner_id: spec.ownerKeyQuorumId,
    rules
  };

  assertConstrainsDecodedRecipient(policy);
  return policy;
}

/**
 * FR-1.6 / invariant 4. CLIENT_MONEY never earns, whatever the caller asks for.
 * This is the only place yield is decided; there is no setter that can override it.
 */
export function yieldEnabledFor(accountClass: AccountClass, requested = false): boolean {
  return accountClass === "OBLIGATION_RESERVE" ? requested : false;
}
