# Build phases

Ten phases, 0 through 9, mapped onto an 11-day window. Each has a goal, tasks, and **exit criteria that are checkable** — not "done when it feels done".

**Rule: do not start phase N+1 until phase N's exit criteria are met.** The one exception is Phase 7, which may run in parallel with Phase 8 if two people are building.

---

## Phase 0 — Spike and go/no-go

**Day 1. Nothing else happens today.**

The entire product rests on one assumption: that a Privy policy can decode transaction calldata and constrain the recipient parameter inside it. If that assumption is wrong, BOLT does not work and we need to know in hour two, not on day six.

**Tasks**

- **Rule 0 first.** Query the `privy-docs` MCP for the policy condition grammar — the exact syntax for `ethereum_calldata` conditions, the exact parameter path for a decoded ERC-20 recipient, and what happens on refusal. Write down what it says before touching the dashboard. Every line below is checking whether the documentation is true.
- **Approve the `world-docs` MCP server today.** World is a submitted track and Phases 6 and 8 both depend on it. It is currently pending approval; discovering that on day 5 costs a track.
- Create the Privy app. Confirm on the dashboard that **policies, organization wallets, key quorums, session signers and pregenerated wallets are available on the self-serve tier**. If any require commercial onboarding, escalate immediately — it changes the plan.
- Create one Privy wallet. Attach a policy permitting a USDC transfer to exactly **one decoded `transfer._to`** and denying everything else.
- Fund it with testnet USDC on Arc.
- Send to the permitted address. It should succeed.
- Now spend the rest of the day attacking it:
  - send to a different address → must be refused
  - send native value instead of a token transfer → refused
  - call `approve` on USDC, then `transferFrom` from another wallet → **if this drains the account, FR-2.8 becomes MUST and the policy needs extending today**
  - encode the transfer manually with unusual padding → still refused
  - try a multicall or batched contract that wraps the transfer → refused
- Capture every refusal with the **raw, unedited error body**. This is demo material and evidence; commit it to `docs/evidence/`.

**Exit criteria**

- [ ] A permitted transfer succeeds
- [ ] A transfer to any other address is refused, with the raw error saved
- [ ] The `approve` / `transferFrom` route is either refused or a written plan exists to close it
- [ ] Every Privy feature the plan depends on is confirmed available on our tier
- [ ] `world-docs` is approved and answering
- [ ] The policy grammar used came from the Privy docs MCP, and any divergence from `CLAUDE.md`'s example syntax is written down

**If exit criteria fail:** stop. Do not build around it. Escalate and rethink the concept — everything downstream assumes this works.

---

## Phase 1 — Foundation

**Day 1 evening → Day 2 morning.**

**Tasks**

- pnpm workspace: `apps/web`, `apps/monitor`, `packages/{core,privy,db}`, `contracts`, `subgraph`
- Next.js 15 + TypeScript strict + Tailwind. Drizzle + Postgres, schema from `REQUIREMENTS.md` §4
- `packages/core`: the `Usdc` branded bigint type, bps helpers, coverage math
- `contracts`: `BoltRegistry.sol` with the full event set. It custodies nothing. `recorder` role = the splitter's address
- Deploy to Arc testnet, verify, record the address
- `.env.example` complete; CI runs `pnpm test` and `hardhat test`

**Exit criteria**

- [ ] `pnpm dev`, `pnpm test`, `hardhat test` all pass on a clean clone
- [ ] `BoltRegistry` deployed to Arc testnet, address in `.env.example`
- [ ] A test emits and reads back one event of every type

---

## Phase 2 — Accounts and locks

**Day 2.**

**Tasks**

- Provision a business as a Privy organization with an org wallet tree
- Create the three account classes (FR-1.2). Class immutable
- **`packages/privy/policy-builder.ts`** — the most important file in the repo. It generates policies from an account spec and **throws if the output lacks a `transfer._to` condition** (FR-2.1)
- No account may exist in an unlocked state, even briefly (FR-1.3): policy attaches at creation
- Key quorum on policy changes and beneficiary-allowlist additions (FR-2.6). No dev-mode bypass
- `recordPolicyRefusal` — stores Privy's error verbatim (FR-2.4)
- Emit `AccountRegistered` and `PolicyRotated`

**Exit criteria**

- [ ] A business with three accounts exists; each locked account has a live policy
- [ ] Unit test: the policy builder **refuses** to emit a rule without `transfer._to`. This test must never be deleted
- [ ] A refused transfer is stored verbatim and readable from the DB
- [ ] Widening a policy without a quorum fails

---

## Phase 3 — Split on receipt

**Day 2 → Day 3.**

**Tasks**

- Privy deposit webhook, signature-verified, **idempotent on `(txHash, logIndex)`** (FR-3.2)
- Mandate engine in `packages/core`: rules → splits, bps summing to exactly 10000, asserted twice
- Splitter runs on a **session signer** whose own policy limits it to intra-business transfers (FR-3.3) — a compromised splitter cannot pay an outsider
- Record `mandateVersion` on each deposit at receipt time (FR-3.4)
- Emit `DepositObserved`, `SplitExecuted`, `ObligationAccrued`
- Failed or partial splits raise an alert and show as unallocated. Fail loudly (FR-3.8)

**Exit criteria**

- [ ] A testnet USDC deposit splits across three accounts in under 30 seconds
- [ ] Replaying the same webhook produces no second split
- [ ] Ratios not summing to 10000 are rejected at write time
- [ ] All three event types land on chain and are readable

---

## Phase 4 — Indexing

**Day 3. Do this early — five later features read from it, and an index built on day 9 is an index with no history in it.**

**Tasks**

- **There is no docs MCP for The Graph.** Before writing the manifest, the schema or any mapping, **stop and ask which documentation is needed**, naming precisely what you need to know. Everything downstream reads from this index, and a subgraph that silently indexes the wrong thing only reveals itself once there is enough history to notice.
- Subgraph schema: `Business`, `Account`, `Deposit`, `Split`, `Obligation`, `Unlock`, `Approval`, `CoverageSnapshot`
- Mappings for every `BoltRegistry` event
- `CoverageSnapshot` written whenever obligations or balances change — this is what draws the line in FR-6.4
- Also index USDC `Transfer` events to and from registered accounts, so *held* is chain-derived rather than reported
- Deploy to **Subgraph Studio**, generate a real API key
- Typed GraphQL client in `packages/core`

**Exit criteria**

- [ ] The documentation used was requested and supplied, not recalled
- [ ] Subgraph deployed to Studio and fully synced on Arc testnet
- [ ] A query returns coverage for a business at an arbitrary past block
- [ ] Phase 3's deposit appears in the index with its splits and obligations
- [ ] No mocked, static or local-only data anywhere in the read path

---

## Phase 5 — Public solvency page

**Day 4. Ship it correct and ugly. Style it in Phase 9.**

**Tasks**

- `/[slug]`, unauthenticated
- Owed vs held per class; current coverage ratio
- Every account address, linked to a block explorer (FR-6.3)
- **Coverage over time as a line**, from `CoverageSnapshot` (FR-6.4) — the single most important element on the page
- Unlock history with reasons and approvers (renders empty until Phase 6)
- Yield setting shown per account (FR-6.8)
- Beneficiary lookup by email (FR-6.7)

**Exit criteria**

- [ ] The page loads with no authentication
- [ ] **Every figure traces to an event or a balance.** Walk the page and name the source of each number; if any is Postgres-only, fix it
- [ ] The coverage line renders real indexed history, not a single point
- [ ] Clicking an address reaches a block explorer showing the same balance

---

## Phase 6 — Unlock ceremony

**Day 5.**

**Tasks**

- Request form: account, amount, destination, **free-text reason**. Hash on chain (FR-5.1)
- 3-of-5 approvals as Privy intents, approvable from a phone (FR-5.2)
- **World Selfie Check on every approver, before their approval counts** (FR-5.3). Query `world-docs` first. Sandbox-tested. The proof reference is recorded with the approval and shown publicly. This is the *abuse-prevention* signal — a stolen session or a script cannot stand in for a person at the one moment locked money legitimately moves
- 24-hour timer between final approval and executability (FR-5.4)
- Emit `UnlockRequested`, `UnlockApproved`, `UnlockExecuted`
- Unlock appears on the public page within 60 seconds
- **Start `docs/WORLD_FEEDBACK.md` today** (FR-12), while the friction is fresh. Sections (a) docs and integration flow and (b) Developer Portal are written now; (c) Sandbox states and (d) what was broken get topped up in Phase 8. Retrofitted feedback reads as retrofitted and is worthless to the sponsor

**Exit criteria**

- [ ] A full ceremony completes: reason → three phone approvals, each behind a Selfie Check → timer → execution
- [ ] An unlock with two approvals **cannot** execute, and the failure comes from the quorum, not from app code
- [ ] The completed unlock, its reason and its approvers appear publicly
- [ ] An approval without a completed Selfie Check does not count toward the quorum
- [ ] `WORLD_FEEDBACK.md` exists with sections (a) and (b) written

---

## Phase 7 — Solvency Monitor

**Day 6. May overlap Phase 8 if two people are building.**

**Tasks**

- `apps/monitor`: agent loop reading **only** the deployed subgraph (FR-7.1)
- **Shortfall forecast** — days of cover remaining per class from observed flows (FR-7.2)
- **Mandate drift** — actual splits vs active mandate, flag sustained divergence (FR-7.3). This is the compromised-backend detector; give it real attention
- **Anomaly detection** — unlock frequency or size outside this business's own baseline (FR-7.4)
- **Natural-language endpoint** — *"was this business ever short in August?"* answered with dates and block numbers (FR-7.5). Publicly reachable
- Alerts with severity and evidence; severe ones surface publicly (FR-7.6)
- `apps/monitor/README.md` so the agent can be run — no SKILL.md or separate film needed now that The Graph is implemented but not submitted
- The Monitor still earns its place: it is a demo beat, and it is the compromised-backend detector (FR-7.3)

**Exit criteria**

- [ ] All four capabilities demonstrably work against live indexed data
- [ ] Deliberately misconfigure the splitter → drift is detected and alerted
- [ ] The NL endpoint answers a question it was not hard-coded for, citing block numbers
- [ ] The Monitor is reachable and answers a question it was not hard-coded for

---

## Phase 8 — Beneficiary payout

**Day 7. Hold this day.** This is the second Privy prize on its own scorecard — Best financial flow rests entirely on it. Nothing below it in the cut order starts until it is finished.

**Tasks**

- **Pregenerated Privy wallet** bound to a beneficiary email — balance exists before they ever sign in (FR-8.1)
- Familiar login. No seed phrase, no gas, no chain picker, no bridge UI (FR-8.2)
- Payout from a locked account succeeds **inside** the policy — the beneficiary is a permitted destination, not an exception (FR-8.3)
- Emit `ObligationSettled`; outstanding obligations fall; coverage line updates
- **Selfie Check on first claim** (FR-8.6) — the *eligibility* signal, before any payout executes
- **Selfie Check on address change or an unrecognised device** (FR-8.7) — the *continuity* signal, and the anti-account-takeover control
- **No check on a repeat withdrawal to an already-verified address** (FR-8.8). Deliberate: Selfie Check is low-friction by design, and the Privy financial-flow bounty is judged on the flow staying smooth
- CCTP withdrawal to another chain, one button (FR-8.4)
- **Finish `docs/WORLD_FEEDBACK.md`** — sections (c) Sandbox states, proof flows, test users, errors and edge cases, and (d) what was confusing, missing, broken or hard to test
- **Arc App Kit** in the payment or treasury path. App Kits are a named Arc core product the plan otherwise never touches. If none fits, say so in one line in the Arc README rather than staying silent

**Exit criteria**

- [ ] A fresh email address receives a payout end to end without ever seeing a seed phrase
- [ ] The payout is policy-permitted — a payout to a *non*-beneficiary from the same account is still refused
- [ ] Obligations and the coverage line both update on the public page
- [ ] CCTP withdrawal lands on the destination chain
- [ ] A first claim without a Selfie Check does not pay out; a repeat withdrawal to a verified address needs no fresh check
- [ ] Changing the withdrawal address forces a fresh check
- [ ] `WORLD_FEEDBACK.md` complete — all four sections
- [ ] An App Kit is integrated, or its absence explained in one line

---

## Phase 9 — Harden, deploy, submit

**Days 8–11.**

**Day 8 — Mainnet and simulator**

- Arc **mainnet** deployment or deployment-ready state — **first confirm that track is still open**, since it is the largest line item after Privy
- `/simulator` public: full operator privileges over an isolated sandbox business, **raw enclave errors shown** (FR-9.2), running tally of failed thefts

**Day 9 — Stretch, in this order, and only if Phases 0–8 are genuinely finished**

1. Yield on obligation reserves (FR-11) — the business-model story
2. Auditor time travel and export (FR-10)
3. A generic solvency verifier that works for any address, not just our demo business

> Start none of this unless Phases 0–8 are genuinely finished. A half-built stretch is worth less than a rehearsed demo.

**Day 10 — Documentation and rehearsal**

- One README section per sponsor, written against their literal bullets, using the traceability table in `REQUIREMENTS.md` §5
- **Write the bounty statements.** Arc asks in writing: *"Please be clear what bounty you are submitting for."* One line at the top of each sponsor section
- **Check `docs/WORLD_FEEDBACK.md` is complete** — all four named sections. It is a qualification bullet, not a courtesy
- Describe The Graph honestly as implemented-not-submitted, so nobody reads it as an unclaimed prize attempt
- Architecture diagram in the repo
- Rehearse the judge-holds-the-keys moment until it takes 90 seconds and never fails

**Day 11 — Films only. No new integrations. Not one.**

- **One main video, under 5 minutes**, following the six demo beats — serves Privy, Arc and World. Make sure the Selfie Check moments are clearly visible in it: World asks to see a working app
- Repo hygiene, all links live

**Exit criteria**

- [ ] Deployed on Arc mainnet or demonstrably deployment-ready
- [ ] Simulator public and surviving attack
- [ ] A README section per sponsor, every claimed bullet true and unmocked
- [ ] Bounty statements written, Graph submission kind and pool declared
- [ ] Both videos recorded; demo rehearsed to time
- [ ] Every claim in the README verified against what actually shipped

---

## Cut order

Decided in advance, precisely so it isn't decided at 3am.

| # | Cut | Cost of cutting |
|---|---|---|
| 1 | Yield on obligation reserves | The business-model story. Not the pitch. |
| 2 | Auditor time travel and export | A nice artefact. The public page already proves the point. |
| 3 | Generic solvency verifier for any address | A stronger artefact than our own demo business, but the argument is already made. |
| 4 | Simulator as a public page | Keep it as a live demo beat regardless — that costs nothing. |
| 5 | CCTP cross-chain withdrawal | Payout still works, single-chain. Weakens the Privy flow story slightly. |
| — | **Beneficiary payout** | **Not on this list.** It is the second Privy prize *and* carries two of the three Selfie Check signals. |
| — | **Selfie Check gates** | **Not on this list.** World is a submitted track now; cutting these forfeits it. |

**Never cut:** the calldata-decoded lock · split-on-receipt · the subgraph and the coverage-over-time line · the unlock quorum · **every Selfie Check gate and the World feedback document** · the beneficiary payout · the judge-holds-the-keys demo beat. Those are the submission — each one is load-bearing for a bounty we are entering.

---

## Daily map

| Day | Phase | Lands |
|---|---|---|
| 1 | 0 → 1 | Lock proven and attacked. Repo and contract up. |
| 2 | 2 → 3 | Accounts locked. Money splits on arrival. |
| 3 | 3 → 4 | Splitting solid. Subgraph deployed and syncing. |
| 4 | 5 | Public page with a real coverage line. |
| 5 | 6 | Unlock ceremony with Selfie Check on every approver. World feedback started. |
| 6 | 7 | Monitor reasoning over live data — product value, not a prize claim. |
| 7 | 8 | Beneficiary paid — Selfie Check on first claim, App Kit, World feedback finished. |
| 8 | 9 | Arc mainnet. Simulator public. |
| 9 | 9 | Yield, auditor view — or polish if they aren't earned. |
| 10 | 9 | Per-sponsor docs, bounty statements. Rehearsal to 90 seconds. |
| 11 | 9 | Films. Nothing new. |
