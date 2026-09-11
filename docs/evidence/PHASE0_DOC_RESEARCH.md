# Phase 0 — Privy documentation research

**Date:** 2026-09-07
**Source:** `privy-docs` MCP server (`https://docs.privy.io/mcp`) only. No credentials used, no API called, no code written.
**Scope:** documentation research to answer the Phase 0 go/no-go question *before* the live spike.

---

## Verdict: **GO — WITH CAVEATS**

The core assumption holds. Privy's policy engine has a first-class `ethereum_calldata` field source that decodes calldata against an ABI **you supply** and lets a condition compare a **named function argument** — including an ERC-20 `transfer`'s recipient. Enforcement is documented as happening in the secure enclave, and a denial produces a distinct, programmatically inspectable `policy_violation` error. Invariant 2 is implementable as specified.

Four caveats, in order of how much they could hurt:

1. **`transfer._to` is not a fixed Privy field name — it is whatever the ABI you pass names that parameter.** CLAUDE.md's `ethereum_calldata.transfer._to` is *valid*, but only if the policy supplies an ABI whose first input is literally named `_to`. Privy's own current examples use viem's `erc20Abi`, whose transfer inputs are named `recipient`/`amount`, giving `transfer.recipient`. **This must be pinned down by the policy builder itself** (see Finding 1).
2. **Arc is not named anywhere in Privy's documentation.** Not in the chain tier list, not in any recipe. Privy lists "Ethereum — *Includes EVM-compatible networks*" at Tier 3, and policies need only Tier 2, but whether Privy will *broadcast* on Arc is unverified. Mitigation exists (`eth_signTransaction` + self-broadcast) — see Finding 5c. **This is the single biggest live-spike risk and must be tested on day 1.**
3. **Production webhooks are an Enterprise feature.** Dev-environment webhooks are free. Phase 3's deposit webhook is fine on testnet; a "production" claim is not.
4. **Dashboard "Manual approvals" is Enterprise.** The **Intents API is not** — it is documented as the self-serve primitive that manual approvals is built on. Phase 6's 3-of-5 ceremony should be built on the Intents API, not on dashboard approvals.

Nothing here requires a concept change. Phase 0's live spike proceeds.

---

## Finding 1 — Policy condition grammar and the decoded-recipient field path

**Source:** `/controls/policies/overview.mdx` (Conditions → Field), `/controls/policies/example-policies/ethereum.mdx` (Configure a max transfer value of an ERC20 token)

The capability exists and is documented. A condition is:

```
{ field_source, field, abi?, operator, value }
```

`field_source` is an enum that includes `'ethereum_transaction'` and `'ethereum_calldata'` as **distinct** sources. On `ethereum_calldata`, the docs say verbatim:

> The decoded calldata in a smart contract interaction, with fields representing both the function name and, if applicable, function arguments. Note: `'ethereum_calldata'` conditions must always include an `abi` parameter with the contract's JSON ABI—even for functions with no input parameters (such as `deposit()`). The value of `field` can be just the function name (e.g., `function_name`) to match any call to a given function, or the function name plus argument (e.g., `function_name.param_name`) to match a specific parameter.

Its listed example fields are:

> `function_name` (e.g., allow any call to `deposit()`), `function_name._to`, `function_name._value` (for ERC20 and similar interactions)

### The exact field path — and the trap

The path is `<abi function name>.<abi input name>`. **Both halves come from the ABI JSON the policy supplies**, not from a Privy-side registry. Privy's ERC-20 example is explicit in a code comment:

> `// 'transfer' must match the function name, 'amount' must match an input name.`
> `field: 'transfer.amount'`

…with an inline ABI whose inputs are named `recipient` and `amount`.

And `/recipes/wallets/conditional-signer-policies.mdx` passes viem's ABI directly:

```ts
{
  field_source: 'ethereum_calldata',
  field: 'transfer.amount',
  abi: erc20Abi,
  operator: 'lte',
  value: parseUnits('1000', 6).toString()
}
```

So the answer to "is it `ethereum_calldata.transfer._to` or something else?" is: **it is `transfer._to` if and only if the ABI you attach to the condition names that input `_to`.** The selector is computed from parameter *types* (`transfer(address,uint256)`), so a hand-written ABI naming the inputs `_to`/`_value` decodes real USDC calldata correctly. Both spellings work; they are not interchangeable *within one policy*.

**Consequence for `packages/privy/policy-builder.ts`:** the builder must own a single canonical ERC-20 ABI constant with inputs named `_to`/`_value`, and emit both the `abi` and the `field` from it. The existing guard test ("throws if the output lacks a `transfer._to` condition") stays valid — but it should assert against *that constant*, not a hardcoded string, so ABI and field can never drift apart. Do not import viem's `erc20Abi` into a policy: it silently changes the field path to `transfer.recipient`.

---

## Finding 2 — `transaction.to` vs decoded calldata are genuinely distinct, and how to combine them

**Source:** `/controls/policies/overview.mdx`, `/controls/policies/example-policies/ethereum.mdx`

They are separate `field_source` values evaluated against separate parts of the request:

| Source | Docs description | Example fields |
|---|---|---|
| `'ethereum_transaction'` | "The verbatim Ethereum transaction object in an `eth_signTransaction`, `eth_sendTransaction`, `eth_signUserOperation`, or `wallet_sendCalls` request." | `to`, `value`, `chain_id` |
| `'ethereum_calldata'` | "The decoded calldata in a smart contract interaction…" | `function_name`, `function_name._to`, `function_name._value` |

Invariant 2's concern is exactly right and Privy's own docs demonstrate the fix: their ERC-20 example puts **both** conditions in the same rule, and all conditions in a rule are ANDed —

> "A **rule** is composed of a set of boolean **conditions** and an **action** (`ALLOW` or `DENY`) that is taken if an RPC request satisfies **all** of the conditions in the rule."

The one-destination rule BOLT needs is therefore (schematically, ABI elided):

```jsonc
{
  "name": "USDC transfer to the single permitted payee",
  "method": "eth_sendTransaction",
  "action": "ALLOW",
  "conditions": [
    { "field_source": "ethereum_transaction", "field": "to",            "operator": "eq", "value": "<USDC on Arc>" },
    { "field_source": "ethereum_transaction", "field": "chain_id",      "operator": "eq", "value": "<Arc chain id>" },
    { "field_source": "ethereum_transaction", "field": "value",         "operator": "eq", "value": "0" },
    { "field_source": "ethereum_calldata",    "field": "function_name", "abi": "<ERC20 ABI>", "operator": "eq", "value": "transfer" },
    { "field_source": "ethereum_calldata",    "field": "transfer._to",  "abi": "<ERC20 ABI>", "operator": "eq", "value": "<permitted payee>" }
  ]
}
```

Three notes the docs force:

- **`value == 0` is not optional.** `ethereum_transaction.value` and the calldata are independent; without it a permitted `transfer` call could carry native value. This is the "send native value instead of a token transfer" attack in the Phase 0 task list, and it is closed by a condition, not by the absence of one.
- **String comparisons are case-sensitive** ("All string comparisons are case-sensitive"). Addresses must be normalised to one casing on both the policy side and the request side. A checksummed address in the policy versus a lowercase address in the request will silently never match. This is a real source of false refusals in the spike — expect it.
- **Numeric values are compared verbatim, in base units** — "no conversion is applied… USDC in microdollars". Consistent with the `Usdc` bigint convention.

---

## Finding 3 — Refusal shape, and whether it is preserved

**Sources:** `/basics/troubleshooting/error-handling/api-errors.mdx`, `/recipes/using-stateful-policies.mdx`, `/api-reference/wallets/ethereum/eth-send-transaction.mdx`

Yes — the refusal is a distinct, structured, inspectable error.

- Error code: **`policy_violation`** — "RPC request denied due to policy violation… This error occurs when an RPC request is blocked by a policy configured on the wallet."
- HTTP status: **400**. From `/recipes/using-stateful-policies.mdx`: "When a signing request would push the running total past the cap, Privy returns a `400` error with code `policy_violation`."
- Node SDK shape, verbatim from that same page:

```ts
import {BadRequestError} from '@privy-io/node';
// ...
} catch (error) {
  if (error instanceof BadRequestError && (error.error as any)?.code === 'policy_violation') {
    // ...
  }
  throw error;
}
```

So `recordPolicyRefusal(e)` has a real object to store: `error.error` carries a `code`. Detection is `instanceof BadRequestError && error.error.code === 'policy_violation'` — narrow on the code, never on a message string.

Three operational notes:

- **Idempotency:** "On 4xx or 5xx, Privy caches the response and replays it for the same key… **Policy violations are an exception and allow same-key retries.**" Good for demoing the same refusal repeatedly.
- **Simulation masks policy failures.** From the overview: "For operations where Privy both signs and broadcasts a transaction, transaction simulation runs **before** policy evaluation… If a request would both fail simulation and violate a policy, the response reflects the simulation failure rather than a policy violation." **A refusal demo on an underfunded wallet will show `insufficient_funds`, not `policy_violation`.** Fund the wallet before recording refusal evidence, or the headline evidence is wrong. This bites `eth_sendTransaction` only, not `eth_signTransaction`.
- **Privy advises not echoing refusal detail to end users** (`/recipes/agent-integrations/x402-sanctions-screening.mdx`: "Do not echo the matched address, condition set ID, or rule name to end users. Detailed rejection reasons let a caller enumerate the denylist by probing."). That is *their* guidance for a sanctions denylist, where the list is the secret. BOLT's allowlist is deliberately public, so this does not apply to us — but the convention of storing the raw error server-side and rendering a summary publicly is compatible with it either way.

---

## Finding 4 — `approve` / `transferFrom`, and the allowance-drain route

**Sources:** `/controls/policies/overview.mdx`, `/controls/policies/example-policies/tron.mdx`

Yes, both are constrainable, by exactly the same grammar — the field path is `<function name>.<input name>` for any function in the supplied ABI. Privy's Tron example (same mechanism, different field source) uses `"field": "transferFrom._from"` with an ABI declaring inputs `_from`, `_to`, `_value`. Applying the ethereum grammar: `approve._spender`, `approve._value`, `transferFrom._from`, `transferFrom._to`, `transferFrom._value` — again, exactly as named in the ABI you attach.

**But the allowance-drain route is closed by default, not by an explicit rule.** From the overview:

> "If a wallet's policy **does not** include a rule for a given RPC method or wallet action API, **usage of that RPC method or API will be denied.**"
> "If the request does not satisfy *any* of the rules for the policy, the policy engine defaults to `DENY` the request."
> "If **any** rule evaluates to a `DENY` action, the policy engine will `DENY` the request."

A locked account whose only `eth_sendTransaction` rule requires `function_name == "transfer"` cannot call `approve` at all: the `approve` calldata does not satisfy that condition, no other rule matches, default-deny fires. The same reasoning closes native sends, unusual-padding re-encodings (decoding is ABI-driven, not byte-pattern-driven), and multicall wrappers (a multicall's `transaction.to` is not the USDC contract, and its `function_name` is not `transfer`).

**This is the theory. Phase 0's job is to prove it empirically** — that is precisely the attack list in PHASES.md, and none of it is safe to assume from documentation. Two specific things the docs leave genuinely open, to be settled by experiment:

1. **What a decode failure evaluates to.** Docs never state it directly for rule conditions. The only adjacent statement is a warning about aggregations — "If an aggregation is deleted, any policy conditions that reference it will evaluate to `false`" — and a much more alarming one, also about aggregations: *"**ABI mismatch silently passes.** If the transaction calldata does not decode against the aggregation metric's ABI, the extracted value defaults to `0`. The transaction passes the policy check as if nothing was sent."* That failure mode is documented for **aggregation metrics**, not for rule conditions, and the two are separate systems. If the same defaulting applied to conditions it would be a serious hole. **Test this explicitly in the spike:** send `approve` calldata to a wallet whose policy only allows `transfer`, and confirm `policy_violation` rather than a signature.
2. **Belt and braces.** Regardless of result, add explicit `DENY` rules for `approve` and for `transferFrom` on locked accounts. DENY takes precedence over ALLOW, so an explicit denial cannot be widened by a later permissive rule, and it makes the intent legible to anyone reading the policy. Cheap; do it.

Also lock down the *other* methods. A policy that only carries an `eth_sendTransaction` rule already denies `eth_signTransaction`, `eth_signTypedData_v4`, `personal_sign`, `wallet_sendCalls`, `eth_sign7702Authorization`, `exportPrivateKey` and `exportSeedPhrase` by default — but if BOLT signs-and-self-broadcasts (Finding 5c) the allow rule moves to `eth_signTransaction`, and then `eth_sendTransaction` is the one denied by default. Whichever method carries the ALLOW, the pairing must be deliberate. A blanket `{ method: '*', conditions: [], action: 'DENY' }` rule is documented ("Deny all requests") and, since DENY wins over ALLOW, **would deny everything including the permitted transfer** — do not add it as a catch-all alongside an ALLOW rule. Default-deny is already the behaviour; it needs no rule.

---

## Finding 5 — Tier and plan availability

Privy's docs do not publish a pricing matrix, so this is assembled from gating language across pages. **Every item here must be re-confirmed in the dashboard on day 1** — docs describe capability, not entitlement.

### 5a. Available with no gating language found

| Feature | Evidence |
|---|---|
| **Policies** | `/controls/policies/create-a-policy.mdx` — self-serve via Dashboard, NodeJS SDK, or REST. No plan language anywhere on the policy pages. |
| **Key quorums** | `/api-reference/key-quorums/create.mdx` — `POST /v1/key_quorums`, with `authorization_threshold` ("The number of keys that must sign for an action to be valid"). 3-of-5 is expressible. Quorums nest one level deep. No plan gating. |
| **Organization wallets** | `/organizations/overview.mdx`, `/organizations/setup/overview.mdx` — organization object, `default_key_quorum_id`, wallets created with `entity` set to the organization. No plan gating. |
| **Session / additional signers** | `/recipes/wallets/conditional-signer-policies.mdx` — "Each wallet can have multiple **additional signers**… Each signer can have an **override policy**… When a signer submits a transaction, Privy evaluates only that signer's override policy". This is exactly FR-3.3's constrained splitter. No plan gating. |
| **Pregenerated wallets** | `/recipes/pregenerate-wallets.mdx` — `privy.users().create({ linked_accounts, wallets: [...] })`, and the example already carries `additional_signers` with `override_policy_ids`. No plan gating. |
| **Intents API** | `/transaction-management/intents/overview.mdx` — propose, sign asynchronously, Privy executes at threshold. Supported actions include RPC, Transfer, Update wallet, Update policy, Update key quorum. No plan gating on the API. |

### 5b. Gated — flag these

| Item | Exact wording | Impact on BOLT |
|---|---|---|
| **Production webhooks** | "Webhooks can be tested at no cost in development environments. To enable webhooks in production, **upgrade to the Enterprise plan** in the Privy Dashboard." (`/api-reference/webhooks/overview.mdx`) | Phase 3's deposit webhook works in dev/testnet, which is all the hackathon needs. **Do not claim production webhooks** (invariant 6). If dev webhooks prove unreliable, the fallback is polling balances or reading the subgraph — but that is a Phase 3 decision, not a Phase 0 blocker. |
| **Dashboard manual approvals** | "Manual approvals is an **Enterprise feature**. Reach out to sales@privy.io to request access for your app." (`/controls/dashboard/overview.mdx`) | Phase 6 must use the **Intents API**, not dashboard approvals. The docs frame manual approvals as "Privy's Dashboard-native implementation of intents" — the underlying primitive is self-serve. This is the better architecture for BOLT anyway: approvals need to be phone-approvable in *our* UI and their proof reference recorded publicly. |
| **Custom OTP email, international SMS, Cards, extra Earn vaults** | Various Enterprise / sales-gated | None. Not in the plan. |

### 5c. The Arc question — the real risk

**Arc appears nowhere in Privy's documentation.** A case-insensitive search across the entire docs filesystem returns nothing.

What `/wallets/overview/chains.mdx` does say:

- Tier 3 (Privy signs, broadcasts and tracks) lists **"Ethereum — *Includes EVM-compatible networks*"**.
- Tier 2 (Privy decodes and signs) is the threshold that matters for us: *"Tier 2 is the minimum threshold for transaction-level policy controls, because Privy must decode a transaction before it can evaluate conditions on the transaction's contents."*
- The capability table lists **Transaction policies → minimum tier 2**, with the qualifier *"Available conditions vary by chain and method."*
- Closing note: *"Privy is continuously adding new chains and expanding capabilities on existing chains. Contact support@privy.io with questions about current coverage."*

So: policy enforcement over decoded EVM calldata needs only Tier 2, and Arc is an EVM chain. The uncertainty is whether Privy will **broadcast** on Arc — Tier 3 requires Privy to hold RPC for the network, and `eth_sendTransaction` takes a `caip2` identifier that Privy must recognise.

**The mitigation is already documented and costs nothing.** `eth_signTransaction` takes a plain `chain_id` on the transaction object and no `caip2` — Privy signs, you broadcast. Privy's own stateful-policies recipe does exactly this:

```ts
const signResponse = await privy.wallets._rpc(walletId, {
  method: 'eth_signTransaction',
  chain_type: 'ethereum',
  params: { transaction: { from, to: USDC_ADDRESS, data, chain_id: sepolia.id } }
});
const {signed_transaction} = (signResponse.data as any).data;
const txHash = await publicClient.sendRawTransaction({ serializedTransaction: signed_transaction });
```

Policy evaluation still happens in the enclave before the signature exists, so **the product's central claim survives intact** on the sign-and-self-broadcast path — arguably it is even cleaner, since nothing about enforcement depends on Privy's broadcast infrastructure.

**Day-1 spike order, therefore:** try `eth_sendTransaction` on Arc first; if the chain is unrecognised, fall back to `eth_signTransaction` + viem `sendRawTransaction` against an Arc RPC. Decide this on day 1 and write the decision down — it changes every call site in `packages/privy`. Two knock-on effects of the fallback: `ethereum_transaction.chain_id` becomes the only thing binding a signature to Arc (so that condition is load-bearing, not decorative), and pre-flight simulation no longer runs, which means refusals arrive as clean `policy_violation`s rather than being masked by simulation errors.

---

## Finding 6 — Policy structure, attachment, and default-deny

**Sources:** `/controls/policies/overview.mdx`, `/controls/policies/create-a-policy.mdx`, `/wallets/wallets/create/create-a-wallet.mdx`

**Shape.** JSON (equivalently a typed object through the SDKs). Three nested primitives — policy → rules → conditions:

```
policy   { version: '1.0', name, chain_type: 'ethereum', rules: Rule[], owner | owner_id }
rule     { name, method, conditions: Condition[], action: 'ALLOW' | 'DENY' }
condition{ field_source, field, abi?, operator, value }
```

`version` is `'1.0'` and is currently the only version.

**Creation via API — yes, fully.** `POST https://api.privy.io/v1/policies`, or `privy.policies().create({...})` in the Node SDK (also Java, Rust, Go, Ruby). Response returns the policy plus a generated `id`.

**Attachment.** A wallet is created with `policy_ids: string[]`. One critical constraint, verbatim from `/wallets/wallets/create/create-a-wallet.mdx`:

> "List of policy IDs for policies that should be enforced on the wallet. **Currently, only one policy is supported per wallet.**"

This is compatible with BOLT — one policy per locked account carrying several rules — but it forbids any design that layers a base policy plus a per-beneficiary policy on one wallet. Per-*signer* differentiation is the supported alternative, via `additional_signers[].override_policy_ids`. And because the policy is passed at wallet creation, FR-1.3 ("no account may exist in an unlocked state, even briefly") is directly satisfiable: create the policy first, then create the wallet with its id.

**Default-deny.** There is no `DENY *` rule to write, and writing one would be a bug. Denial is the engine's default:

> "`DENY` actions take precedence over `ALLOW` actions. If no rules resolve, the policy will default to `DENY`."
> "If a wallet's policy **does not** include a rule for a given RPC method or wallet action API, **usage of that RPC method or API will be denied.**"

An explicit `{ method: '*', conditions: [], action: 'DENY' }` rule *is* documented — as a standalone "deny all requests" policy — but because DENY beats ALLOW it would also kill the permitted transfer if combined with an ALLOW rule. **Default-deny is free; do not encode it.**

**Ownership — this is where invariant 3 lands.** A policy takes an `owner` (a P-256 public key) or an `owner_id` (a key quorum id). The docs are unusually direct:

> "We highly recommend specifying owners for your policies to further restrict the parties that can modify them. **Without an owner, the policies can be updated by your app secret alone.**"

A policy with no owner is widenable by anything holding `PRIVY_APP_SECRET` — which is exactly the "admin override" invariant 3 forbids. **Every BOLT policy must be created with `owner_id` set to a key quorum, at creation time.** Combined with the Intents API (`Update policy` is a supported intent action), this gives quorum-gated policy widening with no application-layer check involved.

**Enforcement location.** Relevant to the product's central claim, verbatim from the overview:

> "By default, the trusted execution environment (secure enclave) enforces policies when processing wallet actions, such as signature requests, transactions, and key export. The enclave evaluates policy rules in a tamper-proof environment before any operations proceed. **Privy enforces some policies at the API level.** For example, limiting transfer sizes requires transaction simulation which runs outside the enclave today."

Destination and calldata conditions — everything BOLT's claim rests on — are enclave-enforced. **Transfer-*size* limits are not.** If BOLT ever adds a per-payout cap, that cap is API-level and must not be described as enclave-enforced. Worth a line in the README when the time comes.

---

## Divergences from CLAUDE.md / README

CLAUDE.md is right that the docs win. Three corrections:

| CLAUDE.md illustrates | Docs say | Verdict |
|---|---|---|
| `ethereum_calldata.transfer._to` | Field path is `<abi function name>.<abi input name>`, both taken from the ABI the condition supplies. `_to` is Privy's own example spelling in the field-source table, but their ERC-20 code examples use viem's `erc20Abi` → `transfer.recipient`. | **Valid, conditionally.** Keep `transfer._to`; pin a canonical ABI naming that input `_to` and generate both `abi` and `field` from it. Never import viem's `erc20Abi` into a policy. |
| `transfer_from._to` | The function-name segment is the ABI's `name`, i.e. **`transferFrom`** (Privy's Tron example: `"field": "transferFrom._from"`). | **Wrong spelling.** Correct to `transferFrom._to` / `transferFrom._from`. |
| `DENY *` as an explicit trailing rule | Default is already DENY. An explicit `method: '*'` DENY rule takes precedence over ALLOW rules and would deny the permitted transfer too. | **Drop it.** The pseudocode in invariant 2 should note that default-deny is the engine's behaviour, not a rule to emit. The policy-builder test must not require a `DENY *` rule. |

The rest of invariant 2 is confirmed exactly as written: `transaction.to` and decoded calldata are distinct sources, and constraining only `transaction.to` on a USDC transfer really does permit paying anyone.

Two additions invariant 2 does not currently mention but should: **`ethereum_transaction.value == 0`** (otherwise a permitted `transfer` can carry native value) and **`ethereum_transaction.chain_id`** (load-bearing if BOLT self-broadcasts).

---

## What a human must do next, before the live spike

Documentation research cannot go further. These require dashboard access and credentials.

**Privy — do these in order:**

1. **Create the Privy app** at [dashboard.privy.io](https://dashboard.privy.io). Note the environment (dev vs production) — webhooks are free in dev only.
2. **Record three secrets into `.env`** (never committed): `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and an authorization key. The authorization key is a **P-256 keypair** — the public half is what `owner.public_key` takes in base64-encoded DER; the private half becomes `PRIVY_AUTHORIZATION_KEY` and signs the `privy-authorization-signature` header. Generate it via the dashboard's authorization-keys section.
3. **Confirm on the plan/billing page** that these are all available on the current (self-serve) tier, and screenshot the page for `docs/evidence/`:
   - policies — expected available
   - key quorums — expected available
   - organizations / organization wallets — expected available
   - additional signers with override policies — expected available
   - pregenerated wallets — expected available
   - **Intents API** — expected available; confirm it is *not* bundled behind the Enterprise "Manual approvals" toggle. **This is the one to check hardest** — Phase 6 depends on it and the docs only tell us the dashboard flavour is Enterprise.
   - webhooks — expect "dev only, Enterprise for production"; confirm the dev environment can register an endpoint.
4. **Answer the Arc question.** In the dashboard's chain/network configuration, look for Arc. If absent, email support@privy.io (the chains page explicitly invites this) *and* plan on the `eth_signTransaction` + self-broadcast path. Do not wait on the email to proceed.
5. **Get Arc testnet details independently** — chain id, CAIP-2 identifier, RPC URL, USDC contract address, and a faucet. These come from `arc-docs`, not from Privy, and the spike cannot start without the USDC address.

**Then the spike itself** (in this order, capturing raw errors into `docs/evidence/` at each step):

6. Create one Privy wallet with a policy attached **at creation**, the policy owned by a key quorum (`owner_id`), with one ALLOW rule carrying all five conditions from Finding 2.
7. Fund it with testnet USDC on Arc. **Fund it before testing refusals** — an underfunded `eth_sendTransaction` returns `insufficient_funds`, not `policy_violation`, and would produce misleading evidence.
8. Send to the permitted address → expect success.
9. Then attack it, per PHASES.md: different address; native value; `approve` then `transferFrom`; manually re-encoded calldata with unusual padding; a multicall wrapper. Each should return `400` / `policy_violation`. **The `approve` case is the one that could genuinely surprise us** (Finding 4) — run it early.
10. Confirm address casing behaviour while you are there — case-sensitive comparison means a checksummed-vs-lowercase mismatch produces a *false* refusal that looks like a success. Determine which casing Privy sees, and normalise on it in the policy builder.

**In parallel, unrelated to Privy but on the Phase 0 critical path:**

11. **Approve the `world-docs` MCP server today.** It is still pending, World is a submitted track, and Phases 6 and 8 both depend on it.

---

## Pages consulted

- `/controls/policies/overview.mdx` — policies/rules/conditions, field sources, evaluation order, default-deny, enclave enforcement
- `/controls/policies/example-policies/ethereum.mdx` — ERC-20 calldata example, deny-all, allowlist, chain restriction
- `/controls/policies/create-a-policy.mdx` — SDK + REST creation, owners, `owner_id`
- `/controls/policies/example-policies/tron.mdx` — `transferFrom._from` field-path precedent with explicit ABI input names
- `/controls/policies/stateful-policies.mdx` — condition-evaluates-to-false semantics
- `/recipes/using-stateful-policies.mdx` — `BadRequestError` / `policy_violation` catch pattern, `eth_signTransaction` + self-broadcast, ABI-mismatch caveat
- `/recipes/wallets/conditional-signer-policies.mdx` — additional signers with override policies, `abi: erc20Abi` usage
- `/recipes/pregenerate-wallets.mdx` — pregeneration with `additional_signers` / `override_policy_ids`
- `/basics/troubleshooting/error-handling/api-errors.mdx` — `policy_violation` error code
- `/api-reference/wallets/ethereum/eth-send-transaction.mdx` — request shape, idempotency-on-policy-violation
- `/api-reference/wallets/ethereum/eth-sign-transaction.mdx` — `chain_id`, no `caip2`
- `/api-reference/webhooks/overview.mdx` — Enterprise gate on production webhooks
- `/api-reference/key-quorums/create.mdx` — quorum creation, `authorization_threshold`
- `/wallets/wallets/create/create-a-wallet.mdx` — `policy_ids`, one-policy-per-wallet limit
- `/wallets/overview/chains.mdx` — tier model, Tier 2 minimum for policies, no mention of Arc
- `/wallets/actions/transfer/policies.mdx` — `transfer` method + `action_request_body` (Tier 3 path, not BOLT's)
- `/organizations/overview.mdx`, `/organizations/setup/overview.mdx` — org objects, default key quorum
- `/transaction-management/intents/overview.mdx` — Intents API, relationship to Enterprise manual approvals
- `/controls/dashboard/overview.mdx` — Enterprise gate on manual approvals
- `/recipes/agent-integrations/x402-sanctions-screening.mdx` — refusal-handling guidance
- `/security/security-faqs.mdx` — enclave key-share model, session/agent signers

---

## Addendum — arc-docs and world-docs, queried after MCP reconnection

### Arc network (from `arc-docs`)

| Parameter | Value |
|---|---|
| Chain ID | `5042002` |
| RPC (HTTPS) | `https://rpc.testnet.arc.io` |
| RPC (WebSocket) | `wss://rpc.testnet.arc.io` |
| Block explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` (select "Arc Testnet") |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` |
| EVM target | Osaka hard fork |

**Load-bearing nuance for invariant 2:** on Arc, USDC is not a bolted-on ERC-20 — it is the **native gas token**, exposed through both a native-value interface (18 decimals internally) and the ERC-20 interface at the address above (6 display decimals), **over the same underlying balance**. Docs state this explicitly: *"The ERC-20 USDC interface already exposes `transfer`, `approve`, and `transferFrom` over the same underlying native balance."* Practically:

- A **native-value send** (`to: <anyone>, value: X`, no calldata) moves USDC directly and does **not** touch the USDC contract address at all. Our policy's `ethereum_transaction.to == USDC_CONTRACT` condition correctly excludes this shape from the ALLOW rule — it falls through to default-deny. This is exactly the "send native value instead of a token transfer" attack Phase 0's task list calls out, and the existing policy grammar already closes it *as long as the `transaction.to` condition is never dropped* — confirms invariant 2's requirement to check both, not just calldata.
- The remaining edge case — calling `transfer()` on the USDC contract *while also* attaching non-zero `value` on the same transaction — is closed by the `ethereum_transaction.value == 0` condition already recommended above. Treat that condition as required, not optional, specifically because of Arc's dual-interface design.
- **This must be tested empirically against Arc, not assumed** — Foundry's `anvil` and other local EVM simulators can't reproduce Arc's native/ERC-20 unification, per Arc's own porting guide. Phase 0's live spike must run on Arc testnet directly.

world-docs and arc-docs are both connected and answering.

### World — a new access-gate blocker, distinct from the MCP approval

**Selfie Check (Beta) is feature-flag gated per app, separately from World ID generally, and separately from Sandbox access.** Both production and Sandbox testing require it:

> "Selfie Check (Beta) is access-gated. To use it, [request access](mailto:developers@toolsforhumanity.com) so the feature flag can be enabled for your app."

> (Sandbox docs, verbatim) "Selfie Check (Beta) must be enabled for your app before you can test it. To enable the feature flag, request access through your World point of contact."

The docs' own SKILL guidance is explicit: *"A valid app or action does not imply Selfie Check access."* This is a second, independent critical-path blocker beyond `world-docs` MCP approval (now resolved) — email `developers@toolsforhumanity.com` (or your World point of contact) **today** to request the feature flag, since Phases 6 and 8 both require live Selfie Check testing and approval lead time is unknown.
