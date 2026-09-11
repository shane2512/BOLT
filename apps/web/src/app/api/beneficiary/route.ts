/**
 * FR-6.7 — beneficiary lookup by email.
 *
 * The email -> wallet-address step is a legitimate Postgres directory lookup
 * (it's not a displayed "figure", just a join key). Everything returned to
 * the client after that is on-chain: the wallet's `Account.held` if it's a
 * registered BOLT account, otherwise a direct `USDC.balanceOf` read against
 * Arc — never a Postgres balance (CLAUDE.md invariant 8).
 *
 * NOTE: the Postgres half of this route is not live-testable in this sandbox
 * (direct DB ports are unreachable here) — see the Phase 5 report.
 */
import { and, eq } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";
import { arcTestnet, queryAccountById } from "@bolt/core";
import { BOLT_ERC20_ABI } from "@bolt/privy";
import { createDb, beneficiaries, businesses } from "@bolt/db";
import { createPublicClient, http } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  slug: z.string().min(1),
  email: z.string().email()
});

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "slug and a valid email are required" }, { status: 400 });
  }
  const { slug, email } = parsed.data;

  const db = createDb();

  const [business] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug));
  if (!business) {
    return Response.json({ error: "unknown business" }, { status: 404 });
  }

  const [beneficiary] = await db
    .select({ walletAddress: beneficiaries.walletAddress })
    .from(beneficiaries)
    .where(and(eq(beneficiaries.businessId, business.id), eq(beneficiaries.email, email.trim().toLowerCase())));

  if (!beneficiary?.walletAddress) {
    return Response.json({ found: false });
  }

  const address = getAddress(beneficiary.walletAddress);

  // Prefer the subgraph (it's a registered BOLT account only if one exists
  // for this address — beneficiary wallets aren't BoltRegistry accounts
  // before Phase 8 ships payouts). Fall back to a direct chain read.
  const account = await queryAccountById(need("SUBGRAPH_URL"), address);
  if (account) {
    return Response.json({ found: true, address, held: account.held.toString(), source: "subgraph-account" });
  }

  const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
  const held = (await client.readContract({
    address: getAddress(need("USDC_ADDRESS")),
    abi: BOLT_ERC20_ABI,
    functionName: "balanceOf",
    args: [address]
  })) as bigint;

  return Response.json({ found: true, address, held: held.toString(), source: "onchain-balance" });
}
