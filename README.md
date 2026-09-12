# BOLT
### **B**eneficiary-**O**nly **L**edger **T**ransfers

**Your customers' money should live in an account you are not able to spend from.**

BOLT splits incoming payments the moment they arrive into accounts that are cryptographically incapable of paying anyone except the person the money belongs to — and publishes a page anyone can use to verify it, without trusting the business, an auditor, or us.

The name is the policy: a locked account may transfer to a beneficiary, and to nobody else. Built for **ETHOnline 2026**.

---

## The problem

A marketplace collects $400,000 in March. $340,000 belongs to sellers. $28,000 is sales tax owed to a government. $32,000 is its own commission. All of it lands in one wallet.

In April it has a bad month and payroll is due. Nobody has to hack anything — a founder with the ordinary company keys can spend the sellers' money, and it looks identical to every other transaction.

**Nothing in the software said no. Nothing in the software *could* say no.**

Proof of reserves doesn't fix this. It confirms money existed on one particular day; it says nothing about the next day, and it does not stop anything from leaving. It asks a company to demonstrate, periodically, that it hasn't yet done the thing it remains perfectly able to do.

**BOLT removes the ability.**

---

## How it works

Privy wallets are split into shares held inside a secure enclave. Before those shares are reassembled to sign anything, a **policy** is evaluated. If the policy refuses, the key is never reconstructed and no signature exists. The refusal happens *below* our application — our own servers cannot override it, because they were never given the choice.

The detail that makes it real: a USDC payment's `transaction.to` is **the token contract**, not the payee. A policy constraining only `transaction.to` would happily permit paying anyone on earth. So the policy decodes the calldata and constrains the recipient parameter inside it:

```
# TAX RESERVE — the rule that does the work
ALLOW  eth_sendTransaction
  WHERE  ethereum_transaction.to         == USDC_CONTRACT
    AND  ethereum_calldata.function_name == "transfer"
    AND  ethereum_calldata.transfer._to  == 0xREVENUE_AUTHORITY
    AND  ethereum_transaction.value      == 0
```

Line 4 is the product. That wallet may only ever move money to the tax office. Widening it requires 3-of-5 approval, so no single compromised server or founder can do it.

The policy `packages/privy/src/policy-builder.ts` actually emits is that rule plus three details that matter and are dull to read: the same rule is repeated for `eth_signTransaction` as well as `eth_sendTransaction`, `chain_id` is pinned, and explicit `DENY` rules cover `approve` and `transferFrom` (FR-2.8 — default-deny already closed that route in Phase 0, but an explicit `DENY` cannot be widened by a later permissive rule). There is no trailing `DENY *`: Privy's policies default-deny already, and an explicit wildcard `DENY` would outrank the `ALLOW` above and refuse the permitted transfer too — confirmed live, not assumed.

The door still opens — deliberately slowly. Releasing locked money early needs a typed reason, 3-of-5 approvals from phones, a live-human check on each approver, a 24-hour timer, and a permanent public record. A one-way door with an alarm, not a prison.

---

## The public solvency page

Nobody buys internal discipline; everybody buys something they can put on their homepage.

Because every obligation lives in an account that can only pay its own beneficiaries, "are they good for it?" becomes a subtraction anyone can perform. `bolt.app/acme` shows:

- what is owed and what is held, per obligation class
- the addresses holding it — click through to a block explorer, don't trust our UI
- **the coverage ratio as a line through time, not a dot** — proof of reserves gives you three points across ninety days; an indexed history gives you every block
- every early unlock ever performed, with its reason and its approvers
- a lookup where a beneficiary enters their email and sees their own balance and the address holding it

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system diagram and sequence diagrams.

```
Buyer pays  →  Privy webhook fires  →  splitter signs (inside its own policy)
            →  funds land in locked accounts  →  BoltRegistry emits events
            →  subgraph indexes  →  public page + Monitor agent read the index
```

Enforcement sits at the Privy policy boundary. The `BoltRegistry` contract custodies nothing — it is an append-only record of obligations, mandates and ceremonies, so that coverage is computable from chain data rather than from our database.

---

## Sponsor integrations

Three sponsors, three different jobs. **Privy constrains where money may go. World constrains who may start it moving. Arc is where the money lives.** Each section below answers that track's own qualification bullets, and every claim points at a transaction, an address or a file in [`docs/evidence/`](docs/evidence/).

Everything in this build runs on **Arc testnet** (chain `5042002`). Nothing is on a mainnet — Arc's is not publicly live yet. Details in the Arc section.

| Common address | |
|---|---|
| `BoltRegistry` | [`0x654713c0554cf3286e140C876E49F15B3F9dA0cd`](https://testnet.arcscan.app/address/0x654713c0554cf3286e140c876e49f15b3f9da0cd#code) |
| `BoltUnlockTimer` | [`0xda6528D75e1C576E36c17F7012A7f0ffAD49B82E`](https://testnet.arcscan.app/address/0xda6528d75e1c576e36c17f7012a7f0ffad49b82e) |
| USDC on Arc (also the native gas token) | `0x3600000000000000000000000000000000000000` |
| Subgraph | `https://api.studio.thegraph.com/query/1758871/bolt/v0.0.1` |

---

### Privy — the lock

> **Submitting for two Privy bounties: *Best B2B financial product* and *Best financial flow*.**

Privy is not a wallet vendor here. The Privy policy engine is the enforcement, and BOLT's entire claim collapses without it. Remove Privy and this is a spreadsheet with good intentions.

#### Best B2B financial product

| Their bullet | How BOLT meets it |
|---|---|
| **Integrate Privy as a core part of the product** | The policy is the product. A locked account's ability to pay an outsider does not exist, because the enclave refuses to reassemble the key. Nothing in our code makes that decision, and `/simulator` exists so you do not have to take our word for it. |
| **Create or use at least one Privy wallet** | A Privy **organization** per business with an org wallet tree — one wallet per account class — plus a **pregenerated wallet** per beneficiary and a **session signer** for the splitter. Live tree: [`phase2-summary.json`](docs/evidence/phase2-summary.json). |
| **Demonstrate a business or organization use case** | A marketplace holding sellers' money and a government's sales tax: three account classes, five quorum members, a finance lead, an auditor-readable public page. The problem only exists for organizations. |
| **At least one functional B2B workflow** | Four. **Treasury operation** — split on receipt, three transfers in 18.7 s from one deposit ([`phase3-summary.json`](docs/evidence/phase3-summary.json)). **Approval workflow** — 3-of-5 unlock ceremony with a 24-hour timer. **Wallet administration** — policy rotation behind a key quorum. **Payment** — beneficiary payout ([`phase8-summary.json`](docs/evidence/phase8-summary.json)). |
| **At least one Privy control** | Four. **Policies** with ABI-decoded calldata conditions · **session signers** (the splitter's own key is boxed to intra-business transfers, so a compromised splitter still cannot pay an outsider — proven, [`phase3-splitter-refusal.json`](docs/evidence/phase3-splitter-refusal.json)) · **key quorums** on every policy change · **intents** for the 3-of-5 approvals. |
| **Working demo and source code** | Public repo, plus a breach simulator at `/simulator` that hands a stranger the operator's seat on a real locked account holding real testnet USDC. |
| **Clearly explain how Privy enables the product** | By showing the refusal rather than describing it. Every refusal in this repo is Privy's raw error body, stored verbatim by `recordPolicyRefusal` and printed unedited — `{"error":"RPC request denied due to policy violation","code":"policy_violation"}`. |

**What we attacked it with.** Phase 0 spent a day trying to break one policy before anything was built on top of it; Phase 9 rebuilt the same suite as a public page. **Phase 0: 10 of 10 cases behaved exactly as documented. Phase 9's simulator: 9 of 9.** ([`phase0-summary.json`](docs/evidence/phase0-summary.json), [`phase9-simulator-summary.json`](docs/evidence/phase9-simulator-summary.json).)

Refused: wrong destination · native-value send instead of a token transfer · a *permitted* transfer with native value riding along · `approve` · `transferFrom` · hand-encoded dirty address padding to a wrong destination · trailing junk bytes appended to the calldata · the transfer wrapped in Arc's Multicall3From batcher.

Signed: the one permitted payee — and, in Phase 0, the same transfer with dirty address padding *to the permitted address*, which is the detail that shows the enclave decodes the calldata properly rather than pattern-matching the bytes.

The `approve` / `transferFrom` route is the one worth singling out: an allowance is how you route *around* a recipient constraint. Default-deny refused it on day one; the builder now also emits explicit `DENY` rules for both, because an explicit `DENY` cannot be widened by a later permissive rule.

**Widening the lock is as hard as spending from it.** Policy changes are owned by a key quorum, not by `PRIVY_APP_SECRET`. Attempted, not assumed: widening without a quorum was refused, with a quorum it succeeded ([`phase2-quorum-refusal.json`](docs/evidence/phase2-quorum-refusal.json)). There is no admin override and no dev-mode skip.

#### Best financial flow

| Their bullet | How BOLT meets it |
|---|---|
| **A complete, functional financial flow on a GA feature** | Buyer pays → webhook → mandate → session-signed split into locked accounts → obligation accrues on chain → beneficiary is paid out of the locked account → obligation settles and the public coverage line moves ([`phase8-coverage.json`](docs/evidence/phase8-coverage.json)). Every Privy leg ran live on Arc testnet; the one substituted response in that run is disclosed two rows down. |
| **Eligible flow type** | Transfers (the payout, tx [`0x53f21fd0…`](https://testnet.arcscan.app/tx/0x53f21fd0867dab745df3681e821ca15a9bdf12268d7ba6d6bb77ea090ba54148)) and bridging (CCTP to Base Sepolia, complete — see the Arc section). |
| **Hides unnecessary onchain complexity** | A seller receives a payout without a seed phrase, a gas balance, a chain picker or a bridge UI. The **pregenerated wallet** means their balance exists before they first sign in — [`phase8-pregenerated-wallet.json`](docs/evidence/phase8-pregenerated-wallet.json). A fresh Gmail address went from nothing to paid in one session. |
| **Mocked features do not count toward eligibility** | Nothing in the Privy path is mocked. No Privy Cards, no fiat, no simulated signer. The one substituted response anywhere in this repo is World's HTTP reply in Phase 8's payout run, and it is labelled in the evidence file and stated plainly in the World section below. |

The payout's important property: it is **permitted, not excepted**. The beneficiary's address is inside the same `transfer._to` allowlist that refuses everyone else — the same account, the same policy, the same check, in the same millisecond of the flow. A payout to a non-beneficiary from that account was attempted in the same run and refused.

---

### Arc — the rail

> **Submitting for: Arc — *Best DeFi/Onchain Finance Application*.**
>
> We are **not** submitting to *Launch on Arc Testnet & Push to Mainnet*, because we cannot honestly claim the mainnet half. See below.

| Their bullet | How BOLT meets it |
|---|---|
| **Meaningful use of Arc and USDC** | Arc is where the money lives, not a stop on a route. Every balance, every split, every reserve, every payout and every contract is USDC on Arc. The `value == 0` condition in every policy exists *because* of Arc specifically: USDC is Arc's native gas token, so a `transfer()` call could otherwise carry native value moving the same underlying balance alongside it. |
| **Advanced programmable money flows** | **Conditional payment** — a wallet that can only pay one decoded recipient. **Automation** — deposits split themselves on arrival from a webhook, no human in the path. **Multi-step settlement** — receipt → split → obligation accrual → early-release ceremony or beneficiary payout → settlement, each step emitting to `BoltRegistry`. |
| **Payment, liquidity or treasury workflows** | Segregation of client money, reserving against institutional obligations (tax, payroll), and a yield setting that is on for `OBLIGATION_RESERVE` and structurally off for `CLIENT_MONEY`. |
| **Functional MVP, frontend and backend, architecture diagram** | Next.js 15 app (public page, dashboard, claim flow, simulator) + API routes, webhook handlers, a Hardhat/viem contract suite, a subgraph and an agent. Diagrams in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). |
| **Video demonstration and documentation** | Day 11 of the plan. |
| **GitHub repo link** | This repository. |

**Deployment status — stated precisely, because this is the easiest thing in the submission to overclaim.**

`BoltRegistry` and `BoltUnlockTimer` are deployed and verified on **Arc testnet**. They are **not** on Arc mainnet, and BOLT does not claim to be. Arc's mainnet is not publicly live: re-checked against `arc-docs` on 2026-09-11, `/arc/concepts/deployment-model.mdx` lists Private Mainnet and Public Mainnet as *Upcoming*, and `/arc/references/rpc-endpoints.mdx` says mainnet endpoints and parameters are published separately when available. There is no chain id or RPC to point at, and we did not invent one.

What exists instead is a rehearsed mainnet path. The `arcMainnet` Hardhat network and `pnpm contracts:deploy:mainnet` were run end to end with `ARC_MAINNET_RPC_URL` / `ARC_MAINNET_CHAIN_ID` supplied — a real deploy transaction, a real receipt, a real contract address — so the code path is exercised rather than asserted. That run used testnet parameters through the mainnet entry, and its evidence file says so in capitals. Substituting Circle's published values is the only change needed. With both variables unset the script exits 1 rather than silently deploying somewhere unintended. [`phase9-arc-mainnet-readiness.json`](docs/evidence/phase9-arc-mainnet-readiness.json).

**Arc App Kit — `@circle-fin/bridge-kit`, in the beneficiary's withdrawal leg.** The App Kit is deliberately *not* on the payout leg. That transaction is signed in Privy's enclave against a policy that decodes `transfer._to`, and handing its construction to another SDK would move the exact calldata the policy checks away from the file responsible for it, for no gain. Once the money is the beneficiary's, moving it off Arc is a bridging problem — and hand-rolling CCTP's burn → attestation → mint is precisely what an App Kit exists to remove. Same `kit.bridge()` call in both places; the claim page's button signs with the beneficiary's Privy embedded wallet, the terminal-verifiable run signs with a key adapter. Reasoning and transcript: [`phase8-cctp.json`](docs/evidence/phase8-cctp.json).

**CCTP (FR-8.4, MAY priority) — complete.** Arc → Base Sepolia, 0.50 USDC, all four steps live: `approve` and `burn` on Arc ([`0xdf3a992f…`](https://testnet.arcscan.app/tx/0xdf3a992f15a6a443d1a4785f68117823a12c90180a8d09f47ecd07c4d73b7907)), a real Circle attestation for the burn, and the mint on Base Sepolia ([`0xde005e63…`](https://sepolia.basescan.org/tx/0xde005e63c3135626551630e0f881cf2d32b425b80124fc88a11febc3e0e29562)) — confirmed by an independent `balanceOf` read against the destination USDC contract, not just the script's own report. An earlier attempt reverted with `BALANCE_INSUFFICIENT_GAS` because the destination address held no Base Sepolia ETH; that was a funding gap on our side, not a code, Arc, or Circle failure, and it is fixed.

---

### World — the gate

> **Submitting for: World — *Selfie Check*.**

Money leaves a locked account exactly two ways: an early unlock ceremony, or a payout to a beneficiary. Selfie Check guards both, and there is no third exit.

| Their bullet | How BOLT meets it |
|---|---|
| **Uses Selfie Check in a meaningful way** | It gates every unlock approval (FR-5.3), every beneficiary first claim (FR-8.6) and every withdrawal-address change or unrecognised device (FR-8.7). It is not a login skin on one screen: remove it and both exits from a locked account become script-triggerable, because Privy's policy constrains the destination and says nothing whatever about who asked. |
| **Treats it as a risk / eligibility / fairness / continuity / abuse-prevention signal** | Three of the five, each doing a distinct job. **Abuse prevention** on unlock approvals — a stolen session or a script cannot stand in for a person at the one moment locked money legitimately moves. **Eligibility** on a first claim — a live person, not a script, is behind the account holding someone else's money. **Continuity** on an address change — the anti-account-takeover control, so a stolen session cannot silently redirect a seller's balance. |
| **Includes a feedback document** | [`docs/WORLD_FEEDBACK.md`](docs/WORLD_FEEDBACK.md) — four headed sections covering documentation and integration flow, Developer Portal navigation/search/discovery/debugging, Sandbox states/proofs/test users/errors/edge cases, and what was confusing, missing, broken or hard to test. Written during Phases 6 and 8, at the point each piece of friction was hit, not retrofitted at the end. Section (d) alone carries eight specific, reproducible findings — among them a verifier whose error codes appear nowhere in the published error-code reference, an unknown `rp_id` reported as one needing migration, and an IDKit WASM loader that cannot initialise under Node at all. |
| **Shows a working app** | The unlock ceremony and the beneficiary claim flow both run, with the Selfie Check gate in the path — subject to the honest limit stated immediately below. |

**What is proven, and what is not.** This matters more than any other sentence in this README, so it is spelled out.

*Proven live against World's real infrastructure:* the credentials (`app_c1634cdf…`, `rp_2b39e68a…`) are real and registered. `signRequest()` produces a valid RP signature with the real signing key. World's Sandbox bridge **accepts that signature and holds a real Selfie Check request** for our action — `pollOnce()` returns `waiting_for_connection`, which it would not if the app id, RP id, signing key and action were not all correct together. `POST /api/v4/verify/{rp_id}` recognises our RP, and rejects an unregistered one differently, which is a device-free proof the RP exists and is migrated to World ID 4.0. Two distinct actions are used — `bolt-unlock-approval` and `bolt-beneficiary-claim` — so a beneficiary's nullifier is never in the same scope as a quorum approver's, and World's bridge accepted a real request for each. (Notably the second needed no Developer Portal step, which is itself written up as a finding in the feedback document.) [`phase6-world-credentials-live.json`](docs/evidence/phase6-world-credentials-live.json), [`phase8-world-action-probe.json`](docs/evidence/phase8-world-action-probe.json).

*Proven live, negative path:* an approval without a completed Selfie Check does not count toward the quorum, and a first claim without one does not pay out. Both are refused before a transaction is built, so Privy is never reached and no signature can exist.

***Proven live, positive path (a beneficiary's first claim):*** a real person, on a real phone running the Sandbox World ID app, completed a real Selfie Check — proof reference [`0x232b6fd1…`](docs/evidence/phase8-payout.json) — and it correctly gated a real payout: [`0x1d63c344…`](https://testnet.arcscan.app/tx/0x1d63c344c26ba2bd324606f79a770d164329f02fff86b7f411afd844c51a80b3) on Arc testnet, `ObligationSettled` at [`0x806fe496…`](https://testnet.arcscan.app/tx/0x806fe496b4310143a447c8aed83ec72fe8d9042250320fa3d249baa58db51a10). `phase8-summary.json`'s `world_selfie_check_mode` reads `"LIVE — a real Selfie Check completed on a device, verified by World's verifier."` The repeat withdrawal to that same address afterward needed no fresh check (FR-8.8), also live.

**Not yet done:** the full 3-of-5 unlock ceremony has not been run with three real device checks (`pnpm --filter @bolt/privy phase6:ceremony` — it prints one connect URL per approver). And one secondary sub-check — a payout to a non-beneficiary being refused *by Privy's policy specifically*, once past the World gate — did not complete in the live run: requesting a second Selfie Check for that scenario got an HTTP 500 from World's sandbox mid-run, so the attempt was correctly refused by the World gate instead (no valid check on file), but Privy's own policy was never reached to prove it separately.

Two consequences we did not paper over: the approver table on the public page renders the Selfie Check proof reference for each approval and **stays empty** until real `UnlockApproved` events exist, rather than being filled with placeholder data. And two questions in `WORLD_FEEDBACK.md` — whether a Sandbox proof's `environment` field is accepted verbatim, and whether World refuses a repeat nullifier for the same action — are written down as open, because only a real proof can settle them.

**A design choice worth defending.** The check is deliberately *not* on every withdrawal (FR-8.8). World describes Selfie Check as low-friction and low-assurance, and we treat it that way: it establishes a person at the moments that matter and then gets out of the way. Gating every routine payout to an address the beneficiary already verified would have made the flow worse without making it safer.

---

### The Graph — implemented, not submitted

**We are not entering either Graph bounty.** No prize is claimed here and nothing in this section is a qualification argument.

The subgraph and the Solvency Monitor are in the build because the product needs them. Coverage *through time* is BOLT's central claim, and an index is the only way to compute it — delete The Graph and the public page shows only "now", which is exactly the weakness the pitch attacks. The subgraph is deployed to Subgraph Studio, synced on Arc testnet, and indexes `BoltRegistry` events alongside real USDC `Transfer` logs so *held* is chain-derived rather than reported.

Because there is no Graph scorecard to satisfy, several things the plan once contemplated are simply absent: no ERC-4626 vault refactor, no Substreams module, no separate Graph film, no pool declaration. That capacity went to World and to the Arc App Kit instead.

The **Solvency Monitor** (`apps/monitor`) reads only the deployed subgraph, with a real API key. Three of its four capabilities work live:

- **Mandate drift** (FR-7.3) — the compromised-backend detector, and the strongest single piece of evidence in this build. A Privy policy constrains *where* money goes and says nothing about *how much*, so a splitter quietly paying 83% to client money instead of 88% passes every policy check, and `held` still equals `owed`, so the coverage line never dips. Nothing else in BOLT can see it. We deliberately misconfigured the real splitter, ran real deposits through it on Arc, and the Monitor caught it from indexed history alone — naming the divergent transactions, the per-account basis-point deltas and the exact 0.20 USDC that went somewhere the baseline ratio does not put it. [`phase7-findings-acme-marketplace.json`](docs/evidence/phase7-findings-acme-marketplace.json). It also found a real defect we had not planted: deposits claiming a `mandateVersion` the chain had never ratified.
- **Shortfall forecast** (FR-7.2) — days of cover remaining per class, from observed flows.
- **Anomaly detection** (FR-7.4) — unlock frequency and size against this business's own baseline.
- **Natural-language endpoint** (FR-7.5) — **live.** `GET /ask` assembles the full evidence bundle from the subgraph and hands it to an LLM (via OpenRouter's OpenAI-compatible endpoint, model `nvidia/nemotron-3-ultra-550b-a55b:free`) to reason over. Asked live, unprompted, "was the mandate ever violated, and if so by how much?" — it answered correctly, citing the real deposit blocks and transaction hashes and computing the exact 0.20 USDC misallocated, without being told any of that in advance. Without `OPENROUTER_API_KEY` set the endpoint returns 503 **with the assembled bundle attached**, so the gap is visible rather than papered over when the key is missing — it just isn't missing here.

**Deliberately not used:** Chainlink Proof of Reserve. Integrating a proof-of-reserves oracle would contradict the thesis — our claim is that a capability which does not exist needs no attestation.

Per-sponsor requirement traceability, with FR identifiers, is in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md#5-track-traceability).

---

## What is *not* claimed

BOLT provides **technical enforcement and public verifiability**. It is not a compliance product and using it does not make anyone MiCA-compliant. MiCA Article 70 is cited as evidence that demand for segregation exists, never as a compliance claim.

Three things this build does **not** claim, collected here so nobody has to find them:

- **Not deployed on any mainnet.** Arc testnet only. Arc's mainnet is not publicly live; the deploy path is rehearsed, not used.
- **A human has completed a Selfie Check for a beneficiary's first claim** (a real payout, gated by it, on Arc testnet — see the World section). **The full 3-of-5 unlock ceremony has not yet been run with three real device checks**, and one secondary sub-check (a payout to a non-beneficiary being refused *by Privy specifically*, as opposed to by the World gate) did not complete in the one live run so far — World's sandbox returned an HTTP 500 on that particular request mid-run.

Each is explained where it belongs in the sponsor sections above.

The `BoltRegistry` records what the splitter reports as owed. A compromised backend could under-report an obligation — but it cannot drain a locked account (that is policy, not server logic), cannot change split ratios (quorum-governed), and any divergence between `deposit × mandate ratio` and the recorded obligation is detectable, which is one of the things the Monitor watches for. This limitation is stated plainly rather than hidden.

---

## Quick start

```bash
git clone <repo> && cd bolt
pnpm install
cp .env.example .env        # fill in — see below
pnpm db:push
pnpm contracts:deploy       # BoltRegistry → Arc testnet
pnpm subgraph:deploy        # → Subgraph Studio
pnpm dev                    # http://localhost:3000
```

`BoltUnlockTimer` (the 24-hour cool-off, FR-5.4) deploys separately with `hardhat run scripts/deploy-unlock-timer.ts --network arcTestnet`. Both contracts are already deployed and verified on Arc testnet — the addresses in `.env.example` are live, so a clean clone can skip both deploys and read the same chain everything else in this README points at.

### Environment

[`.env.example`](.env.example) is the authoritative list, with a comment per variable explaining where it comes from and which phase needs it. The ones worth knowing about before you start:

| Variable | Where from |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Privy dashboard. Only the first crosses into a client bundle. |
| `PRIVY_AUTHORIZATION_KEY` | Privy dashboard — key-quorum signing for server-side wallet and policy actions |
| `PRIVY_WEBHOOK_SECRET` | Privy dashboard — deposit webhook signing |
| `PRIVY_SPLITTER_AUTHORIZATION_KEY` | the splitter's session-signer key (FR-3.3) |
| `SIMULATOR_AUTHORIZATION_KEY` | the `/simulator` sandbox quorum's key. Owns the sandbox and nothing else. |
| `ARC_RPC_URL`, `ARC_CHAIN_ID` | `arc-docs` — testnet. `ARC_MAINNET_*` stay blank; Arc mainnet is not published. |
| `USDC_ADDRESS` | Circle — Arc testnet USDC, which is also Arc's native gas token |
| `REGISTRY_ADDRESS`, `UNLOCK_TIMER_ADDRESS` | output of the two deploy scripts; live values are in `.env.example` |
| `DATABASE_URL` | any Postgres |
| `GRAPH_API_KEY`, `SUBGRAPH_URL` | Subgraph Studio |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | the Monitor's `/ask` route only (OpenRouter, swapped from Anthropic). Everything else in the Monitor works without it. |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ACTION_ID`, `WORLD_ENVIRONMENT` | World Developer Portal. IDKit 4.x needs all four values, not the two the original plan assumed — see `WORLD_FEEDBACK.md` §(b). |
| `CIRCLE_API_KEY` | Circle. Not required for the CCTP route itself — `@circle-fin/bridge-kit` does not need one. |

Testnet USDC and gas come from the Circle and Arc faucets. Privy's free tier and The Graph's free query allowance both cover this project comfortably.

---

## Try to break it

The **breach simulator** at `/simulator` hands you full operator privileges on a sandbox business and invites you to steal from it. Real Privy organization, real locked account, real USDC on Arc testnet, real policy. Paste your own address, pick an attack, and read whatever the enclave says — verbatim, not our error page.

This is the most persuasive thing in the repository, because it does not require believing anything we wrote above. The ninety-second walkthrough is scripted and timed in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

The sandbox is its own Privy organization under its own key quorum. The credential that page holds cannot authorize anything against a real business's wallet — attempted rather than assumed, in [`phase9-simulator-isolation.json`](docs/evidence/phase9-simulator-isolation.json).

---

## Repository map

| Path | What |
|---|---|
| `apps/web` | Dashboard, public solvency page, API routes, webhook handlers |
| `apps/monitor` | Solvency Monitor agent |
| `packages/privy` | Policy builders — **the calldata-decoding rule lives here** |
| `packages/core` | Mandate engine, coverage math, shared types |
| `packages/db` | Drizzle schema |
| `contracts` | Hardhat + viem — `BoltRegistry.sol`, `BoltUnlockTimer.sol` |
| `subgraph` | Schema, mappings, manifest |
| `docs` | Architecture, requirements, phase plan, World feedback, evidence |

---

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — invariants and working rules for contributors
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — functional requirements and sponsor traceability
- [`docs/PHASES.md`](docs/PHASES.md) — build phases with exit criteria and the cut order
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — diagrams and data model
- [`docs/WORLD_FEEDBACK.md`](docs/WORLD_FEEDBACK.md) — World integration feedback, four sections, written during the build
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — the judge-holds-the-keys walkthrough, scripted and timed
- [`docs/evidence/`](docs/evidence/) — raw transcripts behind every claim above: transaction hashes, receipts, and Privy's unedited refusals
- [`apps/monitor/README.md`](apps/monitor/README.md) — what the Solvency Monitor looks for and how to run it

---

> We didn't prove the money is safe. We removed the ability to move it, and put the proof on a page anyone can check.
