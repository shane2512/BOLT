/**
 * FR-5.2 — the approval screen. Built narrow because it is opened on a phone:
 * one unlock, what it would move, why, and one button.
 *
 * The reason text comes from Postgres — it is workflow state, not a figure
 * (invariant 8 is about numbers that must trace to the chain). Its keccak is on
 * chain in `UnlockRequested.reasonHash`, and both are shown here so an approver
 * can check that the reason they are approving is the reason that was committed.
 */
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { arcTestnet, reasonHashOf, unlockIdOf } from "@bolt/core";
import { accounts, createDb, unlockApprovals, unlockRequests } from "@bolt/db";
import ApproveWithSelfieCheck from "./ApproveWithSelfieCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLORER = arcTestnet.blockExplorers.default.url;

const fmtUsdc = (v: bigint): string =>
  `${(Number(v) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC`;

export default async function ApprovePage({
  params,
  searchParams
}: {
  params: Promise<{ unlockId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { unlockId } = await params;
  const { as: approverId } = await searchParams;
  const db = createDb();

  const [request] = await db
    .select()
    .from(unlockRequests)
    .where(eq(unlockRequests.id, unlockId));
  if (!request) notFound();

  const [account] = await db.select().from(accounts).where(eq(accounts.id, request.accountId));
  const approvals = await db
    .select()
    .from(unlockApprovals)
    .where(eq(unlockApprovals.unlockRequestId, request.id));

  const onChainId = unlockIdOf(request.id);
  const committed = reasonHashOf(request.reason) === request.reasonHash;

  return (
    <main className="mx-auto max-w-md space-y-6 p-5 text-sm">
      <header>
        <h1 className="text-lg font-semibold">Approve an early unlock</h1>
        <p className="mt-1 text-gray-500">
          Locked money only leaves this account two ways. This is one of them.
        </p>
      </header>

      <dl className="space-y-3 rounded-lg border p-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Amount</dt>
          <dd className="text-lg font-medium">{fmtUsdc(request.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">From</dt>
          <dd className="break-all font-mono text-xs">
            <a
              href={`${EXPLORER}/address/${account?.address ?? ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {account?.label ?? "account"} — {account?.address}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">To</dt>
          <dd className="break-all font-mono text-xs">
            <a
              href={`${EXPLORER}/address/${request.destination}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {request.destination}
            </a>
            <span className="block font-sans text-gray-500">
              Already a permitted payee under this account&apos;s policy. An unlock releases money
              the policy allows; it does not widen the policy.
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Reason</dt>
          <dd>{request.reason}</dd>
          <dd className="mt-1 break-all font-mono text-[11px] text-gray-500">
            keccak256 {request.reasonHash} {committed ? "· matches the on-chain commitment" : "· DOES NOT MATCH"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">On-chain unlock id</dt>
          <dd className="break-all font-mono text-[11px]">{onChainId}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Approvals so far</dt>
          <dd>{approvals.length}</dd>
        </div>
      </dl>

      {approverId ? (
        <ApproveWithSelfieCheck unlockRequestId={request.id} approverId={approverId} />
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          Open this page from your own approval link — it carries which quorum member you are.
        </p>
      )}

      <p className="text-xs text-gray-500">
        After the final approval a 24-hour timer starts on chain, at{" "}
        <a
          href={`${EXPLORER}/address/${process.env.UNLOCK_TIMER_ADDRESS ?? ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          BoltUnlockTimer
        </a>
        . Nothing can move before it elapses, including by us.
      </p>
    </main>
  );
}
