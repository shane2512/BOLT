/**
 * FR-8.2 — the beneficiary's whole experience.
 *
 * A seller who is owed money opens this page, types their email, and gets a
 * code. There is no seed phrase to write down, no gas to buy, no chain to pick
 * and no bridge to reason about — the wallet was created for them before they
 * arrived and the money is already in it.
 *
 * Everything below the login is client-side because it depends on the Privy
 * session; the numbers it shows come from `/api/beneficiary/claim`, which reads
 * on-chain state and the obligation ledger.
 */
import ClaimFlow from "./ClaimFlow";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  searchParams
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug } = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-semibold">Claim your balance</h1>
      <p className="mt-1 text-sm text-gray-500">
        Money held for you in an account the business cannot spend from. Sign in with the email
        address you were paid to.
      </p>
      <div className="mt-6">
        <ClaimFlow slug={slug ?? "acme-marketplace"} />
      </div>
    </main>
  );
}
