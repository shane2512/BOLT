/**
 * FR-7 — the Solvency Monitor.
 *
 * An agent loop whose only data source is the deployed subgraph (FR-7.1), and a
 * public HTTP surface over what it finds (FR-7.5, FR-7.6).
 *
 * Every pass does the same three things: pull the business's whole indexed
 * history, run the four checks over it (`runChecks` in `@bolt/core`), and write
 * anything it concludes as an alert with severity and evidence. Severe findings
 * are surfaced on the public `/[slug]` page — which calls the same `runChecks`
 * against the same subgraph rather than reading the Monitor's output, so the
 * page never renders a number that exists only in our database (invariant 8).
 *
 *   pnpm monitor:dev                 loop + HTTP on :4000
 *   pnpm --filter @bolt/monitor once one pass, printed, written to docs/evidence
 *
 * See apps/monitor/README.md.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { Finding } from "@bolt/core";
import { analyse, BusinessNotIndexed } from "./snapshot.js";
import { ask, MissingApiKey } from "./nl.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO, ".env") });

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
if (!SUBGRAPH_URL) {
  console.error("SUBGRAPH_URL is not set. The Monitor has no other data source (FR-7.1).");
  process.exit(1);
}
const subgraphUrl: string = SUBGRAPH_URL;

const BUSINESSES = (process.env.MONITOR_BUSINESSES ?? "acme-marketplace,bolt-unlock-demo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.MONITOR_PORT ?? 4000);
const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS ?? 60_000);

const jsonify = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 1);

// ---------------------------------------------------------------------------
// Alerts (FR-7.6)
// ---------------------------------------------------------------------------

/**
 * Findings already written this process run, so a loop on a 60-second timer
 * raises one alert per finding rather than one per minute.
 *
 * ponytail: in-process. A restart can re-insert an alert that is still open,
 * because `alerts` has no unique key on the fingerprint. Add one (or a partial
 * unique index on `evidence->>'fingerprint' where resolved_at is null`) if the
 * Monitor is ever run as more than one process.
 */
const written = new Set<string>();
let warnedAboutDb = false;

/**
 * Writes findings to the `alerts` table. Best effort by design: Postgres holds
 * workflow state, not evidence, and the Monitor's conclusions are recomputable
 * from the index at any time by anyone. If the database is unreachable the pass
 * still completes, still serves over HTTP, and says so once.
 */
async function persistAlerts(slug: string, findings: Finding[]): Promise<number> {
  const fresh = findings.filter((f) => f.severity !== "INFO" && !written.has(f.fingerprint));
  if (fresh.length === 0) return 0;

  try {
    const { createDb, alerts, businesses } = await import("@bolt/db");
    const { eq } = await import("drizzle-orm");
    const db = createDb();
    const [row] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, slug));
    if (!row) return 0;

    await db.insert(alerts).values(
      fresh.map((f) => ({
        businessId: row.id,
        severity: f.severity,
        kind: f.kind,
        message: f.message,
        evidence: { ...f.evidence, fingerprint: f.fingerprint, title: f.title } as object
      }))
    );
    for (const f of fresh) written.add(f.fingerprint);
    return fresh.length;
  } catch (error) {
    if (!warnedAboutDb) {
      warnedAboutDb = true;
      console.warn(
        `  ! alerts not persisted (${(error as Error).message || String(error)}). Findings are still served on ` +
          `/findings and recomputed live by the public page — nothing is lost.`
      );
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

const SEVERITY_MARK: Record<Finding["severity"], string> = {
  SEVERE: "!!",
  WARNING: " !",
  INFO: "  "
};

async function pass(slug: string, opts: { verbose?: boolean } = {}): Promise<Finding[]> {
  const startedAt = Date.now();
  const { snapshot, findings } = await analyse(subgraphUrl, slug);
  const severe = findings.filter((f) => f.severity === "SEVERE").length;
  const warning = findings.filter((f) => f.severity === "WARNING").length;

  console.log(
    `[${new Date().toISOString()}] ${slug} @ block ${snapshot.indexedAtBlock} — ` +
      `${snapshot.coverage.length} snapshots, ${snapshot.deposits.length} deposits, ` +
      `${snapshot.unlocks.length} unlocks → ${severe} severe, ${warning} warning, ` +
      `${findings.length - severe - warning} info (${Date.now() - startedAt}ms)`
  );
  for (const f of findings) {
    if (!opts.verbose && f.severity === "INFO") continue;
    console.log(`  ${SEVERITY_MARK[f.severity]} [${f.kind}] ${f.title}`);
    if (opts.verbose) console.log(`       ${f.message.replace(/\s+/g, " ")}`);
  }

  const persisted = await persistAlerts(slug, findings);
  if (persisted > 0) console.log(`  -> ${persisted} alert(s) written to Postgres`);

  return findings;
}

// ---------------------------------------------------------------------------
// HTTP (FR-7.5 — publicly reachable)
// ---------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json") {
  const payload = contentType === "application/json" ? jsonify(body) : String(body);
  res.writeHead(status, {
    "content-type": `${contentType}; charset=utf-8`,
    // The public page and any reader may call this from a browser. Everything
    // served here is already public: it is derived from a public index.
    "access-control-allow-origin": "*"
  });
  res.end(payload);
}

const USAGE = `BOLT Solvency Monitor (FR-7)

Reads only the deployed subgraph. Every figure traces to an indexed BoltRegistry
event or an on-chain USDC balance.

  GET /health
  GET /findings?business=<slug>
  GET /ask?business=<slug>&q=<question>
  POST /ask  {"business":"<slug>","question":"..."}

Businesses: ${BUSINESSES.join(", ")}

Example:
  curl -sG http://localhost:${PORT}/ask \\
    --data-urlencode business=acme-marketplace \\
    --data-urlencode 'q=has this business ever been short, and are the splits following the mandate?'
`;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }

  if (url.pathname === "/" || url.pathname === "/usage") {
    send(res, 200, USAGE, "text/plain");
    return;
  }

  if (url.pathname === "/health") {
    try {
      const { snapshot } = await analyse(subgraphUrl, BUSINESSES[0]!);
      send(res, 200, {
        ok: true,
        subgraphUrl,
        indexedAtBlock: snapshot.indexedAtBlock.toString(),
        businesses: BUSINESSES,
        naturalLanguage: Boolean(process.env.OPENROUTER_API_KEY)
          ? "available"
          : "unavailable — OPENROUTER_API_KEY is not set"
      });
    } catch (error) {
      send(res, 503, { ok: false, error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/findings") {
    const slug = url.searchParams.get("business") ?? BUSINESSES[0]!;
    try {
      const { snapshot, findings } = await analyse(subgraphUrl, slug);
      send(res, 200, {
        business: slug,
        indexedAtBlock: snapshot.indexedAtBlock.toString(),
        counts: {
          severe: findings.filter((f) => f.severity === "SEVERE").length,
          warning: findings.filter((f) => f.severity === "WARNING").length,
          info: findings.filter((f) => f.severity === "INFO").length
        },
        findings
      });
    } catch (error) {
      send(res, error instanceof BusinessNotIndexed ? 404 : 502, {
        error: (error as Error).message
      });
    }
    return;
  }

  if (url.pathname === "/ask") {
    let slug = url.searchParams.get("business") ?? BUSINESSES[0]!;
    let question = url.searchParams.get("q") ?? url.searchParams.get("question") ?? "";

    if (req.method === "POST") {
      const raw = await new Promise<string>((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
        req.on("error", reject);
      });
      try {
        const parsed = JSON.parse(raw) as { business?: string; question?: string; q?: string };
        slug = parsed.business ?? slug;
        question = parsed.question ?? parsed.q ?? question;
      } catch {
        send(res, 400, { error: "POST body must be JSON" });
        return;
      }
    }

    if (!question.trim()) {
      send(res, 400, { error: "no question given — pass ?q=... or POST {\"question\": \"...\"}" });
      return;
    }

    let bundle: unknown;
    let indexedAtBlock: string;
    try {
      const analysed = await analyse(subgraphUrl, slug);
      bundle = analysed.bundle;
      indexedAtBlock = analysed.snapshot.indexedAtBlock.toString();
    } catch (error) {
      send(res, error instanceof BusinessNotIndexed ? 404 : 502, {
        error: (error as Error).message
      });
      return;
    }

    try {
      const answer = await ask(bundle, question);
      send(res, 200, { business: slug, question, indexedAtBlock, ...answer });
    } catch (error) {
      if (error instanceof MissingApiKey) {
        // The query-gathering half is complete and is returned in full. Only the
        // reasoning step is missing, and we say exactly that rather than
        // returning a templated sentence dressed up as an answer.
        send(res, 503, {
          error: error.message,
          business: slug,
          question,
          indexedAtBlock,
          bundle
        });
        return;
      }
      send(res, 502, { error: (error as Error).message, business: slug, question });
    }
    return;
  }

  send(res, 404, { error: `no route ${url.pathname}`, usage: USAGE.split("\n").slice(4, 9) });
}

// ---------------------------------------------------------------------------

const once = process.argv.includes("--once");
const verbose = once || process.argv.includes("--verbose");

if (once) {
  const evidenceDir = join(REPO, "docs", "evidence");
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });

  for (const slug of BUSINESSES) {
    try {
      const findings = await pass(slug, { verbose });
      const file = join(evidenceDir, `phase7-findings-${slug}.json`);
      writeFileSync(
        file,
        jsonify({
          note:
            "Solvency Monitor output (FR-7). Every finding below was computed from the " +
            "deployed subgraph alone — see each finding's evidence.source. Nothing here " +
            "reads Postgres, an RPC, or a local file.",
          subgraphUrl,
          business: slug,
          generatedAt: new Date().toISOString(),
          findings
        }) + "\n"
      );
      console.log(`  -> docs/evidence/phase7-findings-${slug}.json\n`);
    } catch (error) {
      console.error(`  x ${slug}: ${(error as Error).message}\n`);
    }
  }
  process.exit(0);
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error("unhandled:", error);
    send(res, 500, { error: String(error) });
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`BOLT Solvency Monitor listening on http://0.0.0.0:${PORT}`);
  console.log(`  subgraph : ${subgraphUrl}`);
  console.log(`  watching : ${BUSINESSES.join(", ")} every ${INTERVAL_MS / 1000}s`);
  console.log(
    `  ask      : ${process.env.OPENROUTER_API_KEY ? "enabled" : "DISABLED — OPENROUTER_API_KEY is not set"}\n`
  );
});

const runAll = async (): Promise<void> => {
  for (const slug of BUSINESSES) {
    try {
      await pass(slug, { verbose });
    } catch (error) {
      console.error(`  x ${slug}: ${(error as Error).message}`);
    }
  }
};

await runAll();
setInterval(() => void runAll(), INTERVAL_MS);
