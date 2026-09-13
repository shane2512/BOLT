/**
 * FR-7.5 / FR-7.7 — the web app's door to the Solvency Monitor's `/ask`.
 *
 * A proxy, deliberately. The reasoning step, the evidence bundle and the rule
 * that an answer must cite block numbers all live in `apps/monitor`
 * (`src/nl.ts`, `src/snapshot.ts`). Re-implementing any of that here would give
 * the public page a second, quietly diverging answer path — which is precisely
 * the failure mode the Monitor exists to make impossible.
 *
 * The Monitor is a separate process (`pnpm monitor:dev`, port 4000 by default).
 * If it is not running this route says exactly that, with the command to start
 * it, rather than inventing an answer or pretending the question failed.
 *
 * A 503 from the Monitor is not an error to swallow: when `OPENROUTER_API_KEY`
 * is unset it returns the full evidence bundle with a 503, so the reader can
 * draw the conclusion the model would have drawn. That body is passed through
 * untouched.
 */
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const monitorUrl = (): string => process.env.MONITOR_URL ?? "http://localhost:4000";

const askSchema = z.object({
  business: z.string().min(1),
  question: z.string().min(1).max(500)
});

export async function POST(request: Request): Promise<Response> {
  const parsed = askSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "business and question are required" }, { status: 400 });
  }

  const base = monitorUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
      // The reasoning step is a model call over a large bundle. Two minutes is
      // generous rather than optimistic; the page shows progress meanwhile.
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    return Response.json(
      {
        error: "monitor_unreachable",
        monitorUrl: base,
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 502 }
    );
  }

  // Verbatim pass-through, including the 503-with-bundle case.
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" }
  });
}
