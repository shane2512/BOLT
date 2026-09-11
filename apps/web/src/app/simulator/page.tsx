/**
 * FR-9 — the public breach simulator.
 *
 * Unauthenticated, and it hands the visitor the operator's seat: the sandbox
 * business's locked client-money account, real USDC on Arc, and every attack
 * shape Phase 0 used on day one. Nothing here is a simulation in the sense of
 * being fake — the only thing "sandbox" means is that the money is ours and the
 * key quorum is not a real business's.
 *
 * Every number on this page comes from Arc (the balance, the addresses) or from
 * the enclave (the refusals). The one exception is the tally, which counts
 * requests this server has handled and says so.
 */
import { arcTestnet } from "@bolt/core";
import SimulatorConsole from "./SimulatorConsole";
import sandbox from "./sandbox.json";

export const dynamic = "force-dynamic";

const EXPLORER = arcTestnet.blockExplorers.default.url;

export const metadata = {
  title: "BOLT — breach simulator",
  description:
    "Take the operator's seat on a real, locked BOLT account and try to steal the money."
};

export default function SimulatorPage() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8 text-sm">
      <header>
        <h1 className="text-2xl font-semibold">Breach simulator</h1>
        <p className="text-gray-600 mt-2 max-w-2xl">
          You are the operator. This is a real Privy organization holding real USDC on Arc
          testnet, in a real locked account, behind a real policy. No login, no approval, no
          rate of trust — you have the same powers the business itself has.
        </p>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Pick a destination and try to move the money to it. The server does not check where
          you are sending it. It builds exactly what you asked for, hands it to Privy, and
          shows you whatever comes back — the enclave&apos;s own error, verbatim.
        </p>
      </header>

      <section className="border rounded p-4 bg-gray-50">
        <h2 className="font-medium">The account you are attacking</h2>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
          <div>
            <dt className="uppercase tracking-wide text-gray-500">Locked account</dt>
            <dd className="font-mono break-all">
              <a
                href={`${EXPLORER}/address/${sandbox.account.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {sandbox.account.address}
              </a>
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-gray-500">Class</dt>
            <dd className="font-mono">{sandbox.account.accountClass}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-gray-500">
              The one address its policy permits
            </dt>
            <dd className="font-mono break-all">
              <a
                href={`${EXPLORER}/address/${sandbox.permittedPayee}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {sandbox.permittedPayee}
              </a>
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-gray-500">Privy policy</dt>
            <dd className="font-mono break-all">{sandbox.account.policyId}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-gray-500">Key quorum</dt>
            <dd className="font-mono break-all">{sandbox.keyQuorumId}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-gray-500">USDC on Arc</dt>
            <dd className="font-mono break-all">{sandbox.usdcAddress}</dd>
          </div>
        </dl>
      </section>

      <SimulatorConsole />

      <section className="border rounded p-4 text-xs text-gray-600 space-y-2">
        <h2 className="font-medium text-sm text-gray-900">Why this cannot touch a real business</h2>
        <p>
          The sandbox is its own Privy organization ({sandbox.organizationId}) under its own key
          quorum ({sandbox.keyQuorumId}). The credential this page&apos;s server holds belongs to
          that quorum and to nothing else. Every real BOLT business&apos;s wallets and policies are
          owned by a different quorum, so a request from here against one of them is not
          declined by this app — Privy refuses it, because this key is not their owner. That was
          attempted rather than assumed; the transcript is in{" "}
          <code>docs/evidence/phase9-simulator-isolation.json</code>.
        </p>
        <p>
          Requests are signed, not broadcast. Privy does not broadcast on Arc, so every BOLT
          transfer is signed inside the enclave and sent on by us. A refusal means no signature
          was ever produced — there is nothing to broadcast. If an attack below ever returns a
          signed transaction, you are holding spendable money and the lock is broken.
        </p>
      </section>
    </main>
  );
}
