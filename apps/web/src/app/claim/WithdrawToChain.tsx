"use client";

/**
 * FR-8.4 — withdrawal to another chain, one button. And BOLT's **Arc App Kit**
 * integration.
 *
 * `@circle-fin/bridge-kit` is one of Arc's App Kits (arc-docs `/app-kit` —
 * "a suite of SDKs for composing multichain payment and liquidity flows without
 * orchestrating separate, low-level protocol integrations"). Bridge is the CCTP
 * capability: it "abstracts the underlying CCTP flow so you can bridge without
 * orchestrating the low-level burn, attestation, and mint steps yourself"
 * (arc-docs `/app-kit/bridge`). `Arc_Testnet` is a first-class chain in it
 * (`@circle-fin/bridge-kit/chains` exports `ArcTestnet`).
 *
 * Where it sits, and why here rather than in the payout:
 *
 *   The payout out of a locked account is signed inside Privy's enclave against
 *   a policy that decodes `transfer._to`. Handing that transaction to a
 *   different SDK to build and broadcast would move the exact calldata the
 *   policy checks out of the file that is responsible for it, for no gain —
 *   App Kit does not sign in a TEE and Privy will not broadcast on Arc anyway.
 *   So the App Kit sits on the **beneficiary's own leg**: once the money is
 *   theirs, moving it off Arc is a bridging problem, which is precisely what an
 *   App Kit is for, and hand-rolling CCTP's burn → attestation → mint would be
 *   three days of work this SDK does in one call.
 *
 * The source signer is the beneficiary's Privy embedded wallet, exposed as an
 * EIP-1193 provider (`wallet.getEthereumProvider()`) and wrapped with
 * `createViemAdapterFromProvider` — the browser-wallet setup in arc-docs
 * `/app-kit/tutorials/adapter-setups`. No Circle API key is involved: an API
 * key is documented as optional-for-Swap and is only required by the *Circle
 * Wallets* adapter, which we do not use.
 *
 * Still: no seed phrase, no gas purchase, no chain picker beyond one dropdown,
 * and no bridge UI to reason about (FR-8.2). The user presses one button.
 */
import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";

/** Destinations we offer. Arc is always the source — it is where the money is. */
const DESTINATIONS = [
  { id: "Base_Sepolia", label: "Base Sepolia" },
  { id: "Ethereum_Sepolia", label: "Ethereum Sepolia" },
  { id: "Avalanche_Fuji", label: "Avalanche Fuji" }
] as const;

type Outcome =
  | { kind: "idle" }
  | { kind: "bridging"; step: string }
  | { kind: "done"; steps: { name: string; explorerUrl?: string }[] }
  | { kind: "error"; message: string };

export default function WithdrawToChain({ address }: { address: string }) {
  const { wallets } = useWallets();
  const [destination, setDestination] = useState<string>(DESTINATIONS[0].id);
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const wallet = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());

  async function bridge() {
    if (!wallet) {
      setOutcome({ kind: "error", message: "This address is not a wallet you are signed in to." });
      return;
    }
    setOutcome({ kind: "bridging", step: "preparing" });
    try {
      // Loaded here rather than at module scope: the kit pulls in chain
      // definitions for every CCTP network and there is no reason to ship that
      // to a beneficiary who only ever withdraws on Arc.
      const [{ BridgeKit }, { ArcTestnet }, { createViemAdapterFromProvider }] = await Promise.all([
        import("@circle-fin/bridge-kit"),
        import("@circle-fin/bridge-kit/chains"),
        import("@circle-fin/adapter-viem-v2")
      ]);

      const provider = await wallet.getEthereumProvider();
      // Privy and the adapter each ship their own EIP-1193 typings; the runtime
      // object satisfies both (`request`, `on`, `removeListener`) and only the
      // event-map generics differ.
      const adapter = await createViemAdapterFromProvider({ provider: provider as never });

      const kit = new BridgeKit();
      kit.on("*", (payload: { method?: string }) => {
        setOutcome({ kind: "bridging", step: payload.method ?? "working" });
      });

      const result = await kit.bridge({
        from: { adapter, chain: ArcTestnet, address },
        to: { adapter, chain: destination, address },
        amount,
        token: "USDC"
      } as never);

      const steps = ((result as { steps?: { name: string; explorerUrl?: string }[] }).steps ?? []).map(
        (s) => ({ name: s.name, explorerUrl: s.explorerUrl })
      );
      if ((result as { state?: string }).state === "success") {
        setOutcome({ kind: "done", steps });
      } else {
        setOutcome({ kind: "error", message: `Bridge did not complete: ${JSON.stringify(steps)}` });
      }
    } catch (e) {
      setOutcome({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm">Withdraw to another chain</summary>
      <p className="mt-2 text-xs text-gray-500">
        Moves USDC off Arc with Circle&apos;s CCTP, through Arc&apos;s Bridge App Kit. Burn,
        attestation and mint all happen behind this one button.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          placeholder="1.00"
          inputMode="decimal"
          className="w-28 rounded-lg border px-3 py-2 text-sm"
        />
        <select
          value={destination}
          onChange={(e) => setDestination(e.currentTarget.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        >
          {DESTINATIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => void bridge()}
        disabled={outcome.kind === "bridging" || !amount}
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
      >
        {outcome.kind === "bridging" ? `Bridging — ${outcome.step}…` : "Bridge"}
      </button>

      {outcome.kind === "done" ? (
        <ul className="mt-3 space-y-1 text-xs">
          {outcome.steps.map((s) => (
            <li key={s.name}>
              {s.name}
              {s.explorerUrl ? (
                <>
                  {" — "}
                  <a href={s.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    explorer
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {outcome.kind === "error" ? (
        <p className="mt-3 break-words text-xs text-red-700">{outcome.message}</p>
      ) : null}
    </details>
  );
}
