# Requirements

BOLT — ETHOnline 2026. Every requirement has an ID so phases, tests and the sponsor traceability matrix can point at it.

**Priority:** `MUST` ships or the submission fails · `SHOULD` ships unless time runs out · `MAY` is a stretch, cut per the order in `PHASES.md`.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| **Business** | The company using BOLT. Holds money belonging to other people. |
| **Beneficiary** | A person or institution the business owes money to — a seller, a client, a tax authority. |
| **Account class** | `OPERATING` (the business's own money, freely spendable) · `CLIENT_MONEY` (owed to named people) · `OBLIGATION_RESERVE` (owed to institutions — tax, payroll — the business's own liability). |
| **Locked account** | A `CLIENT_MONEY` or `OBLIGATION_RESERVE` account. Its Privy policy permits transfers to permitted payees only. |
| **Mandate** | The versioned, quorum-signed table of split ratios. |
| **Split-on-receipt** | Dividing an incoming deposit across accounts within seconds of arrival. |
| **Unlock ceremony** | The deliberately slow process for releasing locked money early. |
| **Coverage ratio** | `held ÷ owed`, per account class. Below 100% is a shortfall. |
| **Policy refusal** | Privy's enclave declining to reassemble a key. The product's core event. |

---

## 2. Functional requirements

### FR-1 — Accounts and the account tree

| ID | Priority | Requirement |
|---|---|---|
| FR-1.1 | MUST | A business is provisioned as a Privy **organization** with an org wallet tree. |
| FR-1.2 | MUST | Each account has exactly one class and one Privy wallet. Class is immutable after creation. |
| FR-1.3 | MUST | Every `CLIENT_MONEY` and `OBLIGATION_RESERVE` account carries a Privy policy at creation time. An account may not exist in an unlocked state, even briefly. |
| FR-1.4 | MUST | Account creation emits `AccountRegistered(businessId, address, class, policyHash, label)`. |
| FR-1.5 | SHOULD | Team members are Privy users with roles: `ADMIN`, `APPROVER`, `VIEWER`. Only `APPROVER` may sign unlock approvals. |
| FR-1.6 | MUST | `CLIENT_MONEY` accounts have `yieldEnabled = false` and it cannot be set true through the UI or API. |

### FR-2 — The lock

| ID | Priority | Requirement |
|---|---|---|
| FR-2.1 | **MUST** | Every locked-account policy constrains the **decoded calldata recipient** (`ethereum_calldata.transfer._to`), not merely `ethereum_transaction.to`. A policy lacking this condition is invalid and must be rejected by the builder. |
| FR-2.2 | MUST | Policies are allowlist, never denylist, and default-deny. No explicit trailing `DENY *` rule — Privy's policies deny by default, and a wildcard `DENY` rule outranks `ALLOW` and would refuse the permitted transfer too (confirmed live, Phase 0). |
| FR-2.3 | MUST | `OBLIGATION_RESERVE` policies permit exactly one destination. `CLIENT_MONEY` policies permit a set of verified beneficiary addresses. |
| FR-2.4 | MUST | A refused transaction returns Privy's raw error, stored verbatim and never wrapped, prettified or swallowed. |
| FR-2.5 | MUST | The application performs no destination check that substitutes for the policy. Refusal must be demonstrable by attempting the transaction. |
| FR-2.6 | MUST | Adding a beneficiary to a `CLIENT_MONEY` allowlist, or changing any policy, requires a key quorum. No admin override, no environment-variable bypass, no development-mode skip. |
| FR-2.7 | MUST | Policy changes emit `PolicyRotated(businessId, account, oldPolicyHash, newPolicyHash, quorumRef)`. |
| FR-2.8 | SHOULD | Policies also constrain `approve` and `transferFrom` so an allowance cannot be used to route around the lock. |

### FR-3 — Split on receipt

| ID | Priority | Requirement |
|---|---|---|
| FR-3.1 | MUST | An inbound USDC transfer to a business's operating account triggers a Privy webhook. |
| FR-3.2 | MUST | Webhook handling is idempotent, keyed by `(txHash, logIndex)`. Redelivery must not double-split. |
| FR-3.3 | MUST | Splits execute via a Privy **session signer** whose own policy limits it to transfers between that business's accounts. A compromised splitter cannot pay an outsider. |
| FR-3.4 | MUST | Splits follow the **active mandate version** at the moment of receipt. That version is recorded with the deposit. |
| FR-3.5 | MUST | Split ratios are basis points summing to exactly 10000. Validated on write and asserted again before signing. |
| FR-3.6 | MUST | Each split emits `SplitExecuted(depositId, account, amount)`, and each resulting debt emits `ObligationAccrued(...)`. |
| FR-3.7 | MUST | Splitting completes within 30 seconds of deposit confirmation under normal conditions. |
| FR-3.8 | SHOULD | A failed or partial split raises an alert and is visible on the public page as unallocated funds — failing loudly, never silently. |

### FR-4 — Mandates

| ID | Priority | Requirement |
|---|---|---|
| FR-4.1 | MUST | Mandates are versioned and immutable. Editing publishes a new version; history is retained. |
| FR-4.2 | MUST | Publishing a mandate requires a key quorum and emits `MandatePublished(businessId, version, rulesHash, quorumRef)`. |
| FR-4.3 | SHOULD | Rules are authored in a plain-language form — *"every marketplace checkout → 88% seller, 4% sales tax, 8% operating"* — not raw JSON. |
| FR-4.4 | SHOULD | Before publishing, a proposed mandate replays against the last 30 days of real indexed deposits and shows what would have happened. |

### FR-5 — Unlock ceremony

| ID | Priority | Requirement |
|---|---|---|
| FR-5.1 | MUST | Releasing locked money early requires a free-text reason. Its hash goes on chain via `UnlockRequested`. |
| FR-5.2 | MUST | Requires 3-of-5 approvals collected as Privy intents, approvable from a phone. |
| FR-5.3 | **MUST** | Each approver completes a **World Selfie Check** before their approval counts. The proof reference is recorded with the approval and shown publicly. This is the **abuse-prevention** signal: a stolen session or a script cannot stand in for a person at the one moment locked money legitimately moves. |
| FR-5.4 | SHOULD | A 24-hour timer runs between the final approval and executability. |
| FR-5.5 | MUST | Approvals emit `UnlockApproved(unlockId, approver, humanProofRef)`; execution emits `UnlockExecuted(unlockId, amount)`. |
| FR-5.6 | MUST | Completed unlocks appear on the public page within 60 seconds, with reason and approver set. |
| FR-5.7 | MUST | An unlock cannot execute without the required approvals — enforced by quorum, not by application logic. |

### FR-6 — Public solvency page

| ID | Priority | Requirement |
|---|---|---|
| FR-6.1 | MUST | Each business has a public, unauthenticated page at `/[slug]`. |
| FR-6.2 | MUST | It shows owed vs held per class, and the current coverage ratio. |
| FR-6.3 | MUST | It lists every account address, linked to a block explorer. |
| FR-6.4 | **MUST** | It renders coverage **over time** as a line, from indexed history — not a single current figure. |
| FR-6.5 | MUST | It lists every unlock ever performed, with reason, approvers and timestamp. |
| FR-6.6 | MUST | Every displayed figure derives from an on-chain event or an on-chain balance. No figure exists only in Postgres. |
| FR-6.7 | SHOULD | A beneficiary can enter their email and see their own balance and the address holding it. |
| FR-6.8 | SHOULD | It states each account's yield setting, so "client money earns nothing" is visible rather than asserted. |

### FR-7 — Solvency Monitor agent

| ID | Priority | Requirement |
|---|---|---|
| FR-7.1 | MUST | The Monitor's only data source is the deployed subgraph, queried live with a real API key. No mocked, static or local-only data. |
| FR-7.2 | MUST | **Shortfall forecast** — projects days of cover remaining per class from observed inflow/outflow. |
| FR-7.3 | MUST | **Mandate drift** — compares actual splits against the active mandate and flags sustained divergence. This is the compromised-backend detector. |
| FR-7.4 | SHOULD | **Anomaly detection** — flags unlock frequency or size outside the business's own baseline. |
| FR-7.5 | MUST | **Natural-language interface** — answers questions such as *"was this business ever short in August?"* with dates and block numbers. Publicly reachable. |
| FR-7.6 | MUST | Findings are written as alerts with severity and evidence; severe ones surface on the public page. |
| FR-7.7 | MUST | The Monitor reasons over the data. Printing raw query results does not satisfy FR-7.2 through FR-7.5. |

### FR-8 — Beneficiary payout

| ID | Priority | Requirement |
|---|---|---|
| FR-8.1 | **MUST** | A beneficiary with no wallet is onboarded via a **pregenerated Privy wallet** bound to their email. Their balance exists before they ever sign in. |
| FR-8.2 | **MUST** | They authenticate with a familiar login. No seed phrase, no gas, no chain selection, no bridge UI. |
| FR-8.3 | **MUST** | Payout from a locked account to a beneficiary succeeds **inside** the policy — it is a permitted destination, not an exception to the rule. |
| FR-8.4 | MAY | Withdrawal to another chain via CCTP, initiated from one button. |
| FR-8.5 | MUST | Payout emits `ObligationSettled(obligationId, amount, txRef)` and reduces outstanding obligations. |
| FR-8.6 | **MUST** | A beneficiary completes a **Selfie Check on first claim**, before any payout executes to them. This is the **eligibility** signal — it establishes that a live person, not a script, is behind the account holding someone else's money. |
| FR-8.7 | **MUST** | A beneficiary completes a **fresh Selfie Check when changing their withdrawal address**, or claiming from an unrecognised device. This is the **continuity** signal, and it is the anti-account-takeover control: a stolen session cannot silently redirect a seller's balance to a new address. |
| FR-8.8 | MUST | A **repeat withdrawal to an address the beneficiary has already verified requires no fresh check.** The continuity signal is already established, and the payout flow must stay frictionless — that is what the Privy financial-flow bounty is judged on. |

### FR-9 — Breach simulator

| ID | Priority | Requirement |
|---|---|---|
| FR-9.1 | SHOULD | `/simulator` grants any visitor full operator privileges over a sandbox business. |
| FR-9.2 | MUST | It surfaces the **raw enclave error** on each refusal, not a styled application error. |
| FR-9.3 | SHOULD | Attempts and refusals are logged and displayed as a running tally. |
| FR-9.4 | MUST | The sandbox is isolated. No simulator action can touch a real business. |

### FR-10 — Auditor portal

| ID | Priority | Requirement |
|---|---|---|
| FR-10.1 | MAY | A read-only role that can view but never initiate. |
| FR-10.2 | MAY | Time travel — reconstruct exact state at an arbitrary past timestamp from the index. |
| FR-10.3 | MAY | Export an attestation report generated from indexed history. |

### FR-11 — Yield

| ID | Priority | Requirement |
|---|---|---|
| FR-11.1 | MAY | `OBLIGATION_RESERVE` accounts may earn yield while idle. |
| FR-11.2 | MUST | `CLIENT_MONEY` never earns by default, and the setting is displayed publicly. |
| FR-11.3 | MAY | Yield must not weaken the lock — funds remain policy-constrained while deployed. |

### FR-12 — World feedback document

| ID | Priority | Requirement |
|---|---|---|
| FR-12.1 | **MUST** | `docs/WORLD_FEEDBACK.md` exists and is a **required submission deliverable**, not a nice-to-have. |
| FR-12.2 | MUST | It covers all four named topics, as their own headed sections: **(a)** Selfie Check docs and integration flow · **(b)** Developer Portal navigation, search, product discovery and debugging guidance · **(c)** Sandbox App states, proof flows, test users, errors and edge cases · **(d)** what was confusing, missing, broken, or hard to test. |
| FR-12.3 | MUST | Written **during** integration in Phases 6 and 8, never retrofitted at the end. Retrofitted feedback is obvious to read and worthless to the sponsor. |
| FR-12.4 | MUST | The project is tested against the **World ID Sandbox**, and the sandbox experience is what section (c) reports on. |

---

## 3. Non-functional requirements

| ID | Priority | Requirement |
|---|---|---|
| NFR-1 | MUST | **No enforcement in application code.** Every safety property traces to a Privy policy or a key quorum. A code review that finds an app-layer substitute treats it as a defect. |
| NFR-2 | MUST | **No mocked features claimed for eligibility.** If something needs commercial onboarding, the claim is cut, not faked. |
| NFR-3 | MUST | **No compliance claims.** "Technical enforcement and public verifiability" — never "compliant". |
| NFR-4 | MUST | Server secrets never reach a client bundle. |
| NFR-5 | MUST | Money is `bigint` in USDC base units throughout. Never floating point. |
| NFR-6 | MUST | Public page first contentful paint under 2s; coverage chart under 4s. |
| NFR-7 | MUST | Every external payload — webhooks, GraphQL, agent output — is schema-validated before use. |
| NFR-8 | MUST | Public repository, README, architecture diagram, and a demo video under 5 minutes. Required by three of the four sponsors. |
| NFR-9 | SHOULD | Every demo beat completes in seconds. Anything with an unpredictable clock stays off screen. |

---

## 4. Data model

**On chain — `BoltRegistry`.** Custodies nothing. An append-only record so coverage is computable from chain data.

```
BusinessRegistered   (businessId, slug, admin)
AccountRegistered    (businessId, account, class, policyHash, label)
PolicyRotated        (businessId, account, oldPolicyHash, newPolicyHash, quorumRef)
MandatePublished     (businessId, version, rulesHash, quorumRef)
DepositObserved      (businessId, depositId, amount, mandateVersion)
SplitExecuted        (depositId, account, amount)
ObligationAccrued    (businessId, obligationId, account, beneficiaryRef, amount)
ObligationSettled    (obligationId, amount, txRef)
UnlockRequested      (businessId, unlockId, account, amount, destination, reasonHash, executableAt)
UnlockApproved       (unlockId, approver, humanProofRef)
UnlockExecuted       (unlockId, amount)
UnlockCancelled      (unlockId, reasonHash)
```

Storage: `outstandingObligations[businessId][class] → uint256`, so coverage is readable on chain as well as from the index.

**Off chain — Postgres.** Config and workflow state only: `businesses`, `accounts`, `beneficiaries`, `mandates`, `mandate_rules`, `deposits`, `splits`, `obligations`, `unlock_requests`, `unlock_approvals`, `policy_refusals`, `alerts`.

**Indexed — subgraph.** Derives `Business`, `Account`, `CoverageSnapshot` (per block where anything changed), `Deposit`, `Split`, `Obligation`, `Unlock`, `Approval`. `CoverageSnapshot` is what draws the line in FR-6.4 and what the Monitor reasons over.

---

## 5. Track traceability

Each sponsor's literal qualification bullets, mapped to the requirements that satisfy them. **This table is the source for the per-sponsor README sections** — judges check bullets, so we answer them in their own words.

### Privy — Best B2B financial product ($2,500)

| Their bullet | Satisfied by |
|---|---|
| Integrate Privy as a core part of the product | FR-2 entire. The policy engine is the product. |
| Create or use at least one Privy wallet | FR-1.1, FR-1.2 — org wallet tree, member wallets, beneficiary wallets |
| Demonstrate a business or organization use case | FR-1.1, FR-1.5 — a multi-person company holding third-party money |
| At least one functional B2B workflow | Four: FR-3 (treasury op), FR-5 (approval), FR-4 (wallet admin), FR-8 (payment) |
| At least one Privy control | Four: policies FR-2 · session signers FR-3.3 · key quorums FR-2.6, FR-5.2 · intents FR-5.2 |
| Working demo and source code | NFR-8, FR-9 — plus a simulator judges can attack themselves |
| Clearly explain how Privy enables the product | FR-2.4, FR-2.5, FR-9.2 — the refusal is watchable, not asserted |

### Privy — Best financial flow ($2,500)

| Their bullet | Satisfied by |
|---|---|
| Complete a functional financial flow on a GA feature | FR-3 → FR-8: buyer pays → splits → beneficiary paid |
| Eligible flow type (transfers, bridging, …) | FR-8.3 transfer, FR-8.4 cross-chain |
| Hides unnecessary onchain complexity | FR-8.1, FR-8.2 — familiar login, balance already present |
| Mocked features do not count toward eligibility | NFR-2. No Privy Cards. Nothing mocked. |

### Arc — Best DeFi/Onchain Finance Application ($1,667)

| Their bullet | Satisfied by |
|---|---|
| Meaningful use of Arc and USDC | FR-1, FR-3, FR-8 — Arc is the home, not a bridge stop |
| Advanced programmable money flows | Conditional payment FR-2.3 · automation FR-3.1 · multi-step settlement FR-3 → FR-5 → FR-8 |
| Payment / liquidity / treasury workflows | FR-3, FR-11 — segregation, reserving, treasury yield |
| Functional MVP, frontend + backend, architecture diagram | NFR-8, `docs/ARCHITECTURE.md` |
| Video demonstration and documentation | NFR-8 |
| GitHub repo link | NFR-8 |

### Arc — Launch on Arc Testnet & Push to Mainnet ($3,500 pool) — *optional second Arc submission*

Same deliverables as the bounty above plus a mainnet deployment, which Phase 9 produces anyway. Not currently declared; costs one extra submission and one extra sentence if you want it.


| Their bullet | Satisfied by |
|---|---|
| Crosschain transfers with Arc as core settlement layer | FR-8.4 via CCTP; all balances FR-1.2 |
| Stablecoin settlement / escrow logic on Arc | FR-2, FR-3 |
| Functional MVP and diagram | NFR-8 |
| Deployed or deployment-ready on Arc mainnet by 30 September | Phase 9. Build completes ~17 September. |

### World — Selfie Check ($3,500 pool, up to 3 teams × $1,166) — **SUBMITTED**

*Its job in the product: the gate. Privy constrains where money may go; World constrains who may start it moving. Selfie Check guards **both** exits from a locked account, and there are only two.*

| Their bullet | Satisfied by |
|---|---|
| Uses Selfie Check, or a Selfie Check-compatible World ID credential flow, **in a meaningful way** | FR-5.3 + FR-8.6 + FR-8.7 — it gates every unlock approval and every first claim and address change. Remove it and both exits from a locked account become script-triggerable. It is not a login skin on one screen. |
| Treats Selfie Check as a **risk, eligibility, fairness, continuity, or abuse-prevention** signal | Three of the five, each doing a distinct job: **abuse prevention** (FR-5.3, unlock approvals) · **eligibility** (FR-8.6, first claim) · **continuity** (FR-8.7, address change and new device — the anti-account-takeover control) |
| **Includes a feedback document** on docs and integration flow, Developer Portal navigation/search/discovery/debugging, Sandbox states/proofs/test users/errors/edge cases, and what was confusing or broken | FR-12 entire. Four headed sections, written during Phases 6 and 8 rather than retrofitted. |
| Shows a working app | NFR-8, plus the unlock ceremony and payout beats in the demo film |

**Design note worth stating in the README:** the check is deliberately *not* on every withdrawal (FR-8.8). Selfie Check is described by World as low-friction and low-assurance, and we treat it that way — it establishes a person at the moments that matter and then gets out of the way. Gating every routine payout would have made the flow worse without making it safer.

### The Graph — implemented, not submitted

The subgraph and the Solvency Monitor stay in the build. Coverage *through time* is the product's central claim, and an index is the only way to compute it — delete The Graph and the public page shows only "now", which is exactly the weakness the pitch attacks. FR-6.4 and FR-7 are unchanged and still MUST.

What goes away, because there is no Graph scorecard to satisfy: the ERC-4626 vault refactor, the reusable Substreams module, a separate 2–4 minute Graph film, the Start Fresh pool declaration, and the "agent/app not tooling" statement. That capacity moves to World and to the Arc App Kit gap.

### Submission statements — required, easy to forget

| Requirement | Where it comes from | Satisfied by |
|---|---|---|
| **"Be clear what bounty you are submitting for"** | Arc says this in writing, in both bounty blocks | A bounty line at the top of each sponsor README section — Phase 9, day 10. Ours: *Best DeFi/Onchain Finance Application* |
| **`docs/WORLD_FEEDBACK.md`** | World requires it as a qualification bullet | FR-12 — four headed sections, written during Phases 6 and 8 |
| **Architecture diagram in the repo** | Arc requires it explicitly | `docs/ARCHITECTURE.md`, Phase 9 |

## 6. Out of scope

Stated so nobody expects them, and so a judge's "did you consider…" has an answer.

- Fiat on/off ramps, KYC of businesses, invoicing, accounting integrations
- Multi-currency obligations (USDC only; EURC via StableFX is a post-hackathon idea)
- Recovering funds already stolen before onboarding — BOLT prevents, it does not claw back
- Any compliance certification or attestation service
- Chainlink Proof of Reserve — deliberately excluded, see README
