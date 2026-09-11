/**
 * FR-1.1 / FR-1.2 / FR-1.3 — provision a business as a Privy organization with an
 * org wallet tree, and create its three accounts.
 *
 * Order matters and is not negotiable: key quorum → organization → policy →
 * wallet. The policy id is passed to `wallets().create`, so a locked account is
 * never briefly unlocked (FR-1.3). There is no code path that creates a locked
 * wallet first and attaches a policy afterwards, and none may be added.
 *
 * Worked from privy-docs:
 *   /organizations/setup/overview.mdx          — the users → quorum → org → wallets order
 *   /recipes/wallets/organization-wallets.mdx  — organizations().create, wallets().create({entity})
 *   /api-reference/organizations/create.mdx    — display_name + default_key_quorum_id
 *   /wallets/wallets/create/create-a-wallet.mdx — entity=organization sets the org's default
 *                                                 key quorum as wallet owner; one policy per wallet
 *   /controls/policies/create-a-policy.mdx     — owner_id set at creation
 * SDK checked against @privy-io/node@0.34.0 (see README note on the version bump).
 */
import type { PrivyClient } from "@privy-io/node";
import type { AccountClass } from "@bolt/core";
import { policyHashOf } from "@bolt/core";
import { accounts as accountsTable, businesses, type BoltDb } from "@bolt/db";
import type { PolicyCreateParams } from "@privy-io/node/resources";
import { buildLockedAccountPolicy, yieldEnabledFor } from "./policy-builder.js";

export interface AccountSpec {
  accountClass: AccountClass;
  label: string;
  /** Permitted payees for a locked account. Ignored for OPERATING. */
  permittedAddresses?: readonly string[];
  /** Only ever honoured for OBLIGATION_RESERVE — see `yieldEnabledFor`. */
  yieldRequested?: boolean;
}

export interface ProvisionRequest {
  slug: string;
  name: string;
  /** P-256 public keys, base64 DER, that make up the business's key quorum. */
  quorumPublicKeys: readonly string[];
  /** Signatures required to change a policy or widen a lock. */
  quorumThreshold: number;
  usdcAddress: string;
  chainId: number;
  accounts: readonly AccountSpec[];
}

export interface ProvisionedAccount {
  accountClass: AccountClass;
  label: string;
  walletId: string;
  address: string;
  policyId: string | null;
  policyHash: string | null;
  policy: PolicyCreateParams | null;
  yieldEnabled: boolean;
}

export interface ProvisionedBusiness {
  slug: string;
  name: string;
  keyQuorumId: string;
  organizationId: string;
  accounts: ProvisionedAccount[];
}

export async function provisionBusiness(
  privy: PrivyClient,
  req: ProvisionRequest
): Promise<ProvisionedBusiness> {
  // 1. The key quorum. It owns every policy and, via the organization's
  //    default_key_quorum_id, every wallet. Widening a lock goes through it.
  const keyQuorum = await privy.keyQuorums().create({
    display_name: `${req.name} — BOLT quorum`,
    public_keys: [...req.quorumPublicKeys],
    authorization_threshold: req.quorumThreshold
  });

  // 2. The organization (FR-1.1).
  const organization = await privy.organizations().create({
    display_name: req.name,
    default_key_quorum_id: keyQuorum.id
  });

  const accounts: ProvisionedAccount[] = [];
  for (const spec of req.accounts) {
    accounts.push(await provisionAccount(privy, req, organization.id, keyQuorum.id, spec));
  }

  return {
    slug: req.slug,
    name: req.name,
    keyQuorumId: keyQuorum.id,
    organizationId: organization.id,
    accounts
  };
}

async function provisionAccount(
  privy: PrivyClient,
  req: ProvisionRequest,
  organizationId: string,
  keyQuorumId: string,
  spec: AccountSpec
): Promise<ProvisionedAccount> {
  const entity = { id: organizationId, type: "organization" } as const;

  // OPERATING is the business's own money: no policy, deliberately spendable.
  if (spec.accountClass === "OPERATING") {
    const wallet = await privy.wallets().create({ chain_type: "ethereum", entity });
    return {
      accountClass: spec.accountClass,
      label: spec.label,
      walletId: wallet.id,
      address: wallet.address,
      policyId: null,
      policyHash: null,
      policy: null,
      yieldEnabled: yieldEnabledFor(spec.accountClass, spec.yieldRequested)
    };
  }

  const policyBody = buildLockedAccountPolicy({
    name: `${req.name} — ${spec.label}`,
    accountClass: spec.accountClass,
    permittedAddresses: spec.permittedAddresses ?? [],
    usdcAddress: req.usdcAddress,
    chainId: req.chainId,
    ownerKeyQuorumId: keyQuorumId
  });

  const policy = await privy.policies().create(policyBody);

  // The policy id goes in at creation. Never a create-then-attach (FR-1.3).
  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    entity,
    policy_ids: [policy.id]
  });

  return {
    accountClass: spec.accountClass,
    label: spec.label,
    walletId: wallet.id,
    address: wallet.address,
    policyId: policy.id,
    policyHash: policyHashOf(policyBody),
    policy: policyBody,
    yieldEnabled: yieldEnabledFor(spec.accountClass, spec.yieldRequested)
  };
}

/**
 * Writes the provisioned business and its accounts to Postgres. `yield_enabled`
 * comes from the already-decided `ProvisionedAccount`, which `yieldEnabledFor`
 * pinned to false for CLIENT_MONEY (FR-1.6) — there is no argument here that
 * could turn it on, and no update path that could change it later.
 *
 * Postgres holds config and workflow state only. Every figure the public page
 * renders comes from an event or a balance (invariant 8).
 */
export async function persistProvisionedBusiness(
  db: BoltDb,
  provisioned: ProvisionedBusiness,
  adminAddress: string
): Promise<{ businessId: string; accountIds: string[] }> {
  const [business] = await db
    .insert(businesses)
    .values({ slug: provisioned.slug, name: provisioned.name, adminAddress })
    .returning({ id: businesses.id });
  if (!business) throw new Error("persistProvisionedBusiness: business insert returned no row");

  const rows = await db
    .insert(accountsTable)
    .values(
      provisioned.accounts.map((a) => ({
        businessId: business.id,
        address: a.address,
        class: a.accountClass,
        label: a.label,
        policyId: a.policyId,
        policyHash: a.policyHash,
        yieldEnabled: a.yieldEnabled
      }))
    )
    .returning({ id: accountsTable.id });

  return { businessId: business.id, accountIds: rows.map((r) => r.id) };
}
