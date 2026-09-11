# Master build prompt

How to use this file: put `CLAUDE.md`, `README.md`, `docs/REQUIREMENTS.md`, `docs/PHASES.md` and `docs/ARCHITECTURE.md` in an empty repository, then paste **§1** as your first message to Claude Code. Use **§2** at the start of each later session, and **§3** when you need a single phase built in isolation.

\---

## 1\. Kickoff prompt — paste this once, at the start

> You are building \\\*\\\*BOLT\\\*\\\* — Beneficiary-Only Ledger Transfers — for the ETHOnline 2026 hackathon. The name is the policy: a locked account may transfer to a beneficiary, and to nobody else. This repository contains the full specification. Read these five files completely before writing any code, in this order:
>
> 1. `CLAUDE.md` — the invariants. These are not style preferences; breaking one breaks the product's central claim.
> 2. `README.md` — what the product is and why it exists.
> 3. `docs/REQUIREMENTS.md` — numbered functional requirements and the sponsor traceability matrix.
> 4. `docs/PHASES.md` — ten phases with checkable exit criteria, plus the cut order.
> 5. `docs/ARCHITECTURE.md` — system diagram, lifecycle sequence, data model.
>
> \\\*\\\*The product in one sentence:\\\*\\\* incoming payments are split the moment they arrive into accounts that are cryptographically incapable of paying anyone except the person the money belongs to, with a public page anyone can use to verify it.
>
> \\\*\\\*The one thing to understand before you write anything:\\\*\\\* enforcement lives in the Privy policy engine, which evaluates inside a secure enclave \\\*before the signing key is reassembled\\\*. It does not live in our application code. If you ever find yourself writing an `if` statement that checks a destination before sending a transaction, you are building the wrong product — send the transaction and let the enclave refuse it, then record the raw error.
>
> \\\*\\\*Rule 0, before any integration code.\\\*\\\* Every time you are about to write or change code that touches Privy, Arc, Circle or World, query that sponsor's MCP server first and work from what it returns — never from memory or from a pattern that looks right. The servers are `privy-docs`, `arc-docs`, `circle` (codegen, for CCTP and Circle Wallets) and `world-docs`. Retrieve the specific thing you are about to write: the exact method name and argument shape, the exact field names, the exact policy condition grammar, the exact event signature. Then say in one line which doc you worked from. If a server is unavailable, name it, fall back to that sponsor's public docs site, and if you can reach neither, \\\*\\\*say so and stop\\\*\\\* rather than guessing.
>
> \\\*\\\*The Graph is different — there is no docs MCP for it.\\\*\\\* Before writing or changing anything touching a subgraph manifest, schema, mapping, Studio deployment, GraphQL query or Substreams module, \\\*\\\*stop and ask me which documentation you need\\\*\\\*, naming precisely what you need to know. Do not proceed from memory. (The Subgraph MCP is a runtime component the Monitor queries — it is not a documentation server and will not tell you how to write a mapping.)
>
> `world-docs` is currently \\\*\\\*pending approval\\\*\\\* and sits on the critical path — World is a submitted track, and Phases 6 and 8 both need it. Flag it to me on day 1, not on day 5.
>
> Full detail is in `CLAUDE.md` under Rule 0.
>
> \\\*\\\*Start with Phase 0 and nothing else.\\\*\\\* Phase 0 is a go/no-go spike on a single assumption: that a Privy policy can decode transaction calldata and constrain `ethereum\\\_calldata.transfer.\\\_to`. A USDC transfer's `transaction.to` is the token contract, not the payee, so a policy constraining only `transaction.to` would permit paying anyone on earth. If ABI-decoded conditions do not behave as documented, \\\*\\\*stop and tell me\\\*\\\* — do not build around it, do not fall back to application-layer checks, and do not proceed to Phase 1. Everything downstream assumes this works.
>
> \\\*\\\*How to work:\\\*\\\*
> - Follow `docs/PHASES.md` in order. Each phase has written exit criteria. Do not begin phase N+1 until phase N's criteria are met and you have shown me they are met.
> - At the start of each phase, tell me what you are about to build and which requirement IDs it satisfies. At the end, walk the exit criteria one by one and say whether each passes.
> - Reference requirement IDs (FR-x.y, NFR-n) in commit messages and in code comments where a non-obvious decision traces to one.
> - Ask before adding any dependency that overlaps with something already in the stack. Ask before adding a sponsor integration — three is the plan and Chainlink is deliberately excluded.
> - Where the specification is genuinely ambiguous, make the smallest reasonable decision, state it in one line, and continue. Do not stall on questions I can answer later.
> - Where the specification conflicts with what an SDK actually does, \\\*\\\*the SDK wins and you tell me\\\*\\\*. The docs were written before the code.
>
> \\\*\\\*The tests that must never be deleted:\\\*\\\*
> - The policy builder throws if it emits a rule without a `transfer.\\\_to` condition (FR-2.1).
> - Mandate split ratios must sum to exactly 10000 basis points (FR-3.5).
> - Webhook redelivery must not produce a second split (FR-3.2).
>
> Begin with Phase 0. Tell me your plan for the spike before you run it.

\---

## 2\. Session-resume prompt — paste at the start of each later session

> Continuing the BOLT build. Re-read `CLAUDE.md` and `docs/PHASES.md` before doing anything.
>
> Tell me, in this order:
> 1. Which phase we are in, and which exit criteria are already met.
> 2. Which are outstanding.
> 3. What you propose to do next, and which requirement IDs it satisfies.
>
> Then wait for me to confirm before writing code.
>
> Rule 0 applies to everything you write today: `privy-docs` / `arc-docs` / `circle` / `world-docs` before any integration code, name the doc you worked from — and \\\*\\\*ask me for documentation before anything touching The Graph\\\*\\\*, which has no MCP server.
>
> Remember the invariants: enforcement lives in the Privy policy, never in application code · policies constrain `transfer.\\\_to`, never only `transaction.to` · widening a lock needs a quorum with no bypass · client money never earns yield by default · we never claim regulatory compliance · nothing claimed for prize eligibility may be mocked · no figure on the public page may come only from Postgres.

\---

## 3\. Single-phase prompt — for building one phase in isolation

> Build \\\*\\\*Phase \\\_N\\\_\\\*\\\* of BOLT as specified in `docs/PHASES.md`.
>
> Before starting: read `CLAUDE.md`, the phase's own section in `docs/PHASES.md`, and every requirement ID that section references in `docs/REQUIREMENTS.md`.
>
> Confirm to me that the previous phase's exit criteria are met. If they are not, say so and stop.
>
> Then:
> 1. State what you will build and which requirement IDs it satisfies.
> 2. Build it.
> 3. Walk the phase's exit criteria one by one and say whether each passes, with the evidence — a test name, a transaction hash, a query result, a screenshot path.
>
> Do not start the next phase.

\---

## 4\. Standing instructions worth repeating to the agent

Paste any of these when the model drifts.

**On enforcement**

> Stop. You have written an application-layer check that substitutes for a policy. Delete it. Send the transaction, let the Privy enclave refuse it, and store the raw error with `recordPolicyRefusal`. The refusal is the product; a check in our code is exactly the thing we are telling the world does not protect anyone.

**On writing from memory**

> Stop — which doc did you get that from? Rule 0 applies: query `privy-docs` / `arc-docs` / `circle` / `world-docs`, work from what it returns, and tell me the source. If it is a Graph call, ask me for the documentation instead — there is no MCP for The Graph. Either way, do not guess at the signature.

**On the calldata rule**

> That policy constrains `ethereum\\\_transaction.to`. For a USDC transfer that is the token contract, not the payee, so this rule permits paying anyone on earth. Add the `ethereum\\\_calldata.function\\\_name` and `ethereum\\\_calldata.transfer.\\\_to` conditions and make the builder throw when they are absent.

**On scope**

> We are past the point where new scope helps. Check the cut order in `docs/PHASES.md`. If what you are proposing is below the line we have reached, cut it and move to the next exit criterion.

**On the public page**

> Where does that number come from? If the answer is Postgres, it cannot appear on the public solvency page. Every figure must trace to an on-chain event or an on-chain balance — that is FR-6.6, and it is what makes the page verifiable without trusting us.

**On copy**

> Rewrite that without the word "compliant". We provide technical enforcement and public verifiability. MiCA Article 70 is cited as evidence that demand exists, never as a compliance claim. That is NFR-3.

**On mocking**

> If that feature needs commercial onboarding, we cut the claim rather than fake it. Tell me which sponsor bullet it was satisfying and I will decide whether to drop the claim or find another way. That is NFR-2.

\---

## 5\. Definition of done, for the whole build

The submission is finished when every line below is true. Not before.

* \[ ] A permitted transfer from a locked account succeeds; a transfer to any other destination is refused, with the raw enclave error saved to `docs/evidence/`
* \[ ] The policy builder throws when a rule lacks `transfer.\\\_to`, and the test proving it is green
* \[ ] A testnet deposit splits across three accounts in under 30 seconds, and replaying the webhook does not split it twice
* \[ ] The subgraph is deployed to Subgraph Studio, fully synced, and returns coverage at an arbitrary past block
* \[ ] The public page loads unauthenticated, and every figure on it traces to an event or a balance
* \[ ] The coverage chart renders real indexed history, not a single current value
* \[ ] A full unlock ceremony completes; a ceremony with two approvals cannot execute, and the failure comes from the quorum rather than from our code
* \[ ] The Monitor answers a question it was not hard-coded for, citing block numbers, against live indexed data
* \[ ] A fresh email address receives a payout without ever seeing a seed phrase
* \[ ] `/simulator` is public and survives attack, showing raw enclave errors
* \[ ] Deployed on Arc mainnet, or demonstrably deployment-ready
* \[ ] One README section per sponsor, every claimed bullet true and unmocked, written against the traceability table in `docs/REQUIREMENTS.md` §5
* \[ ] `docs/WORLD\\\_FEEDBACK.md` written during Phase 6, not retrofitted
* \[ ] Main demo video under 5 minutes; Monitor video 2–4 minutes
* \[ ] The judge-holds-the-keys sequence rehearsed to 90 seconds and reliable

\---

## 6\. If you only remember one thing

> We didn't prove the money is safe. We removed the ability to move it, and put the proof on a page anyone can check.

Every design decision is judged against that sentence. If a change makes it less true, it is the wrong change — however much easier it makes the build.

