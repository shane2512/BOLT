/**
 * B6 — the split rule editor's validation.
 *
 * Runs the real `validateMandateRules` and `computeSplits` from
 * `@bolt/core` over a draft, so the editor's "this sums to 9 999" is the same
 * refusal that would stop the mandate reaching the database, and the preview
 * allocation is the exact arithmetic the splitter will perform on the signing
 * path — cumulative basis points, deterministic, no dust.
 *
 * It does not publish. Publishing a mandate is a key-quorum operation
 * (FR-4.2, invariant 3): the rules hash goes on chain under a quorum
 * reference, and a quorum's signatures cannot be produced by a web session.
 * The editor validates and previews; the quorum publishes.
 */
import { z } from "zod";
import { computeSplits, usdc, validateMandateRules } from "@bolt/core";
import { jsonSafe, withOperator } from "@/lib/operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const draftSchema = z.object({
  rules: z
    .array(
      z.object({
        destinationAccountId: z.string().min(1),
        label: z.string().optional(),
        bps: z.number().int().min(0).max(10_000)
      })
    )
    .max(20),
  // The deposit to preview the split against, in USDC base units.
  sampleAmount: z.string().regex(/^\d+$/).optional()
});

export const POST = withOperator(async (request) => {
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const rules = parsed.data.rules.map((r) => ({
    destinationAccountId: r.destinationAccountId,
    bps: r.bps
  }));
  const total = rules.reduce((sum, r) => sum + r.bps, 0);

  try {
    validateMandateRules(rules);
  } catch (error) {
    return {
      ok: false as const,
      totalBps: total,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const sample = usdc(BigInt(parsed.data.sampleAmount ?? "1000000"));
  const allocations = computeSplits(sample, rules);

  return jsonSafe({
    ok: true as const,
    totalBps: total,
    sampleAmount: sample,
    allocations,
    note: "This is the allocation `computeSplits` will produce for that deposit under these rules, unit for unit — the same function runs on the signing path."
  });
});
