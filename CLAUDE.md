# CLAUDE.md

Instructions for Claude Code working in this repository. Read this before writing any code.

---

## What this project is

**BOLT** — **B**eneficiary-**O**nly **L**edger **T**ransfers — puts a business's customer money into accounts the business is *physically unable* to spend from, and publishes a page anyone can use to verify it.

The enforcement is not application logic. It is a **Privy policy evaluated inside a secure enclave before the signing key is reassembled**. If the policy says no, no signature is ever produced. Our backend does not get a vote, and that is the entire point of the product.

Built for ETHOnline 2026.

**Submitting to three sponsors — Privy, Arc, World.** Each must do crucial work in the product, not decorate it:

| Sponsor | Its job | Bounties |
|---|---|---|
| **Privy** | **The lock** — constrains *where* money can go. Refusal before a signature exists. | Best B2B financial product · Best financial flow |
| **Arc** | **The rail** — where the money lives. Every balance, split, reserve and payout is USDC on Arc. | Best DeFi/Onchain Finance Application |
| **World** | **The gate** — constrains *who* can start money moving. Selfie Check on both exits from a locked account. | Selfie Check |

**The Graph is implemented but not submitted.** The subgraph and the Solvency Monitor stay in the build — coverage *through time* is the product's central claim and an index is the only way to compute it — but we are not entering either Graph bounty. That means no ERC-4626 refactor, no Substreams module, no separate Graph film, no pool declaration. Build it because the product needs it, not to a scorecard.

**Privy constrains the destination. World constrains the initiator.** Two independent gates on the only two ways money leaves a locked account. Neither substitutes for the other: a verified human still cannot send to an unpermitted address, and a permitted address still cannot be paid by a script.

---

## Rule 0 — read the sponsor docs before you write integration code

**This applies to every line of code that touches Privy, Arc/Circle, World, or The Graph.**

Before creating or modifying anything that calls one of those SDKs or APIs, **query that sponsor's documentation MCP server first and work from what it returns.** Not from memory, not from a pattern that looks right, not from how another project did it. Four moving SDKs in eleven days is exactly the situation where a plausible-looking method name costs half a day.

### The servers, by name

| Touching | Server | Endpoint | Status |
|---|---|---|---|
| **Privy** — policies, org wallets, session signers, key quorums, intents, pregenerated wallets, webhooks | `privy-docs` | `https://docs.privy.io/mcp` | connected |
| **Arc** — chain config, RPC, USDC on Arc, App Kits, contracts | `arc-docs` | `https://docs.arc.io/mcp` | connected |
| **Circle** — CCTP, Circle Wallets, Circle APIs | `circle` | `https://api.circle.com/v1/codegen/mcp` | connected |
| **World** — Selfie Check, IDKit, credential flows, Sandbox testing | `world-docs` | `https://docs.world.org/mcp` | **pending approval** |
| **The Graph** — manifest, schema, mappings, Studio deploy, GraphQL, Substreams | **none exists** | — | see below |

Two notes on that table:

- **`circle` is a codegen server, not prose documentation.** It generates code against Circle's APIs. Use `arc-docs` for how Arc itself works, and `circle` for CCTP and Circle Wallets calls. They answer different questions; reach for the right one.
- **`world-docs` is pending approval and sits on the critical path.** World is a submitted track now, and Phase 6 and Phase 8 both depend on it. Approve it on day 1 alongside the Privy tier check — discovering the problem on day 5 costs a track.

Other servers are connected (`stitch`, `arkiv-ideathon`) but are not part of this build. `stitch` may be used for UI scaffolding if it helps; `arkiv-ideathon` is unrelated to BOLT — do not wander into it.

### The Graph has no docs MCP — so stop and ask

**There is no documentation MCP server for The Graph.** Before writing or changing anything that touches a subgraph manifest, schema, AssemblyScript mapping, Studio deployment, GraphQL query, or Substreams module:

> **Stop and ask which documentation is needed.** Name precisely what you need to know — "the `eth_call` declaration syntax for a subgraph manifest", "the entity-save semantics for a derived field", "how to authenticate a Studio query with an API key" — and wait. Do not proceed from memory, and do not guess at a schema.

This is not a soft preference. The Graph is one of the three load-bearing sponsors, and a subgraph that silently indexes the wrong thing is the most expensive kind of failure in this build: everything downstream — the coverage line, the Monitor, the auditor view — reads from it, and the fault only shows up once there is enough history to notice.

**Do not confuse the two meanings of "Subgraph MCP".** The Subgraph MCP is a *product component we build with* — the Monitor uses it to query indexed data at runtime. It is not a documentation server, and it will not tell you how to write a mapping.

### What "look it up" means here

Not skimming until you feel confident. Retrieve the specific thing you are about to write:

- the exact method name and the shape of its arguments, from the current docs
- the exact field names in a request or response — `transfer._to`, not `transfer.to`, and never a guess about which
- the exact condition grammar for a Privy policy, **before** writing the policy builder
- the exact event signature and entity field, **before** writing a subgraph mapping
- whether the feature is available on our plan tier at all, **before** building on top of it

Then write the code, and say in one line which doc you worked from.

### When the docs and this repo disagree, the docs win — and you tell me

Every spec file here — `README.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md` — was written before any code existed. The policy grammar, method names and event shapes in them are **illustrative**. If the real SDK differs, follow the SDK, then flag the divergence so the spec gets corrected instead of quietly drifting out of date.

### If a server is unavailable, say so and stop

Name the server that failed — `privy-docs`, `arc-docs`, `circle`, `world-docs` — and tell me. Fall back to fetching that sponsor's public documentation site. If you can reach neither, **do not guess your way through an integration**: say the server is down and move to work that does not need it. A hallucinated SDK call that compiles is worse than no code at all, because it fails at the demo instead of at the keyboard.

For The Graph there is no server to fall back from — the rule there is always to ask.

This rule is also why Phase 0 exists. The single assumption the whole product rests on — that a Privy policy can decode calldata and constrain `transfer._to` — is a documentation question before it is a code question.

---

## The invariants

These are not style preferences. Breaking any one of them breaks the product's central claim. If a task appears to require breaking one, **stop and raise it** rather than working around it.

### 1. Enforcement lives in the Privy policy. Never in our code.

Never add an application-layer check that *substitutes* for a policy. App-layer validation is allowed only as a UX nicety that fails *before* the policy would, never as the thing that makes an operation safe.

```ts
// WRONG — this is the thing we are telling the world doesn't exist
if (destination !== allowedDestination) throw new Error("not allowed");
await privy.walletApi.ethereum.sendTransaction({ ... });

// RIGHT — send it and let the enclave refuse. Capture the refusal.
try {
  await privy.walletApi.ethereum.sendTransaction({ ... });
} catch (e) {
  await recordPolicyRefusal(e); // raw error preserved, verbatim
  throw e;
}
```

### 2. Policies constrain `transfer._to`, never `transaction.to` alone.

A USDC transfer's `transaction.to` is **the token contract**, not the payee. A policy that only constrains `transaction.to` permits paying anyone on earth. Every locked-account policy MUST decode calldata — grammar below confirmed live against Arc testnet in the Phase 0 spike, evidence in `docs/evidence/`:

```
ALLOW  eth_sendTransaction
  WHERE  ethereum_transaction.to         == USDC_CONTRACT
    AND  ethereum_calldata.function_name == "transfer"
    AND  ethereum_calldata.transfer._to  == <permitted payee>
    AND  ethereum_transaction.value      == 0
```

No trailing `DENY *`. Privy's policies default-deny; an explicit wildcard `DENY` rule takes precedence over `ALLOW` and would refuse the *permitted* transfer too — the policy-builder test must not require one. The `value == 0` condition is required, not optional: on Arc, USDC is the native gas token, so the ERC-20 `transfer` interface and a native-value send move the same underlying balance, and a `transfer()` call could otherwise carry an attached native value alongside it.

Any policy builder that emits a rule without a `transfer._to` (or `transferFrom._to` — the segment is always the exact ABI function name, e.g. `transferFrom`, not a description of it) condition is a bug. There is a test for this; do not delete it. The ABI used to decode `transfer` must be **pinned by the policy builder itself**, with the recipient input named `_to` — never import a stock ABI like viem's `erc20Abi`, which names the same parameter `recipient` and silently changes the field path the policy checks.

### 3. Widening a lock is as hard as spending from it.

Policy changes and mandate ratio changes go through a key quorum. There is no admin override, no env-var bypass, no "dev mode" that skips it. If you find yourself adding `if (process.env.NODE_ENV === 'development')` around a quorum check, stop.

### 4. Client money defaults to yield OFF.

`AccountClass.CLIENT_MONEY` accounts never earn by default. Only `OBLIGATION_RESERVE` (money owed to institutions — tax, payroll — which is the company's own liability) may earn. This split is a deliberate regulatory-posture decision, not an oversight. Surface the setting on the public page either way.

### 5. Never claim regulatory compliance.

We say: *technical enforcement and public verifiability*. We cite MiCA Article 70 as evidence that demand exists. We never write, in code comments, UI copy, README or video script, that BOLT *is* MiCA-compliant, or that using it makes anyone compliant. If you are drafting user-facing copy and reach for the word "compliant", pick a different word.

### 6. Nothing claimed for prize eligibility may be mocked.

Every Privy, Arc and World feature we assert in the README must be live. (The Graph is implemented but not submitted, so nothing about it is a prize claim — but do not describe it as more than it is either.) Mocks are permitted only for things we explicitly label as out of scope in the submission. If a feature turns out to need commercial onboarding, we cut the claim — we do not fake it.

### 7. Every exit from a locked account passes both gates.

Money leaves a locked account exactly two ways: an early unlock ceremony, or a payout to a verified beneficiary. Both are constrained by a Privy policy (*where* it may go) **and** gated by a World Selfie Check (*who* may start it). Never add a third exit, and never let one gate stand in for the other.

The one deliberate exception is a **repeat withdrawal to an address that beneficiary has already verified** — no fresh check, because the continuity signal was already established and the point of the payout flow is that it stays frictionless.

### 8. The public page must be verifiable without trusting us.

Every figure on `/[slug]` traces to either an on-chain event or an on-chain balance, and the page shows the addresses so a reader can check them on a block explorer. Never render a number that exists only in our Postgres.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript, Tailwind |
| Wallets & enforcement | Privy — org wallets, policy engine, session signers, key quorums, intents, pregenerated wallets |
| Chain | Arc (EVM), USDC. Cross-chain payout via Circle CCTP |
| Contracts | Solidity + Hardhat (viem). One contract: `BoltRegistry` |
| Indexing | Subgraph (AssemblyScript) → Subgraph Studio |
| Agent | TypeScript, OpenRouter (OpenAI-compatible endpoint, `nvidia/nemotron-3-ultra-550b-a55b:free`), reads the subgraph |
| Human gate | World Selfie Check — unlock approvals, and beneficiary first-claim and address-change |
| Off-chain state | Postgres + Drizzle |

---

## Layout

```
bolt/
├── apps/
│   ├── web/                 Next.js — dashboard, public page, API routes, webhooks
│   └── monitor/             Solvency Monitor agent
├── packages/
│   ├── core/                shared types, mandate engine, coverage math
│   ├── privy/               Privy wrappers + policy builders  ← invariant 2 lives here
│   └── db/                  Drizzle schema + client
├── contracts/               Hardhat (viem) — BoltRegistry.sol
├── subgraph/                The Graph
└── docs/                    ARCHITECTURE.md, REQUIREMENTS.md, PHASES.md
```

---

## Commands

```bash
pnpm install
pnpm dev                  # web on :3000
pnpm test                 # unit tests — includes the policy-builder guard
pnpm db:push              # apply Drizzle schema
pnpm contracts:build      # hardhat compile
pnpm contracts:test       # hardhat test
pnpm contracts:deploy     # deploy BoltRegistry to Arc testnet
pnpm subgraph:deploy      # codegen, build, deploy to Subgraph Studio
pnpm monitor:dev          # run the agent loop locally
```

---

## Conventions

- **TypeScript strict.** No `any` in `packages/core` or `packages/privy`. Zod-validate every external payload — webhooks, GraphQL responses, agent output.
- **Money is `bigint`**, always in USDC base units (6 decimals). Never `number`. There is a `Usdc` branded type in `packages/core`; use it.
- **Ratios are basis points** (`bps`, integer, 10000 = 100%). A mandate's splits must sum to exactly 10000 — enforced at write time and asserted again before signing.
- **Every state change worth proving emits a `BoltRegistry` event.** Postgres holds config and workflow state; the chain holds the record. If a fact appears on the public page, it came from an event or a balance.
- **Preserve raw errors from Privy verbatim.** Policy refusals are demo material and evidence. Never wrap, never prettify, never swallow. `recordPolicyRefusal` stores the untouched error body.
- **Server-only secrets stay server-only.** `PRIVY_APP_SECRET` and `PRIVY_AUTHORIZATION_KEY` must never appear in a client bundle. Only `NEXT_PUBLIC_PRIVY_APP_ID` crosses.
- **Idempotent webhooks.** Deposits are keyed by transaction hash and log index. Handlers must tolerate redelivery without double-splitting.

---

## Working style in this repo

- **Rule 0 first, every time.** `privy-docs` / `arc-docs` / `circle` / `world-docs` before integration code, and **ask me for docs before anything touching The Graph**. No exceptions for "small" changes.
- **Follow `docs/PHASES.md` in order.** Phases have written exit criteria. Do not start phase N+1 while phase N's exit criteria are unmet.
- **Phase 0 is a go/no-go.** If ABI-decoded policy conditions do not behave as documented, stop and escalate. Do not build around it. Everything downstream assumes it works.
- **When cutting scope, use the cut order in `docs/PHASES.md`.** It was decided in advance precisely so it isn't decided at 3am.
- **Ask before adding a dependency** that overlaps with something already in the stack.
- **Do not add sponsors.** Four is the plan. Chainlink Proof of Reserve is deliberately excluded — integrating it would contradict our thesis.

---

## The line to keep in your head

> We didn't prove the money is safe. We removed the ability to move it, and put the proof on a page anyone can check.

If a change makes that sentence less true, it is the wrong change.
