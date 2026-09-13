/**
 * The operator seat's session.
 *
 * One auth system, not two: the browser already holds a Privy session (the
 * same `@privy-io/react-auth` provider the beneficiary flow uses), so the
 * operator dashboard sends that session's access token as a bearer and the
 * server verifies it against Privy's published signing keys.
 *
 * ---------------------------------------------------------------------------
 * SPEC DIVERGENCE — privy-docs vs. @privy-io/node@0.34.0
 *
 * privy-docs (/authentication/user-authentication/access-tokens) documents
 *   `privy.utils().auth().verifyAccessToken({ access_token })`
 * and says the verification key is fetched for you. Neither is true of the
 * installed SDK:
 *
 *   - `verifyAccessToken` is a **standalone export** of `@privy-io/node`, not
 *     a method on `PrivyClient`. There is no `utils().auth()` on the client.
 *   - `verification_key` is **required**, not optional, and typed
 *     `CryptoKey | JWTVerifyGetKey | string`.
 *   - the response is snake_case (`user_id`, `app_id`, `session_id`,
 *     `issued_at`), not the camelCase the docs table lists.
 *
 * The SDK ships a `createPrivyAppJWKS` helper that would do the fetching, but
 * it is not re-exported from the package index and the package declares no
 * deep export path for it — and `jose`, the documented alternative, is a
 * transitive dependency that does not resolve from this app.
 *
 * So the key is fetched here from Privy's JWKS endpoint and converted to SPKI
 * with `node:crypto` — two stdlib calls, no new dependency. The actual token
 * validation (signature, issuer, audience, expiry) is still Privy's own code:
 * this module only hands it the right key.
 * ---------------------------------------------------------------------------
 *
 * What this session is and is not, stated plainly because it matters:
 *
 *   It proves a person completed a Privy login. It is **not** what makes any
 *   operation on this dashboard safe. Where money may go is fixed by each
 *   account's Privy policy, evaluated in an enclave; widening a lock or
 *   publishing a mandate needs the business's key quorum. A forged session
 *   here buys an attacker a view and the ability to *ask*; it buys no
 *   signature (CLAUDE.md invariants 1 and 3).
 */
import { createPublicKey } from "node:crypto";
import { verifyAccessToken } from "@privy-io/node";

export interface OperatorSession {
  userId: string;
  appId: string;
  sessionId: string;
  expiration: number;
}

const JWKS_URL = (appId: string): string => `https://api.privy.io/v1/apps/${appId}/jwks.json`;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

let jwksCache: { appId: string; keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function jwks(appId: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache?.appId === appId && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL(appId), { headers: { "privy-app-id": appId } });
  if (!res.ok) throw new Error(`Privy JWKS fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { appId, keys, fetchedAt: Date.now() };
  return keys;
}

/** The `kid` from a JWT's header, so the right key out of several is used. */
function kidOf(token: string): string | null {
  const [header] = token.split(".");
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { kid?: string };
    return parsed.kid ?? null;
  } catch {
    return null;
  }
}

/** JWK -> SPKI PEM, which is the string form `verifyAccessToken` accepts. */
function toSpki(jwk: Jwk): string {
  return createPublicKey({ key: jwk as never, format: "jwk" })
    .export({ type: "spki", format: "pem" })
    .toString();
}

async function verificationKey(appId: string, token: string): Promise<string> {
  const kid = kidOf(token);
  const pick = (keys: Jwk[]): Jwk | undefined =>
    (kid ? keys.find((k) => k.kid === kid) : undefined) ??
    (kid ? undefined : keys.find((k) => k.alg === "ES256" && k.use === "sig"));

  let key = pick(await jwks(appId));
  // Privy rotates. An unseen `kid` is a reason to refetch once, not to refuse.
  if (!key) key = pick(await jwks(appId, true));
  if (!key) throw new Error(`no Privy signing key matches kid ${kid ?? "(none)"}`);
  return toSpki(key);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** `null` when there is no usable token; throws only on misconfiguration. */
export async function readSession(request: Request): Promise<OperatorSession | null> {
  const token = bearer(request);
  if (!token) return null;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");

  // An env-supplied key from the Privy dashboard skips the JWKS fetch.
  const override = process.env.PRIVY_VERIFICATION_KEY;

  try {
    const claims = await verifyAccessToken({
      access_token: token,
      app_id: appId,
      verification_key: override ?? (await verificationKey(appId, token))
    });
    return {
      userId: claims.user_id,
      appId: claims.app_id,
      sessionId: claims.session_id,
      expiration: claims.expiration
    };
  } catch {
    // An expired or forged token is not an error worth surfacing in detail —
    // it is simply not a session.
    return null;
  }
}

const UNAUTHENTICATED = {
  error: "not_signed_in",
  detail:
    "This endpoint needs a signed-in operator. Sign in from /operator; the dashboard sends your Privy access token as a bearer."
};

/**
 * Wraps a handler so it only runs with a verified session. The 401 body says
 * what is missing rather than just refusing.
 */
export function withOperator<T>(
  handler: (request: Request, session: OperatorSession) => Promise<T>
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let session: OperatorSession | null;
    try {
      session = await readSession(request);
    } catch (error) {
      return Response.json(
        {
          error: "privy_not_configured",
          detail: error instanceof Error ? error.message : String(error)
        },
        { status: 503 }
      );
    }
    if (!session) return Response.json(UNAUTHENTICATED, { status: 401 });
    try {
      const body = await handler(request, session);
      return Response.json(body, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 502 }
      );
    }
  };
}

/** `bigint` has no JSON form. Base units cross the wire as decimal strings. */
export const jsonSafe = <T,>(value: T): unknown =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
