/**
 * B2 / B5 / B6 — show the operator the actual policy, before anything is
 * created.
 *
 * This route builds a real `PolicyCreateParams` with the same
 * `buildLockedAccountPolicy` that provisioning uses, and runs the same
 * `assertConstrainsDecodedRecipient` guard over the result. There is no second
 * implementation and no simplified "preview" version — a preview that is not
 * the real thing would be worse than no preview, because it would teach an
 * operator to trust a shape that never reaches the enclave.
 *
 * It creates nothing. Provisioning a business means creating a Privy key
 * quorum, an organization and wallets, and the quorum's P-256 public keys must
 * be generated where their private halves can be held — not typed into a web
 * form. `packages/privy/scripts/phase2-provision.ts` is the path for that, and
 * the dashboard says so rather than offering a button that would have to
 * pretend.
 */
import { z } from "zod";
import {
  assertConstrainsDecodedRecipient,
  buildLockedAccountPolicy,
  yieldEnabledFor
} from "@bolt/privy";
import { policyHashOf, type AccountClass } from "@bolt/core";
import { withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const specSchema = z.object({
  name: z.string().min(1).max(120),
  accountClass: z.enum(["OPERATING", "CLIENT_MONEY", "OBLIGATION_RESERVE"]),
  permittedAddresses: z.array(z.string()).max(50),
  ownerKeyQuorumId: z.string().min(1),
  yieldRequested: z.boolean().optional()
});

export const POST = withOperator(async (request) => {
  const parsed = specSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const spec = parsed.data;
  const accountClass = spec.accountClass as AccountClass;

  // FR-11.2 / invariant 4: the class decides, not the request.
  const yieldEnabled = yieldEnabledFor(accountClass, spec.yieldRequested ?? false);

  if (accountClass === "OPERATING") {
    return {
      ok: true as const,
      accountClass,
      yieldEnabled,
      policy: null,
      policyHash: null,
      note: "An OPERATING account carries no policy at all. It holds the business's own working capital and is deliberately spendable — locking it would be a claim BOLT does not make."
    };
  }

  const usdcAddress = process.env.USDC_ADDRESS;
  const chainId = Number(process.env.ARC_CHAIN_ID ?? 0);
  if (!usdcAddress || !chainId) {
    return {
      ok: false as const,
      error: "USDC_ADDRESS and ARC_CHAIN_ID must be set to build a policy for this chain."
    };
  }

  try {
    const policy = buildLockedAccountPolicy({
      name: spec.name,
      accountClass,
      permittedAddresses: spec.permittedAddresses.map((a) => a.trim()).filter(Boolean),
      usdcAddress,
      chainId,
      ownerKeyQuorumId: spec.ownerKeyQuorumId
    });

    // The guard that makes invariant 2 real. If a policy ever came back from
    // the builder without a decoded-recipient condition, this throws, and the
    // operator sees the throw rather than a policy that permits paying anyone.
    assertConstrainsDecodedRecipient(policy);

    return {
      ok: true as const,
      accountClass,
      yieldEnabled,
      policy,
      policyHash: policyHashOf(policy),
      note:
        accountClass === "CLIENT_MONEY"
          ? "Client money never earns yield, by design — that is a decision about whose money it is, not a setting."
          : "An obligation reserve is the company's own liability, so it may earn while idle. It permits exactly one destination."
    };
  } catch (error) {
    // A builder refusal is the product working: FR-2.3's one-destination rule,
    // the missing-quorum rule, an address that is not an address.
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
});
