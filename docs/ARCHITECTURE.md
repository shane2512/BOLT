# Architecture

**BOLT** — **B**eneficiary-**O**nly **L**edger **T**ransfers.

## Why Mermaid rather than UML

Mermaid, for four practical reasons:

1. **It renders where the diagrams live.** GitHub renders Mermaid natively in Markdown, so `README.md` and this file show the real picture to a judge who never clones the repo. PlantUML needs a server or a build step, and a diagram nobody renders is a diagram nobody reads.
2. **It is version-controlled text.** Diffs are reviewable. A PNG exported from a UML tool goes stale the first time the design changes and nobody notices.
3. **The two diagrams we actually need are Mermaid's strongest forms** — a flowchart for the system and a `sequenceDiagram` for the flows. We are not modelling class hierarchies or inheritance, which is where UML earns its complexity.
4. **Zero tooling.** No install, no plugin, no export step, during a week where every hour matters.

---

## 1. System architecture

The thing to read first: the **Privy box is a boundary, not a service**. Everything above it can be compromised — our servers, our database, our dashboard — and the locked accounts still cannot pay an outsider, because the refusal happens inside the enclave before a signing key exists.

```mermaid
flowchart TB

  subgraph PEOPLE["People"]
    direction LR
    BUYER["Buyer<br/>pays the business"]
    FIN["Finance lead<br/>writes the split rules"]
    APPR["Approvers<br/>3 of 5, on phones"]
    BEN["Beneficiary<br/>never owned a wallet"]
    ANYONE["Anyone<br/>customer, auditor, journalist"]
  end

  subgraph APP["BOLT application — Next.js"]
    direction TB
    DASH["Business dashboard"]
    PUBPAGE["Public solvency page<br/>/acme"]
    SIM["Breach simulator<br/>/simulator"]
    HOOK["Deposit webhook handler<br/>idempotent on tx hash"]
    SPLITTER["Splitter service"]
    MANDATE["Mandate engine<br/>bps must total 10000"]
    CEREMONY["Unlock ceremony service"]
    PG[("Postgres<br/>config and workflow state only")]
  end

  subgraph PRIVY["PRIVY — the enforcement boundary"]
    direction TB
    POLICY["Policy engine<br/>decodes calldata<br/>constrains transfer._to<br/>default-deny · explicit DENY on approve and transferFrom"]
    ORGW["Organization wallets"]
    SESS["Session signer<br/>the splitter's key<br/>boxed by its own policy"]
    QUORUM["Key quorums and intents<br/>3 of 5"]
    PREGEN["Pregenerated wallets"]
  end

  subgraph ARC["ARC testnet — USDC settlement · Hardhat and viem"]
    direction TB
    OPACC["Operating account<br/>UNLOCKED — the firm's own money"]
    CM["Client money<br/>LOCKED — owed to named people"]
    RES["Obligation reserve<br/>LOCKED — owed to institutions"]
    REG["BoltRegistry<br/>custodies nothing<br/>records obligations, mandates, ceremonies"]
    TIMER["BoltUnlockTimer<br/>a SECOND contract, deliberately not part of BoltRegistry<br/>UNLOCK_DELAY = 24h, compiled in, no setter<br/>arm on final approval · release only after the window"]
  end

  subgraph GRAPH["THE GRAPH — the proof layer"]
    direction TB
    SG["BOLT subgraph<br/>deployed via Subgraph Studio"]
    SNAP["CoverageSnapshot<br/>written at every changed block"]
  end

  MON["Solvency Monitor agent<br/>forecast · drift · anomaly — all live<br/>plain-language answers: live, via OpenRouter"]
  WORLD["World Selfie Check<br/>who may start money moving"]
  CCTP["Circle CCTP<br/>via @circle-fin/bridge-kit — Arc's Bridge App Kit<br/>the beneficiary's own leg, not the payout leg"]

  BUYER -->|"pays USDC"| OPACC
  OPACC -.->|"deposit event"| HOOK
  HOOK --> MANDATE
  MANDATE --> SPLITTER
  SPLITTER -->|"asks to sign"| SESS
  SESS -->|"checked by"| POLICY
  POLICY -->|"permitted: split"| CM
  POLICY -->|"permitted: split"| RES
  SPLITTER -->|"records obligations"| REG

  FIN --> DASH
  DASH -->|"publish mandate — needs quorum"| QUORUM
  QUORUM --> REG

  DASH -->|"request early release"| CEREMONY
  CEREMONY -->|"collect 3 of 5"| QUORUM
  APPR -->|"approve on phone"| QUORUM
  APPR -->|"prove a live human"| WORLD
  WORLD -->|"abuse prevention: approval counts"| CEREMONY
  CEREMONY -->|"arm on final approval"| TIMER
  TIMER -->|"release, only after 24h"| CEREMONY
  CEREMONY --> REG

  BEN -->|"familiar login, no seed phrase"| PREGEN
  BEN -->|"first claim / address change"| WORLD
  WORLD -->|"eligibility + continuity"| CM
  PREGEN --> ORGW
  CM -->|"payout — inside the policy, not an exception"| BEN
  BEN -->|"withdraw to another chain"| CCTP

  REG -->|"events"| SG
  TIMER -.->|"executableAt, readable by anyone"| PUBPAGE
  CM -.->|"balances"| SG
  RES -.->|"balances"| SG
  SG --> SNAP
  SNAP -->|"coverage over time"| PUBPAGE
  SNAP -->|"live queries, real API key"| MON
  MON -->|"severe alerts"| PUBPAGE
  ANYONE --> PUBPAGE
  ANYONE -->|"asks a question in English"| MON
  ANYONE -->|"try to steal"| SIM
  SIM -->|"attempts a forbidden transfer"| POLICY
  POLICY -->|"raw enclave refusal"| SIM

  DASH --- PG
  CEREMONY --- PG
  HOOK --- PG

  ORGW --- OPACC
  ORGW --- CM
  ORGW --- RES

  classDef locked fill:#f6dfdb,stroke:#a33527,stroke-width:2px,color:#3a1610
  classDef boundary fill:#f3e8ce,stroke:#8a6414,stroke-width:3px,color:#2e2408
  classDef proof fill:#dcede4,stroke:#1f6b4e,stroke-width:2px,color:#0f2b20
  class CM,RES locked
  class POLICY,SESS,QUORUM boundary
  class SG,SNAP,MON proof
```

### Reading it in one paragraph

A buyer pays into the **operating account**, the only account the business can freely spend from. A Privy webhook fires; the mandate engine works out the split; the splitter asks a **session signer** to move funds into the locked accounts — and that signer is itself boxed by a policy limiting it to intra-business transfers, so a compromised splitter cannot pay an outsider either. Every obligation, mandate and ceremony is recorded to `BoltRegistry`, which holds no money and exists only so the numbers can be recomputed from chain data instead of from our database. The **subgraph** indexes those events alongside real USDC balances and writes a `CoverageSnapshot` whenever anything changes — that series is what draws the coverage line and what the **Monitor** reasons over. Releasing locked money early goes through a key quorum, a live-human check and a timer, never through application code — and the timer is its own contract, `BoltUnlockTimer`, rather than a `require` inside `BoltRegistry`, because changing `BoltRegistry` would mean a new address, a new manifest and the loss of every block of coverage history already indexed. **Privy constrains where money may go; World constrains who may start it moving** — two independent gates on the only two exits from a locked account.

Two things the picture cannot show, so they are said here. Everything above runs on **Arc testnet**; no part of it is deployed to a mainnet. And the World box is the one place where the *positive* path has not been exercised end to end — the credentials, the bridge request and the refusal path are live, but no human has completed a Selfie Check in this build, because there is no way to do so without a physical device. Both are stated at length in the README rather than left to be discovered.

---

## 2. Sequence — the full lifecycle

This is also the demo, beat for beat. Read it as the user flow: money arrives, gets segregated, someone tries to steal it and fails, a legitimate release happens the slow way, and a beneficiary who has never owned a wallet gets paid.

```mermaid
sequenceDiagram
    autonumber
    actor Buyer
    actor Operator as Operator, holding full keys
    actor Approvers as Approvers, 3 of 5
    actor Ben as Beneficiary
    actor Public as Anyone

    participant App as BOLT app
    participant Policy as Privy policy engine
    participant Wallets as Privy wallets on Arc
    participant Reg as BoltRegistry
    participant Timer as BoltUnlockTimer
    participant Sub as Subgraph
    participant Mon as Solvency Monitor
    participant World as World Selfie Check

    rect rgb(240,246,243)
    Note over Buyer,Sub: BEAT 1 — money arrives and is segregated within seconds
    Buyer->>Wallets: pay 100 USDC to the operating account
    Wallets-->>App: deposit webhook, idempotent on tx hash
    App->>App: look up active mandate version
    App->>Policy: sign 3 transfers, via the session signer
    Policy->>Policy: decode calldata, check transfer._to
    Policy-->>Wallets: permitted — all 3 are intra-business
    Wallets->>Wallets: 88 client money · 4 reserve · 8 operating
    App->>Reg: DepositObserved, SplitExecuted, ObligationAccrued
    Reg-->>Sub: events indexed
    Sub->>Sub: write CoverageSnapshot
    end

    rect rgb(250,238,236)
    Note over Operator,Policy: BEAT 2 — the operator is handed full privileges and told to steal
    Operator->>App: pay myself from the client money account
    App->>Policy: sign transfer to attacker address
    Policy->>Policy: decode calldata — transfer._to not a verified beneficiary
    Policy--xApp: REFUSED, key never reassembled
    App-->>Operator: raw enclave error, shown verbatim
    Operator->>App: then widen the policy
    App->>Policy: policy change requires a key quorum
    Policy--xOperator: REFUSED, no quorum
    Note right of Policy: our own backend has no vote here
    end

    rect rgb(240,246,243)
    Note over Public,Mon: BEAT 3 and 4 — verification, without trusting anyone
    Public->>Sub: open the public solvency page
    Sub-->>Public: owed vs held, addresses, coverage line over 30 days
    Public->>Public: click through to a block explorer, check the balance
    Public->>Mon: was this business ever short in August
    Mon->>Sub: live GraphQL over indexed history
    Sub-->>Mon: CoverageSnapshot series
    Mon-->>Public: answer with dates and block numbers
    end

    rect rgb(250,245,231)
    Note over Approvers,Reg: BEAT 5 — the door opens, deliberately slowly
    Operator->>App: request early release, with a typed reason
    App->>Reg: UnlockRequested, reason hash on chain
    App-->>Approvers: push notification to phones
    Approvers->>World: prove a live human is present
    World-->>App: proof references, recorded publicly
    Approvers->>Policy: approve, as Privy intents
    Policy->>Policy: 3 of 5 reached
    App->>Timer: arm(unlockId) — clock starts at the final approval
    Timer-->>App: executableAt = armedAt + 24h, readable by anyone
    App->>Timer: release(unlockId) — reverts before the window
    Policy-->>Wallets: release permitted
    App->>Reg: UnlockApproved x3, UnlockExecuted
    Reg-->>Sub: indexed
    Sub-->>Public: unlock appears publicly with its reason, under 60s
    end

    rect rgb(240,246,243)
    Note over Ben,Sub: BEAT 6 — a seller who never owned a wallet gets paid
    App->>Wallets: pregenerate a wallet bound to the seller email
    Ben->>App: sign in with a familiar login
    App-->>Ben: balance already there. no seed phrase, no gas
    Ben->>World: first claim — prove a live human
    World-->>App: eligibility established
    Ben->>App: withdraw
    App->>Policy: transfer from client money to the seller
    Policy->>Policy: transfer._to is a verified beneficiary
    Policy-->>Wallets: permitted — inside the rule, not an exception
    App->>Reg: ObligationSettled
    Reg-->>Sub: obligations fall, coverage line updates
    end
```

### The one line to take from it

Beat 2 and beat 6 touch the **same locked account**. In one it refuses, in the other it pays. The difference is not who asked, or how senior they were, or what our application decided — it is **whether the decoded recipient is a permitted payee**. That check happens in the same place both times, and our code is not in the room for it.

---

## 3. The unlock ceremony, as states

The only path by which locked money moves early. Every transition is either quorum-enforced or time-enforced; none is enforced by application logic.

```mermaid
stateDiagram-v2
    [*] --> Drafted: operator opens a request

    Drafted --> Requested: reason typed, hash written on chain
    Drafted --> [*]: abandoned

    Requested --> Collecting: pushed to approver phones
    Collecting --> Collecting: approval 1 of 3, after Selfie Check
    Collecting --> Collecting: approval 2 of 3, after Selfie Check
    Collecting --> Approved: approval 3 of 3, quorum reached

    Collecting --> Cancelled: any approver objects
    Requested --> Cancelled: withdrawn

    Approved --> Waiting: BoltUnlockTimer.arm — 24h clock starts
    Waiting --> Executable: BoltUnlockTimer.release succeeds
    Waiting --> Cancelled: cancelled during the window

    Executable --> Executed: funds released, UnlockExecuted emitted
    Executed --> Published: visible on the public page, within 60 seconds
    Published --> [*]

    Cancelled --> [*]

    note right of Collecting
        Fewer than 3 approvals
        can never reach Approved.
        Enforced by the key quorum,
        not by our server.
    end note

    note right of Published
        Every unlock is permanent
        and public, with its reason
        and its approver set.
    end note
```

---

## 4. Data model in brief

| Where | Holds | Trust |
|---|---|---|
| **Privy policies** | The rules about where money may go | The enforcement. Nothing above it can override it. |
| **Arc / USDC** | The money itself | Chain state. Independently verifiable. |
| **BoltRegistry** | Obligations, mandate versions, ceremonies, refusal-worthy facts | Append-only. Written by the splitter, so it is trusted *for accrual* — see the honesty note below. |
| **BoltUnlockTimer** | One `Timer{armedAt, executableAt, released}` per unlock id | A separate contract. `UNLOCK_DELAY` is a compiled-in constant with no setter and no owner override, so the delay is a public commitment rather than a policy we administer. |
| **Subgraph** | Everything above, joined and time-indexed | Derived. Recomputable by anyone from chain data. |
| **Postgres** | Config, drafts, workflow state, stored refusals | Convenience only. **No figure on the public page comes from here.** |

The subgraph's entity set, as deployed: `Business`, `Account`, `PolicyRotation`, `Mandate`, `Deposit`, `Split`, `Obligation`, `ObligationSettlement`, `Unlock`, `Approval`, `RecorderChange`, `UsdcTransfer`, `ClassPosition`, `CoverageSnapshot`. Three of those were not in the original plan and earn their place: `UsdcTransfer` indexes real USDC `Transfer` logs to and from registered accounts, so *held* is chain-derived rather than reported; `ClassPosition` carries owed-versus-held per account class; and `ObligationSettlement` separates settlement events from the obligations they close. `CoverageSnapshot` is still what draws the line in FR-6.4 and what the Monitor reasons over.

### The honest limitation

`BoltRegistry` records what the splitter reports as owed, so a compromised backend could under-report an obligation and make coverage look better than it is. What it *cannot* do: drain a locked account (policy, not server logic), change split ratios (quorum-governed), or hide the discrepancy — because the recorded obligation should equal `deposit × mandate ratio`, and the Monitor's drift check (FR-7.3) exists precisely to catch that divergence.

We state this in the README rather than hoping nobody asks.

---

## 5. Deployment

| Component | Runs on |
|---|---|
| `apps/web` | Vercel — dashboard, public page, API routes, webhook receiver |
| `apps/monitor` | A long-running host, or a cron loop plus a public endpoint for the question interface |
| `contracts` | Hardhat + viem. **Arc testnet** — both `BoltRegistry` and `BoltUnlockTimer`. See the note below on mainnet. |
| `subgraph` | Subgraph Studio |
| Postgres | Any managed instance |

**On Arc mainnet.** Nothing is deployed to it, and nothing can be: `arc-docs` lists Private Mainnet and Public Mainnet as *Upcoming* and says mainnet endpoints and parameters are published separately when available (re-checked 2026-09-11). The `arcMainnet` Hardhat network and `pnpm contracts:deploy:mainnet` exist and were exercised end to end — a real deploy transaction and receipt, using testnet parameters through the mainnet entry, to prove the path rather than assert it. With `ARC_MAINNET_RPC_URL` / `ARC_MAINNET_CHAIN_ID` unset the script exits 1 instead of quietly deploying somewhere unintended. Evidence: `docs/evidence/phase9-arc-mainnet-readiness.json`.

Webhook delivery needs a public URL, so tunnel it in local development rather than polling — the sub-30-second split in FR-3.7 is a demo beat, and polling makes it feel slow.
