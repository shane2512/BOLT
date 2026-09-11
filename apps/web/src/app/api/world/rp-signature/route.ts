/**
 * FR-5.3, step 3 of the IDKit flow — sign the proof request.
 *
 * The RP signing key authenticates BOLT to the World protocol. A leaked key lets
 * anyone forge proof requests that look like ours, which in this product means
 * forging the *human* half of an unlock approval. So it is read here, on the
 * server, from `WORLD_RP_SIGNING_KEY` and never crosses to the client — the
 * client gets only the signature, nonce and window.
 *
 * Worked from world-docs /world-id/idkit/integrate.mdx step 3, and
 * /world-id/idkit/signatures for what the signature covers.
 */
import { signRequest } from "@worldcoin/idkit-core/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const need = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    // Deliberately explicit: this is the exact blocker Phase 6 stops on, and a
    // vague 500 would waste someone's afternoon.
    throw new Error(
      `${key} is not set. Create the app, RP and action in the World Developer ` +
        `Portal (https://developer.world.org) and set WORLD_APP_ID, WORLD_RP_ID, ` +
        `WORLD_RP_SIGNING_KEY and WORLD_ACTION_ID.`
    );
  }
  return value;
};

/**
 * BOLT's two World actions, and why they are two.
 *
 * The nullifier is scoped to (RP, action) — world-docs /world-id/concepts,
 * /world-id/idkit/integrate step 6 — so an action is a *purpose*, not an app
 * constant. Sharing one between the unlock quorum and a beneficiary claim would
 * put an approver's nullifier and a seller's in the same scope, and BOLT's
 * "one human, one approval" reasoning reads off exactly that scoping.
 *
 * Proven live to need no Developer Portal step: the sandbox bridge holds a
 * request for either action with the same app, RP and signing key
 * (docs/evidence/phase8-world-action-probe.json).
 */
const ACTIONS = {
  // FR-5.3 — abuse prevention, on every unlock approval.
  "unlock-approval": () => need("WORLD_ACTION_ID"),
  // FR-8.6 / FR-8.7 — eligibility on first claim, continuity on address change.
  "beneficiary-claim": () => process.env.WORLD_BENEFICIARY_ACTION_ID ?? "bolt-beneficiary-claim"
} as const;

type Purpose = keyof typeof ACTIONS;

export async function POST(request: Request): Promise<Response> {
  // The *purpose* may be chosen by the caller; the action string it maps to may
  // not. A caller who could name the action outright could ask for a proof
  // scoped to something cheaper and present it as an unlock approval.
  const body = (await request.json().catch(() => null)) as { purpose?: string } | null;
  const purpose = (body?.purpose ?? "unlock-approval") as Purpose;
  if (!(purpose in ACTIONS)) {
    return Response.json(
      { error: `unknown purpose "${purpose}" — one of ${Object.keys(ACTIONS).join(", ")}` },
      { status: 400 }
    );
  }
  const action = ACTIONS[purpose]();

  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: need("WORLD_RP_SIGNING_KEY"),
      action
    });
    return Response.json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      rp_id: need("WORLD_RP_ID"),
      app_id: need("WORLD_APP_ID"),
      action,
      environment: process.env.WORLD_ENVIRONMENT ?? "sandbox"
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 503 });
  }
}
