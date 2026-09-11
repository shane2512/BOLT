import { z } from "zod";

/**
 * FR-5.3 / FR-8.6 / FR-8.7 — World Selfie Check (Beta), server side.
 *
 * BOLT's second gate. Privy constrains *where* money can go; World constrains
 * *who* may start it moving (CLAUDE.md invariant 7). This module is the half
 * that must run on a server: a client can return any JSON it likes, so the only
 * thing that makes a proof mean anything is forwarding it, unmodified, to
 * World's verifier and believing that answer instead of the browser's.
 *
 * Worked from world-docs:
 *   /world-id/idkit/integrate.mdx            — steps 3–6, the whole RP flow
 *   /world-id/idkit/credentials.mdx          — `selfieCheckLegacy()`, World ID 3.0
 *   /world-id/credentials/11.mdx             — what Selfie Check attests, 90-day window
 *   /api-reference/developer-portal/verify   — POST /api/v4/verify/{rp_id}, request + response
 *   /world-id/sandbox/sandbox-access.mdx     — environment: "sandbox"
 *   /world-id/SKILL                          — "forward the proof as-is"; nullifier storage
 *
 * Two rules from those pages that are easy to get wrong and are load-bearing here:
 *
 *  1. **Forward the IDKit result verbatim.** No remapping, no re-encoding, no
 *     hand-built `verification_level`. Selfie Check returns
 *     `responses[].identifier: "selfie"`; `"face"` is only a backward-compatible
 *     alias. `verifySelfieCheck` therefore takes the parsed-but-unaltered result
 *     and posts exactly that object.
 *  2. **The nullifier is the proof reference.** It is per-(RP, action), non-
 *     reversible, and it is the only anti-replay mechanism. It is what FR-5.3
 *     records with the approval and shows publicly.
 */

export const WORLD_VERIFY_BASE_URL = "https://developer.world.org/api/v4/verify";

/** The two identifiers World accepts for a Selfie Check response. */
export const SELFIE_CHECK_IDENTIFIERS = ["selfie", "face"] as const;

/**
 * The IDKit result, validated only as far as BOLT needs to route it — the rest
 * passes through untouched (`passthrough`) because the verifier, not us, is the
 * thing that reads it. `unknown`-typed proof fields are deliberate: re-typing
 * them would invite re-encoding them.
 */
export const idkitResultSchema = z
  .object({
    protocol_version: z.string(),
    action: z.string().optional(),
    session_id: z.string().optional(),
    nonce: z.string(),
    responses: z
      .array(z.object({ identifier: z.string() }).passthrough())
      .min(1)
  })
  .passthrough();

export type IdkitResult = z.infer<typeof idkitResultSchema>;

/** POST /api/v4/verify/{rp_id} — 200 shape. */
const verifySuccessSchema = z
  .object({
    success: z.literal(true),
    results: z.array(
      z
        .object({
          identifier: z.string().optional(),
          success: z.boolean().optional(),
          nullifier: z.string().optional(),
          code: z.string().optional(),
          detail: z.string().optional()
        })
        .passthrough()
    ),
    action: z.string().optional(),
    nullifier: z.string().optional(),
    created_at: z.string().optional(),
    environment: z.string().optional(),
    session_id: z.string().optional(),
    message: z.string().optional()
  })
  .passthrough();

/** POST /api/v4/verify/{rp_id} — 400/404 shape. */
const verifyFailureSchema = z
  .object({
    success: z.literal(false),
    code: z.string(),
    detail: z.string(),
    results: z.array(z.object({}).passthrough()).optional()
  })
  .passthrough();

/**
 * A refused or unverifiable Selfie Check. Carries World's raw response body so
 * a refusal is evidence, exactly as a Privy policy refusal is (house convention:
 * preserve raw errors verbatim, never prettify).
 */
export class SelfieCheckError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "SelfieCheckError";
  }
}

export interface SelfieCheckVerification {
  /** The proof reference. Per-(RP, action), non-reversible, safe to publish. */
  nullifier: string;
  /** "selfie", or "face" for the legacy alias. */
  identifier: string;
  action: string;
  environment: string | null;
  verifiedAt: string | null;
  /** World's response body, unmodified. Stored with the approval as evidence. */
  raw: unknown;
}

export interface SelfieCheckConfig {
  /** `rp_...` from the Developer Portal. Also accepts `app_...` for legacy apps. */
  rpId: string;
  /** The action the proof must be scoped to, e.g. "bolt-unlock-approval". */
  action: string;
  /**
   * `hashSignal(signal)` for the signal this proof was supposed to be bound to —
   * for an unlock approval, the unlock's id. world-docs
   * (/world-id/idkit/integrate step 4) says the backend must enforce the same
   * signal it asked for; the proof carries only `signal_hash`, so the caller
   * passes the expected hash and this function compares it.
   *
   * Computed with `hashSignal` from `@worldcoin/idkit-core/hashing` — passed in
   * rather than computed here so `@bolt/core` keeps no World SDK dependency.
   * Omitted only where the request carried no signal.
   */
  expectedSignalHash?: string;
  /** Overridable for tests; defaults to World's production verifier. */
  verifyBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Verifies one Selfie Check proof with World and returns its nullifier.
 *
 * Throws `SelfieCheckError` on anything short of a verified Selfie Check. It
 * never returns a "probably fine" — an approval that cannot show a nullifier
 * does not count toward the quorum (FR-5.3), and the only way to be sure of that
 * is for this function to have no soft-fail path.
 */
export async function verifySelfieCheck(
  cfg: SelfieCheckConfig,
  idkitResult: unknown
): Promise<SelfieCheckVerification> {
  const parsed = idkitResultSchema.safeParse(idkitResult);
  if (!parsed.success) {
    throw new SelfieCheckError(
      "world: payload is not an IDKit result",
      0,
      parsed.error.issues
    );
  }
  const result = parsed.data;

  // The action scopes the nullifier. A proof minted for some other action of
  // ours must not be replayable as an unlock approval, so this is checked before
  // the round trip rather than trusted from the response.
  if (result.action !== undefined && result.action !== cfg.action) {
    throw new SelfieCheckError(
      `world: proof is scoped to action "${result.action}", expected "${cfg.action}"`,
      0,
      result
    );
  }

  // The signal binds the proof to the specific thing being approved. Without
  // this check a proof minted for one unlock could be presented for another —
  // three genuine Selfie Checks, all for the wrong unlock.
  if (cfg.expectedSignalHash !== undefined) {
    const actual = (result.responses[0] as { signal_hash?: unknown }).signal_hash;
    if (typeof actual !== "string" || !equalsHex(actual, cfg.expectedSignalHash)) {
      throw new SelfieCheckError(
        `world: proof is bound to signal_hash ${String(actual)}, expected ${cfg.expectedSignalHash}`,
        0,
        result
      );
    }
  }

  const doFetch = cfg.fetchImpl ?? fetch;
  const url = `${cfg.verifyBaseUrl ?? WORLD_VERIFY_BASE_URL}/${cfg.rpId}`;

  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Verbatim. world-docs is explicit: do not mutate, re-encode or trim the
    // proof JSON before forwarding.
    body: JSON.stringify(idkitResult)
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = verifyFailureSchema.safeParse(body);
    throw new SelfieCheckError(
      failure.success
        ? `world: verification failed (${failure.data.code}): ${failure.data.detail}`
        : `world: verification failed with HTTP ${response.status}`,
      response.status,
      body
    );
  }

  const ok = verifySuccessSchema.safeParse(body);
  if (!ok.success) {
    throw new SelfieCheckError("world: unrecognised verify response", response.status, body);
  }

  const selfie = ok.data.results.find(
    (r) =>
      r.success !== false &&
      r.identifier !== undefined &&
      (SELFIE_CHECK_IDENTIFIERS as readonly string[]).includes(r.identifier)
  );
  if (!selfie) {
    // A verified proof of something else — an Orb proof, say — is not a Selfie
    // Check, and FR-5.3 asks for a Selfie Check specifically.
    throw new SelfieCheckError(
      "world: no verified Selfie Check credential in the response",
      response.status,
      body
    );
  }

  const nullifier = selfie.nullifier ?? ok.data.nullifier;
  if (!nullifier) {
    throw new SelfieCheckError("world: verified but no nullifier returned", response.status, body);
  }

  return {
    nullifier,
    identifier: selfie.identifier as string,
    action: ok.data.action ?? cfg.action,
    environment: ok.data.environment ?? null,
    verifiedAt: ok.data.created_at ?? null,
    raw: body
  };
}

/**
 * Nullifiers are 256-bit field elements. World's own guidance is to store them
 * as decimal (`NUMERIC(78, 0)` in Postgres) so that `0x0a…` and `0xA…` can never
 * be mistaken for two different people.
 */
/** 256-bit hex values compared by value, so 0x0a and 0xA are one thing. */
function equalsHex(a: string, b: string): boolean {
  try {
    return BigInt(a.startsWith("0x") ? a : `0x${a}`) === BigInt(b.startsWith("0x") ? b : `0x${b}`);
  } catch {
    return false;
  }
}

export function nullifierToDecimal(nullifier: string): string {
  const hex = nullifier.startsWith("0x") ? nullifier.slice(2) : nullifier;
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    throw new Error(`nullifierToDecimal: not a 256-bit hex value: ${nullifier}`);
  }
  return BigInt(`0x${hex}`).toString(10);
}
