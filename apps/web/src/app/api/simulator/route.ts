/**
 * FR-9 — the breach simulator's endpoint. Public, unauthenticated, and it will
 * do whatever it is asked.
 *
 * This route is the one place in BOLT that deliberately hands full operator
 * privileges to a stranger. That is safe for exactly one reason, and it is not
 * this file: the credential it holds — `SIMULATOR_AUTHORIZATION_KEY` — is the
 * sandbox key quorum's, and every real business's wallets and policies are owned
 * by a different quorum. A request from here against `acme-marketplace` is not
 * refused by a check in this file; it is refused by Privy, because this key is
 * not that wallet's owner. Verified live, not reasoned about:
 * docs/evidence/phase9-simulator-isolation.json.
 *
 * Invariant 1 applies here more than anywhere: the visitor's destination is
 * passed through untouched. No allowlist, no "are you sure", no sanity check on
 * where the money is going. It is sent to the enclave and the enclave refuses.
 *
 * FR-9.2: the refusal returned below is `rawErrorBody`'s verbatim copy of what
 * the Privy SDK threw — every own property, nothing renamed, nothing summarised.
 * The page prints it as-is. If you ever feel the urge to map it to a friendly
 * message, that urge is the bug.
 */
import { isAddress } from "viem";
import { z } from "zod";
import { PrivyClient } from "@privy-io/node";
import { SIMULATOR_ATTACKS, attemptAttack, findAttack, type SimulatorWallet } from "@bolt/privy";
import sandbox from "../../simulator/sandbox.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

const rpcUrl = (): string => process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

/**
 * FR-9.3 — the running tally, in this process's memory.
 *
 * Deliberately not Postgres. The sandbox shares no key quorum, no organization
 * and no database row with a real business, and writing simulator traffic into
 * the same `policy_refusals` table real businesses use would be the one place
 * the two touch. It also means the tally is live wherever the page is, with no
 * database to reach. It resets when the server restarts, which is the honest
 * cost and is stated on the page.
 */
type Attempt = {
  at: string;
  attackId: string;
  label: string;
  expect: string;
  destination: string;
  outcome: "ALLOWED" | "REFUSED";
  policyViolation: boolean;
};
const tally = { attempts: 0, refusals: 0, allowed: 0, recent: [] as Attempt[] };

/**
 * A stranger on the internet can spend our Privy quota and Arc gas from here, so
 * the endpoint is capped per IP. This is a quota guard, never a safety control —
 * nothing about the lock depends on it.
 */
const RATE_LIMIT = { perMinute: 20, seen: new Map<string, number[]>() };
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (RATE_LIMIT.seen.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  RATE_LIMIT.seen.set(ip, hits);
  return hits.length > RATE_LIMIT.perMinute;
}

const attackList = SIMULATOR_ATTACKS.map((a) => ({
  id: a.id,
  label: a.label,
  expect: a.expect,
  stoppedBy: a.stoppedBy,
  usesDestination: a.usesDestination
}));

export async function GET(): Promise<Response> {
  // The sandbox's real balance, read from Arc rather than reported by us.
  let balanceWei: string | null = null;
  try {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [sandbox.account.address, "latest"]
      })
    });
    const body = (await res.json()) as { result?: string };
    balanceWei = body.result ? BigInt(body.result).toString() : null;
  } catch {
    balanceWei = null;
  }

  return Response.json({ sandbox, attacks: attackList, tally, balanceWei });
}

const attemptSchema = z.object({
  attackId: z.string().min(1),
  // Any string. Validated as an address only so `encodeFunctionData` has
  // something it can encode — never as a check on *which* address it is.
  destination: z.string().min(1)
});

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return Response.json(
      { error: "Too many attempts from this address in the last minute. The lock is unaffected." },
      { status: 429 }
    );
  }

  const parsed = attemptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "attackId and destination are required" }, { status: 400 });
  }

  const attack = findAttack(parsed.data.attackId);
  if (!attack) return Response.json({ error: "unknown attack" }, { status: 400 });

  const destination = parsed.data.destination.trim();
  if (!isAddress(destination, { strict: false })) {
    // Not a policy decision — calldata simply cannot be built from a non-address.
    return Response.json({ error: `"${destination}" is not an EVM address` }, { status: 400 });
  }

  const wallet: SimulatorWallet = {
    walletId: sandbox.account.walletId,
    address: sandbox.account.address,
    usdcAddress: sandbox.usdcAddress,
    permittedPayee: sandbox.permittedPayee,
    chainId: sandbox.chainId,
    rpcUrl: rpcUrl(),
    authorizationPrivateKeys: [need("SIMULATOR_AUTHORIZATION_KEY")]
  };

  const privy = new PrivyClient({
    appId: need("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: need("PRIVY_APP_SECRET")
  });

  const result = await attemptAttack(privy, wallet, attack, destination);
  const policyViolation =
    result.outcome === "REFUSED" &&
    JSON.stringify(result.rawError).toLowerCase().includes("policy_violation");

  tally.attempts += 1;
  if (result.outcome === "REFUSED") tally.refusals += 1;
  else tally.allowed += 1;
  tally.recent.unshift({
    at: new Date().toISOString(),
    attackId: attack.id,
    label: attack.label,
    expect: attack.expect,
    destination,
    outcome: result.outcome,
    policyViolation
  });
  tally.recent = tally.recent.slice(0, 25);

  return Response.json({
    attack: {
      id: attack.id,
      label: attack.label,
      expect: attack.expect,
      stoppedBy: attack.stoppedBy
    },
    destination,
    policyViolation,
    tally,
    ...result
  });
}
