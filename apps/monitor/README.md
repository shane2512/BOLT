# BOLT Solvency Monitor

The agent that reads BOLT's public record and says what it means.

Its only data source is the deployed subgraph (FR-7.1). There is no RPC read, no
Postgres read, no cached snapshot, no configured baseline and no constant
standing in for a figure. Everything it concludes, it concludes from indexed
`BoltRegistry` events and on-chain USDC balances — the same public index anyone
else can query. Every finding carries the block numbers and transaction hashes it
was drawn from, so its conclusions are checkable rather than merely stated.

---

## What it looks for

### 1. Mandate drift — the compromised-backend detector (FR-7.3)

The most important thing in this app.

A BOLT policy constrains **where** money may go. It says nothing about **how
much**. If the splitter is compromised or simply wrong and starts paying 83% to
client money instead of 88%, every transfer it makes still lands in one of the
business's own accounts — so the Privy session-signer policy permits all of them,
correctly. And because the splitter accrues an obligation equal to what it
actually paid, `held` still equals `owed` and the coverage line never dips.

Nothing else in BOLT can see this. The Monitor can.

For each mandate version, it takes the allocation the **first** deposit under
that version produced and treats it as the baseline, then compares every later
deposit against it by exact bigint cross-multiplication (`split · baselineAmount`
against `baselineSplit · amount`), so deposits of different sizes compare
correctly and no float touches a money figure. The tolerance is one base unit —
the most the cumulative-basis-point allocation in `packages/core/src/mandate.ts`
can differ by.

The baseline is the first deposit rather than a ratio table because the published
ratios live in Postgres, and Postgres is exactly what a compromised backend
controls. The chain carries the mandate's `rulesHash`, not the ratios themselves.
What the index *does* carry, immutably, is what the splitter did the first time
it ran under a quorum-ratified version — and no attacker who takes the backend
today can make yesterday's indexed history agree with them.

Two related checks fall out of the same query:

- **`UNRATIFIED_MANDATE`** — deposits claim a `mandateVersion` for which no
  `MandatePublished` event exists. FR-4.2 requires a key quorum to publish a
  mandate; a version the chain has never seen is a version no quorum ratified.
  (This fired for real on `acme-marketplace`: Phase 3 wrote mandate v1 to
  Postgres but never emitted the event. See
  `docs/evidence/phase7-findings-before.json`.)
- **`UNALLOCATED_DEPOSIT`** — the `SplitExecuted` events indexed against a
  deposit do not add up to the deposit (FR-3.8), according to the chain rather
  than the splitter's own report.

### 2. Shortfall forecast (FR-7.2)

Days of cover remaining per account class, projected from the flows the index
recorded. The quantity that matters is `surplus` (held − owed), because a class
draining held while shedding owed at the same rate is no worse off. A class whose
surplus is flat or rising has no depletion date and the Monitor says so rather
than inventing a large number. Severity: under 7 days severe, under 30 warning.

### 3. Unlock anomalies (FR-7.4)

Against this business's own history only — there is no cross-business norm and no
configured threshold.

- **size** — an unlock more than three standard deviations above the mean of
  every unlock that preceded it.
- **frequency** — an unlock arriving in under a quarter of the median gap between
  the unlocks before it, once there are enough gaps to take a median of.
- **exceeds held** — unexecuted unlocks against an account totalling more than it
  holds. Arithmetic, not statistics, and reported once per account rather than
  once per request.

### 4. Natural language (FR-7.5, FR-7.7)

`GET /ask?business=<slug>&q=<question>`.

*"Was this business ever short in August?"* is not a question a GraphQL query
answers: shortfall is a property of a `CoverageSnapshot`, snapshots carry unix
timestamps rather than months, "ever" means every class at every block, and the
honest answer when the index only reaches back to September is "your window
predates the data", not "no".

So the endpoint assembles an evidence bundle from the subgraph — the whole
coverage history, every deposit with its realized ratios, every mandate, every
unlock with its World Selfie Check proof references, and the findings above — and
asks an LLM (via OpenRouter, model `nvidia/nemotron-3-ultra-550b-a55b:free` by
default) to reason over it. The model is told that anything not in the bundle
does not exist, that every factual claim must cite the block number it came from,
and that it must never claim regulatory compliance. FR-7.7 is explicit that
printing raw query results does not satisfy this requirement.

---

## Running it

Requires `SUBGRAPH_URL` in the repo root `.env` — the deployed Subgraph Studio
query endpoint. Everything else is optional.

```bash
pnpm install

pnpm monitor:dev     # loop + HTTP on :4000
pnpm monitor:once    # one pass per business, printed, written to docs/evidence/
```

| Variable | Default | |
|---|---|---|
| `SUBGRAPH_URL` | — | **required.** The Monitor has no other data source. |
| `OPENROUTER_API_KEY` | — | Required only by `/ask` (OpenRouter's OpenAI-compatible endpoint, swapped from Anthropic). Without it every other route works and `/ask` returns 503 **with the fully-assembled evidence bundle**, so the gap is visible rather than papered over. |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b:free` | Which OpenRouter model answers `/ask`. |
| `MONITOR_BUSINESSES` | `acme-marketplace,bolt-unlock-demo` | Comma-separated slugs to watch. |
| `MONITOR_PORT` | `4000` | |
| `MONITOR_INTERVAL_MS` | `60000` | |
| `DATABASE_URL` | — | Optional. Alerts are written to the `alerts` table when Postgres is reachable; when it is not, the pass still completes and findings are still served. |

### HTTP

```
GET  /health
GET  /findings?business=<slug>
GET  /ask?business=<slug>&q=<question>
POST /ask   {"business": "...", "question": "..."}
```

```bash
curl -sG http://localhost:4000/ask \
  --data-urlencode business=acme-marketplace \
  --data-urlencode 'q=has this business ever been short, and are the splits following the mandate?'
```

`/findings` and `/ask` accept any indexed slug and any question — nothing is
hard-coded per business or per query. Unknown slugs return 404 rather than an
empty answer.

---

## Proving the drift detector works

```bash
pnpm --filter @bolt/monitor drift-demo
```

This is a **live** run against Arc testnet, not a fixture. It:

1. publishes mandate v1 on chain (`MandatePublished`), closing the gap the
   Monitor itself found;
2. runs one deposit through the real splitter at the mandate's ratios
   (8800 / 400 / 800 bps), confirming the baseline;
3. runs two more at **8300 / 400 / 1300** — five percent of every deposit
   diverted out of client money into the business's own operating account —
   while still recording, and still emitting `DepositObserved` for, mandate
   version 1;
4. waits for the subgraph to index it and runs the Monitor.

Every transfer is signed by the real Privy session signer, and every one of them
is **permitted** by the enclave, because they all target the business's own
accounts. That is the point: the lock cannot see this class of failure, and the
coverage line cannot either. Only the ratio comparison finds it.

Evidence lands in `docs/evidence/phase7-drift-detected.json`. The run is
resumable and idempotent on the funding transactions
(`docs/evidence/phase7-drift-state.json`).

> It really does move money on testnet and it really does write permanent
> history: the misconfigured deposits stay in the index and the drift finding
> stays on `acme-marketplace`'s public page. That is deliberate — an incident
> that can be quietly deleted afterwards is not much of a demonstration.

---

## Where the code is

| | |
|---|---|
| `packages/core/src/monitor.ts` | Every check, as pure functions. No I/O. |
| `packages/core/src/subgraph-client.ts` | The only way data enters the Monitor. |
| `apps/monitor/src/snapshot.ts` | Loads the snapshot; shapes the evidence bundle. |
| `apps/monitor/src/nl.ts` | The reasoning step. |
| `apps/monitor/src/index.ts` | The loop, the alerts, the HTTP surface. |
| `packages/core/src/__tests__/monitor.test.ts` | `pnpm test` — pins the drift arithmetic. |

The checks live in `packages/core` rather than in this app for one reason: the
public `/[slug]` page must show the same findings, and it calls `runChecks`
against the same subgraph rather than reading rows the Monitor wrote to Postgres.
One implementation, three callers, and no figure on the public page that exists
only in our database (CLAUDE.md invariant 8).
