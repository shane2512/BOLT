/**
 * FR-3.1 — the deposit webhook endpoint.
 *
 * Privy POSTs a signed `wallet.funds_deposited` event here when USDC lands in
 * the business's OPERATING account. This file is only the adapter: it reads the
 * raw body (the signature is over the exact bytes, so it must never be
 * re-serialised from a parsed object), hands it to `handleDepositWebhook`, and
 * returns whatever that says. All of the behaviour worth testing — signature
 * verification, idempotency, the split — lives in `@bolt/privy` so the route,
 * the tests and the Phase 3 evidence harness cannot drift apart.
 *
 * Registered in the Privy Dashboard under Configuration > Webhooks, with the
 * signing key in `PRIVY_WEBHOOK_SECRET`. Webhooks are free in a development
 * environment; production webhooks are an Enterprise feature, so BOLT does not
 * claim them (privy-docs /api-reference/webhooks/overview.mdx).
 */
import { PrivyClient } from "@privy-io/node";
import type { Hex } from "viem";
import { createRegistryWriter, businessIdOf, bytes32Of } from "@bolt/core";
import { createDb, type BoltDb } from "@bolt/db";
import { eq } from "drizzle-orm";
import { accounts as accountsTable, businesses } from "@bolt/db";
import {
  handleDepositWebhook,
  loadAccounts,
  type SplitterAccount
} from "@bolt/privy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

export async function POST(request: Request): Promise<Response> {
  // The svix signature covers the raw bytes. Parsing first and re-stringifying
  // would change them and every valid webhook would fail verification.
  const rawBody = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? ""
  };

  const privy = new PrivyClient({
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET"),
    webhookSigningSecret: need("PRIVY_WEBHOOK_SECRET")
  });
  // `createDb` returns the schema-typed drizzle client; the splitter takes the
  // schema-agnostic `BoltDb` so tests can swap in PGlite against the same schema.
  const db = createDb() as unknown as BoltDb & ReturnType<typeof createDb>;
  const registry = createRegistryWriter({
    registryAddress: need("REGISTRY_ADDRESS") as Hex,
    recorderPrivateKey: need("DEPLOYER_PRIVATE_KEY") as Hex,
    rpcUrl: process.env.ARC_RPC_URL
  });

  const result = await handleDepositWebhook(
    {
      privy,
      db,
      registry,
      usdcAddress: need("USDC_ADDRESS"),
      chainId: Number(need("ARC_CHAIN_ID")),
      rpcUrl: process.env.ARC_RPC_URL,
      async resolveTarget(payload) {
        // The receiving address is the join key: `accounts.address` is unique,
        // and a wallet BOLT does not manage simply is not in the table.
        const [row] = await db
          .select({
            id: accountsTable.id,
            address: accountsTable.address,
            accountClass: accountsTable.class,
            label: accountsTable.label,
            businessId: accountsTable.businessId
          })
          .from(accountsTable)
          .where(eq(accountsTable.address, payload.recipient));
        if (!row) return null;

        const [business] = await db
          .select({ slug: businesses.slug, name: businesses.name })
          .from(businesses)
          .where(eq(businesses.id, row.businessId));
        if (!business) return null;

        const accountsById = await loadAccounts(db, row.businessId);
        const account: SplitterAccount = {
          id: row.id,
          address: row.address,
          accountClass: row.accountClass,
          label: row.label
        };

        return {
          businessId: row.businessId,
          onChainBusinessId: businessIdOf(business.slug),
          account,
          accountsById,
          cfg: {
            // ponytail: single-business demo config lives in env. When BOLT
            // serves more than one business, the Privy wallet id and the
            // splitter's signer id belong on the `accounts` row.
            sourceWalletId: need("BOLT_OPERATING_WALLET_ID"),
            sourceAddress: row.address,
            splitterAuthorizationKey: need("PRIVY_SPLITTER_AUTHORIZATION_KEY"),
            usdcAddress: need("USDC_ADDRESS"),
            chainId: Number(need("ARC_CHAIN_ID")),
            rpcUrl: process.env.ARC_RPC_URL,
            onChainBusinessId: businessIdOf(business.slug),
            beneficiaryRefFor: (a: SplitterAccount) => bytes32Of(a.label)
          }
        };
      }
    },
    { rawBody, headers }
  );

  return Response.json(result.body, { status: result.status });
}
