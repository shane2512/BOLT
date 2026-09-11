/**
 * FR-3.3 — the box the splitter runs inside.
 *
 * The splitter is not a person and not an account owner. It is an **additional
 * signer** on the business's OPERATING wallet, carrying its own override policy.
 * When the splitter's authorization key signs a request, Privy evaluates *only*
 * this policy — not the wallet owner's — so the splitter's reach is whatever
 * this file permits and nothing else.
 *
 * What it permits: a USDC `transfer` whose **decoded recipient** is one of this
 * business's own accounts. That is the entire point. A compromised splitter — a
 * leaked key, a poisoned webhook, a bug in our own code that computes the wrong
 * destination — cannot pay an outsider, because the enclave refuses to
 * reassemble the key before a signature exists. Our backend does not get a vote.
 *
 * This is deliberately *not* the same policy Phase 2 attached to the locked
 * accounts. Those constrain where a locked account's money may go (verified
 * beneficiaries, a tax authority). This one constrains where the *splitter* may
 * move money (inside the business only). Two different actors, two different
 * allowlists, evaluated independently.
 *
 * Worked from privy-docs:
 *   /recipes/wallets/conditional-signer-policies.mdx — additional signers with
 *     override policies; "When a signer submits a transaction, Privy evaluates
 *     only that signer's override policy"
 *   /api-reference/wallets/update.mdx — `additional_signers[].signer_id` is a
 *     key quorum id; `override_policy_ids` takes up to one policy
 */
import type { PolicyCreateParams } from "@privy-io/node/resources";
import { buildTransferPolicy } from "./policy-builder.js";

export interface SplitterSignerPolicySpec {
  /** Business name, for the policy's display name only. */
  businessName: string;
  /**
   * Every account address belonging to this business — including the OPERATING
   * account the splits leave from, since a mandate may retain a share there.
   * Nothing outside this set is reachable by the splitter.
   */
  ownAccountAddresses: readonly string[];
  usdcAddress: string;
  chainId: number;
  /** Key quorum that owns the policy. Widening it is a quorum action (invariant 3). */
  ownerKeyQuorumId: string;
}

export function buildSplitterSignerPolicy(
  spec: SplitterSignerPolicySpec
): PolicyCreateParams {
  if (spec.ownAccountAddresses.length === 0) {
    throw new Error(
      "splitter-policy: a splitter with no permitted destinations cannot split. " +
        "Pass the business's own account addresses."
    );
  }
  // Name is capped at 50 characters by Privy.
  return buildTransferPolicy({
    name: `Splitter — ${spec.businessName}`.slice(0, 50),
    permittedAddresses: spec.ownAccountAddresses,
    usdcAddress: spec.usdcAddress,
    chainId: spec.chainId,
    ownerKeyQuorumId: spec.ownerKeyQuorumId
  });
}
