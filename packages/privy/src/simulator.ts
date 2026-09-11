/**
 * FR-9 — the breach simulator's attack suite.
 *
 * This is Phase 0's go/no-go spike, made permanent and public: the same ten
 * transaction shapes, sent to the same enclave, except that the destination is
 * whatever a visitor typed rather than a throwaway address the script chose.
 *
 * Invariant 1, restated because this file is the one most likely to tempt
 * someone: **there is no destination check here, and none may be added.** Every
 * function below encodes exactly what was asked for and hands it to Privy. If
 * the visitor asks to send the sandbox's money to their own address, we ask
 * Privy to sign that, and the enclave refuses before a signature exists. An
 * application-layer guard would make the page a lie.
 *
 * Signing, not sending, on purpose. Phase 0 established that `eth_sendTransaction`
 * simulates before the policy is evaluated, so a refusal can arrive dressed as
 * `insufficient_funds`; `eth_signTransaction` runs no simulation, so what comes
 * back is the policy's own `policy_violation`. It is also the live BOLT path —
 * Privy will not broadcast on Arc (Phase 0, 401 "App is not authorized to
 * transact on chain eip155:5042002"), so every real BOLT transfer is signed in
 * the enclave and self-broadcast. A signature the enclave hands back is
 * spendable money: if an attack ever returns one, the lock is broken.
 *
 * Worked from the same docs as policy-builder.ts and phase0-spike/spike.ts;
 * no new Privy SDK surface is used here.
 */
import { encodeFunctionData, getAddress, numberToHex, type Hex } from "viem";
import type { PrivyClient } from "@privy-io/node";
import { BOLT_ERC20_ABI } from "./policy-builder.js";
import { rawErrorBody } from "./refusals.js";

/**
 * Arc's Multicall3From, from arc-docs /arc/concepts/batched-transactions.mdx.
 * Used only as an attack: a batching contract is the classic way to smuggle a
 * transfer past a policy that only looks at `transaction.to`.
 */
export const ARC_MULTICALL3_FROM = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";

const MULTICALL_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" }
        ]
      }
    ]
  }
] as const;

/** 0.01 USDC in base units. Money is bigint, always (NFR-5). */
export const SIMULATOR_AMOUNT = 10_000n;

export interface AttackContext {
  /** The locked sandbox account the attack spends from. */
  from: string;
  /** USDC on Arc — also the native gas token, which is why `value` matters. */
  usdcAddress: string;
  /** The one address this account's policy permits. */
  permittedPayee: string;
  /** Where the visitor wants the money to go. Never validated. */
  destination: string;
}

export interface Attack {
  id: string;
  label: string;
  /** What the lock should do. Not a check — a statement of the expected result. */
  expect: "ALLOW" | "REFUSE";
  /** Which policy condition is supposed to stop it. */
  stoppedBy: string;
  /** Does this shape aim at the visitor's address, or at the permitted payee? */
  usesDestination: boolean;
  build: (ctx: AttackContext) => { to: string; value: Hex; data: Hex };
}

const transferData = (to: string): Hex =>
  encodeFunctionData({
    abi: BOLT_ERC20_ABI,
    functionName: "transfer",
    args: [getAddress(to), SIMULATOR_AMOUNT]
  });

/**
 * A valid `transfer(address,uint256)` selector whose address word is padded with
 * garbage instead of zeroes. A decoder that masks the low 20 bytes still reads
 * the same recipient — so a policy that decodes properly must still refuse.
 */
const dirtyPad = (to: string): Hex =>
  ("0xa9059cbb" +
    "deadbeefcafebabefeedface" +
    to.slice(2).toLowerCase() +
    SIMULATOR_AMOUNT.toString(16).padStart(64, "0")) as Hex;

const trailingJunk = (to: string): Hex =>
  (transferData(to) + "ffffffffffffffffffffffffffffffff") as Hex;

/**
 * Phase 0's suite, in the order a person attacking this would actually try it.
 * The ALLOW control is last so the page ends on "and this is what the account is
 * still *for*" rather than on a refusal.
 */
export const SIMULATOR_ATTACKS: readonly Attack[] = [
  {
    id: "wrong-destination",
    label: "Send the client money to your own address",
    expect: "REFUSE",
    stoppedBy: "ethereum_calldata.transfer._to",
    usesDestination: true,
    build: (c) => ({ to: c.usdcAddress, value: "0x0", data: transferData(c.destination) })
  },
  {
    id: "native-value-send",
    label: "Skip the token contract — send native value instead",
    expect: "REFUSE",
    stoppedBy: "ethereum_transaction.to == USDC",
    usesDestination: true,
    build: (c) => ({ to: c.destination, value: numberToHex(SIMULATOR_AMOUNT), data: "0x" })
  },
  {
    id: "permitted-transfer-with-native-value",
    label: "Permitted transfer, with native value riding along",
    expect: "REFUSE",
    stoppedBy: "ethereum_transaction.value == 0",
    usesDestination: false,
    build: (c) => ({
      to: c.usdcAddress,
      value: numberToHex(SIMULATOR_AMOUNT),
      data: transferData(c.permittedPayee)
    })
  },
  {
    id: "approve",
    label: "Approve yourself as a spender (step 1 of an allowance drain)",
    expect: "REFUSE",
    stoppedBy: "explicit DENY on approve, and default-deny behind it",
    usesDestination: true,
    build: (c) => ({
      to: c.usdcAddress,
      value: "0x0",
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: "approve",
        args: [getAddress(c.destination), 2n ** 256n - 1n]
      })
    })
  },
  {
    id: "transfer-from",
    label: "Pull the money out with transferFrom",
    expect: "REFUSE",
    stoppedBy: "explicit DENY on transferFrom",
    usesDestination: true,
    build: (c) => ({
      to: c.usdcAddress,
      value: "0x0",
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: "transferFrom",
        args: [getAddress(c.from), getAddress(c.destination), SIMULATOR_AMOUNT]
      })
    })
  },
  {
    id: "dirty-padding",
    label: "Hand-encode the transfer with dirty address padding",
    expect: "REFUSE",
    stoppedBy: "ethereum_calldata.transfer._to (the enclave decodes properly)",
    usesDestination: true,
    build: (c) => ({ to: c.usdcAddress, value: "0x0", data: dirtyPad(c.destination) })
  },
  {
    id: "trailing-bytes",
    label: "Append junk bytes after the calldata",
    expect: "REFUSE",
    stoppedBy: "ethereum_calldata.transfer._to",
    usesDestination: true,
    build: (c) => ({ to: c.usdcAddress, value: "0x0", data: trailingJunk(c.destination) })
  },
  {
    id: "multicall-wrapper",
    label: "Wrap the transfer in Arc's Multicall3From batcher",
    expect: "REFUSE",
    stoppedBy: "ethereum_transaction.to == USDC",
    usesDestination: true,
    build: (c) => ({
      to: ARC_MULTICALL3_FROM,
      value: "0x0",
      data: encodeFunctionData({
        abi: MULTICALL_ABI,
        functionName: "aggregate3",
        args: [
          [
            {
              target: getAddress(c.usdcAddress),
              allowFailure: false,
              callData: transferData(c.destination)
            }
          ]
        ]
      })
    })
  },
  {
    id: "permitted-transfer",
    label: "Control: pay the one address the policy permits",
    expect: "ALLOW",
    stoppedBy: "nothing — this is what the account is for",
    usesDestination: false,
    build: (c) => ({ to: c.usdcAddress, value: "0x0", data: transferData(c.permittedPayee) })
  }
] as const;

export const findAttack = (id: string): Attack | undefined =>
  SIMULATOR_ATTACKS.find((a) => a.id === id);

export interface SimulatorWallet {
  walletId: string;
  address: string;
  usdcAddress: string;
  permittedPayee: string;
  chainId: number;
  rpcUrl: string;
  /**
   * The sandbox key quorum's private key — and nothing else. It authorizes
   * requests against sandbox wallets only; every real business's wallets are
   * owned by a different quorum, so this key cannot address them (FR-9.4).
   */
  authorizationPrivateKeys: string[];
}

export type AttemptResult =
  | { attackId: string; outcome: "ALLOWED"; signedTransaction: unknown; transaction: Record<string, unknown> }
  | { attackId: string; outcome: "REFUSED"; rawError: unknown; transaction: Record<string, unknown> };

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.result === undefined) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * Builds one attack and asks the enclave to sign it.
 *
 * Returns a result rather than throwing, because a refusal is the expected,
 * successful outcome here — but the error body inside it is `rawErrorBody`'s
 * verbatim copy of what Privy threw (FR-2.4 / FR-9.2). Nothing is summarised,
 * renamed or dropped on the way to the page.
 */
export async function attemptAttack(
  privy: PrivyClient,
  wallet: SimulatorWallet,
  attack: Attack,
  destination: string
): Promise<AttemptResult> {
  const shape = attack.build({
    from: wallet.address,
    usdcAddress: wallet.usdcAddress,
    permittedPayee: wallet.permittedPayee,
    destination
  });

  const [nonceHex, gasPriceHex] = await Promise.all([
    rpc<Hex>(wallet.rpcUrl, "eth_getTransactionCount", [getAddress(wallet.address), "pending"]),
    rpc<Hex>(wallet.rpcUrl, "eth_gasPrice", [])
  ]);
  const gasPrice = BigInt(gasPriceHex);

  const transaction: Record<string, unknown> = {
    from: getAddress(wallet.address),
    chain_id: wallet.chainId,
    nonce: Number(BigInt(nonceHex)),
    type: 2,
    gas_limit: 300_000,
    max_fee_per_gas: numberToHex(gasPrice * 2n),
    max_priority_fee_per_gas: numberToHex(gasPrice),
    to: getAddress(shape.to),
    value: shape.value,
    data: shape.data
  };

  try {
    const signed = await privy
      .wallets()
      .ethereum()
      .signTransaction(wallet.walletId, {
        params: { transaction },
        authorization_context: { authorization_private_keys: wallet.authorizationPrivateKeys }
      } as never);
    return { attackId: attack.id, outcome: "ALLOWED", signedTransaction: signed, transaction };
  } catch (error) {
    return { attackId: attack.id, outcome: "REFUSED", rawError: rawErrorBody(error), transaction };
  }
}
