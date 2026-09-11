/**
 * FR-2.1 / invariant 2. THIS FILE MUST NEVER BE DELETED OR WEAKENED.
 *
 * If the policy builder can emit an ALLOW rule that does not constrain the
 * decoded calldata recipient, BOLT's central claim is false: a USDC transfer's
 * `transaction.to` is the token contract, so a policy that only pins it permits
 * paying anyone on earth.
 */
import { describe, expect, it } from "vitest";
import type { PolicyCreateParams } from "@privy-io/node/resources";
import {
  BOLT_ERC20_ABI,
  DECODED_RECIPIENT_FIELDS,
  assertConstrainsDecodedRecipient,
  buildLockedAccountPolicy,
  yieldEnabledFor
} from "./policy-builder.js";

const USDC = "0x3600000000000000000000000000000000000000";
const CHAIN_ID = 5042002;
const QUORUM = "zygjbl2k4dbghdfqanf2ymo6";
const PAYEE = "0x634186595D6E038094A8b0E25b38AA2f498D5407";
const OTHER = "0xcFeae9DfAdaEB08dacce9A9c959a75f5FbeBf683";

const base = {
  name: "test policy",
  usdcAddress: USDC,
  chainId: CHAIN_ID,
  ownerKeyQuorumId: QUORUM
} as const;

// ---------------------------------------------------------------- THE guard

describe("FR-2.1 — the builder refuses to emit a rule without a decoded recipient", () => {
  it("throws on an ALLOW rule that constrains only ethereum_transaction.to", () => {
    const permissive: PolicyCreateParams = {
      version: "1.0",
      name: "pays anyone on earth",
      chain_type: "ethereum",
      owner_id: QUORUM,
      rules: [
        {
          name: "USDC only",
          method: "eth_signTransaction",
          action: "ALLOW",
          conditions: [
            { field_source: "ethereum_transaction", field: "to", operator: "eq", value: USDC }
          ]
        }
      ]
    };
    expect(() => assertConstrainsDecodedRecipient(permissive)).toThrow(/FR-2\.1 violated/);
  });

  it("throws when the recipient condition names the wrong ABI field path", () => {
    // viem's erc20Abi names this input `recipient`, giving `transfer.recipient`.
    // That decodes fine and reads like the real thing — and constrains nothing
    // the guard recognises.
    const wrongPath: PolicyCreateParams = {
      version: "1.0",
      name: "stock abi",
      chain_type: "ethereum",
      owner_id: QUORUM,
      rules: [
        {
          name: "looks right, is not",
          method: "eth_signTransaction",
          action: "ALLOW",
          conditions: [
            { field_source: "ethereum_transaction", field: "to", operator: "eq", value: USDC },
            { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
            {
              field_source: "ethereum_calldata",
              field: "function_name",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: "transfer"
            },
            {
              field_source: "ethereum_calldata",
              field: "transfer.recipient",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: PAYEE
            }
          ]
        }
      ]
    };
    expect(() => assertConstrainsDecodedRecipient(wrongPath)).toThrow(/FR-2\.1 violated/);
  });

  it("throws when the recipient is constrained but transaction.to / value are not", () => {
    const halfLocked: PolicyCreateParams = {
      version: "1.0",
      name: "half locked",
      chain_type: "ethereum",
      owner_id: QUORUM,
      rules: [
        {
          name: "calldata only",
          method: "eth_signTransaction",
          action: "ALLOW",
          conditions: [
            {
              field_source: "ethereum_calldata",
              field: "function_name",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: "transfer"
            },
            {
              field_source: "ethereum_calldata",
              field: "transfer._to",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: PAYEE
            }
          ]
        }
      ]
    };
    expect(() => assertConstrainsDecodedRecipient(halfLocked)).toThrow(
      /missing ethereum_transaction\.to, ethereum_transaction\.value/
    );
  });

  it("throws when function_name does not match the constrained recipient's function", () => {
    const mismatched: PolicyCreateParams = {
      version: "1.0",
      name: "mismatched",
      chain_type: "ethereum",
      owner_id: QUORUM,
      rules: [
        {
          name: "transferFrom recipient under a transfer gate",
          method: "eth_signTransaction",
          action: "ALLOW",
          conditions: [
            { field_source: "ethereum_transaction", field: "to", operator: "eq", value: USDC },
            { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
            {
              field_source: "ethereum_calldata",
              field: "function_name",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: "transfer"
            },
            {
              field_source: "ethereum_calldata",
              field: "transferFrom._to",
              abi: BOLT_ERC20_ABI,
              operator: "eq",
              value: PAYEE
            }
          ]
        }
      ]
    };
    expect(() => assertConstrainsDecodedRecipient(mismatched)).toThrow(/FR-2\.1 violated/);
  });

  it("passes every ALLOW rule the builder actually emits", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE, OTHER]
    });
    expect(() => assertConstrainsDecodedRecipient(policy)).not.toThrow();
    const allows = policy.rules.filter((r) => r.action === "ALLOW");
    expect(allows.length).toBeGreaterThan(0);
    for (const rule of allows) {
      expect(
        rule.conditions.some(
          (c) =>
            c.field_source === "ethereum_calldata" &&
            (DECODED_RECIPIENT_FIELDS as readonly string[]).includes(c.field)
        )
      ).toBe(true);
    }
  });
});

// --------------------------------------------------------------- the output

describe("buildLockedAccountPolicy", () => {
  it("pins an ABI whose transfer recipient input is named _to", () => {
    const transfer = BOLT_ERC20_ABI.find((f) => f.name === "transfer");
    expect(transfer?.inputs[0]?.name).toBe("_to");
    // Every calldata condition must carry that same ABI — the field path is
    // meaningless without it, and a different ABI silently retargets the check.
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE]
    });
    for (const rule of policy.rules) {
      for (const c of rule.conditions) {
        if (c.field_source === "ethereum_calldata") expect(c.abi).toBe(BOLT_ERC20_ABI);
      }
    }
  });

  it("lists every permitted address in both casings, so a mismatch fails closed", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE, OTHER]
    });
    const rule = policy.rules.find((r) => r.action === "ALLOW");
    const recipient = rule?.conditions.find((c) => c.field === "transfer._to");
    expect(recipient?.operator).toBe("in");
    expect(recipient?.value).toEqual([
      PAYEE.toLowerCase(),
      PAYEE,
      OTHER.toLowerCase(),
      OTHER
    ]);
  });

  it("requires ethereum_transaction.value == 0 (Arc: USDC is also the gas token)", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE]
    });
    for (const rule of policy.rules.filter((r) => r.action === "ALLOW")) {
      const v = rule.conditions.find(
        (c) => c.field_source === "ethereum_transaction" && c.field === "value"
      );
      expect(v?.operator).toBe("eq");
      expect(v?.value).toBe("0");
    }
  });

  it("emits no trailing DENY * — it would take precedence and kill the ALLOW too", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE]
    });
    expect(policy.rules.some((r) => r.method === "*")).toBe(false);
    expect(policy.rules.some((r) => r.action === "DENY" && r.conditions.length === 0)).toBe(
      false
    );
  });

  it("denies approve and transferFrom explicitly (FR-2.8)", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE]
    });
    const denied = policy.rules
      .filter((r) => r.action === "DENY")
      .flatMap((r) => r.conditions.filter((c) => c.field === "function_name").map((c) => c.value));
    expect(denied).toContain("approve");
    expect(denied).toContain("transferFrom");
  });

  it("sets owner_id at creation and rejects a policy with no owner (invariant 3)", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: [PAYEE]
    });
    expect(policy.owner_id).toBe(QUORUM);
    expect(() =>
      buildLockedAccountPolicy({
        ...base,
        ownerKeyQuorumId: "",
        accountClass: "CLIENT_MONEY",
        permittedAddresses: [PAYEE]
      })
    ).toThrow(/ownerKeyQuorumId is required/);
  });

  it("permits exactly one destination for OBLIGATION_RESERVE (FR-2.3)", () => {
    expect(() =>
      buildLockedAccountPolicy({
        ...base,
        accountClass: "OBLIGATION_RESERVE",
        permittedAddresses: [PAYEE, OTHER]
      })
    ).toThrow(/FR-2\.3 violated/);
    expect(() =>
      buildLockedAccountPolicy({
        ...base,
        accountClass: "OBLIGATION_RESERVE",
        permittedAddresses: [PAYEE]
      })
    ).not.toThrow();
  });

  it("refuses to build a policy for an OPERATING account", () => {
    expect(() =>
      buildLockedAccountPolicy({
        ...base,
        accountClass: "OPERATING",
        permittedAddresses: [PAYEE]
      })
    ).toThrow(/OPERATING accounts carry no policy/);
  });

  it("emits no ALLOW rule at all when there are no permitted payees yet", () => {
    const policy = buildLockedAccountPolicy({
      ...base,
      accountClass: "CLIENT_MONEY",
      permittedAddresses: []
    });
    expect(policy.rules.every((r) => r.action === "DENY")).toBe(true);
  });

  it("rejects a non-address payee", () => {
    expect(() =>
      buildLockedAccountPolicy({
        ...base,
        accountClass: "CLIENT_MONEY",
        permittedAddresses: ["not-an-address"]
      })
    ).toThrow(/is not an EVM address/);
  });
});

describe("FR-1.6 — client money never earns", () => {
  it("cannot be turned on for CLIENT_MONEY by any argument", () => {
    expect(yieldEnabledFor("CLIENT_MONEY", true)).toBe(false);
    expect(yieldEnabledFor("OPERATING", true)).toBe(false);
    expect(yieldEnabledFor("OBLIGATION_RESERVE", true)).toBe(true);
    expect(yieldEnabledFor("OBLIGATION_RESERVE")).toBe(false);
  });
});
