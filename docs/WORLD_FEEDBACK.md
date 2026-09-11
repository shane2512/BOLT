# World integration feedback

Feedback on integrating **World ID / Selfie Check (Beta)** into BOLT, written during the
integration rather than after it (FR-12.3). Sections (a) and (b) were written in Phase 6, at the
point each piece of friction was hit. Sections (c) and (d) were opened later the same phase, once
the Developer Portal app, RP and action existed and the integration could be pointed at live
Sandbox infrastructure; they are marked where an item is still open pending a completed Selfie
Check on a device.

Context, so the feedback is readable: BOLT uses Selfie Check as an **abuse-prevention** signal on
unlock approvals (each of three quorum members completes a check before their approval counts) and
in Phase 8 as an **eligibility** signal on a beneficiary's first claim and a **continuity** signal
on an address change. It is not a login skin — remove it and both exits from a locked account
become script-triggerable.

Versions this is written against: `@worldcoin/idkit@4.2.3`, `@worldcoin/idkit-core@4.2.4`
(which pulls `@worldcoin/idkit-server@1.1.1`), docs as served by the `docs.world.org` MCP on
2026-09-10.

---

## (a) Selfie Check documentation and integration flow

**What went well.** The six-step shape in `/world-id/idkit/integrate` is the right level of
abstraction, and the sequence diagram at the bottom of that page answered more questions than the
prose above it. The agent-facing `/world-id/SKILL` page is genuinely better than the human page in
one specific way: it says *why* each step exists ("A client can return any JSON it wants"), which
is what stops someone shortcutting the backend verification. Two of its warnings — forward the
proof as-is, and store the nullifier with a `UNIQUE` constraint — are the two mistakes we would
otherwise have made.

**Friction, roughly in the order we hit it.**

1. **There is no single list of what you need before you can write code.** Selfie Check needs four
   values (`app_id`, `rp_id`, the RP signing key, and an action) plus two independent access
   grants (the Selfie Check beta flag, and Sandbox tester access). Those six facts are spread
   across `/world-id/idkit/integrate` step 2, `/world-id/credentials/11`, and
   `/world-id/sandbox/sandbox-access`. Our own project plan had budgeted for two env vars
   (`WORLD_APP_ID`, `WORLD_ACTION_ID`) because that is what the older integration shape needed,
   and we only discovered the other two by reading step 3's code sample. A "before you start"
   table at the top of the Selfie Check page — four credentials, two gates, where each comes from
   — would have saved a day.

2. **"Selfie Check access granted" is not the same as "you have an app", and the docs let you
   conflate them.** The credential page's warning is about the feature flag; the integrate page's
   step 2 is about the Portal. Both are prerequisites and neither mentions the other. Having been
   granted the beta flag, our reasonable assumption was that we could start; we could not, because
   the app and RP still had to be created by hand. The SKILL page has exactly the right sentence
   for this — *"A valid app or action does not imply Selfie Check access."* — and it would land
   better stated in the other direction too, on the credential page: *Selfie Check access does not
   imply a configured app.*

3. **`selfieCheckLegacy()` returns a World ID 3.0 proof, and the endpoint is `/api/v4/verify`.**
   This is stated (`"The preset currently uses World ID 3.0; World ID 4.0 support is not yet
   available"`) and it is still confusing, because the verify reference presents 3.0 as one of
   three request-body variants. Which is the right guidance for the *only* preset that produces
   3.0 proofs today is left to the reader.

4. **The verify API reference flattens three request variants into one field list.** The page shows
   `protocol_version` three times, `responses[]` three times, and `nullifier` under two different
   shapes (`nullifier: string` for 3.0/4.0-uniqueness, `session_nullifier: string[]` for sessions).
   Reading it top to bottom, it is not possible to tell which fields co-occur. Three collapsible
   variants, or three examples, would remove the guesswork. We ended up validating our
   response parser against the 3.0 branch by elimination.

5. **`environment: "sandbox"` is valid in the SDK and undocumented at the verifier.**
   `/world-id/sandbox/sandbox-access` says *"Set `environment: sandbox` in your IDKit
   configuration"*, and IDKit 4.2.x agrees — `IDKitRequestConfig.environment` is typed
   `"production" | "staging" | "sandbox"`, and the result object carries that value back. But the
   same guide then says to send the proof to the production verify endpoint, and that endpoint's
   documented `environment` field is an enum of `production | staging` only. Since the instruction
   everywhere else is to forward the IDKit result **verbatim**, a Sandbox proof necessarily arrives
   at the verifier carrying an `environment` value the API reference does not list. Either the enum
   is incomplete or forwarding verbatim is wrong for Sandbox; the docs do not say which, and this
   is the thing we are least confident about going into Phase 8's Sandbox testing.

6. **`signal` is described as something your backend "should enforce", and the tool for enforcing
   it is on a different page.** `/world-id/idkit/integrate` step 4 says *"Your backend should
   enforce the same value"*, and the proof carries `signal_hash`, not the signal — so the
   integrator needs `hashSignal` from `@worldcoin/idkit-core/hashing`. That export is documented,
   but only on `/world-id/idkit/javascript`, which reads as a platform-specific SDK page rather
   than part of the integration path; we found it in the package's `exports` map first and the
   docs second. One line in step 4 would close it. It matters here: BOLT binds the signal to the
   specific unlock being approved, so without that server-side check a proof minted for one unlock
   could be presented for another.

7. **The nullifier's scope is described two ways.** `/world-id/idkit/integrate` step 6 calls it
   "a per-app, per-action identifier"; `/world-id/SKILL` calls it "an RP-scoped, action-scoped,
   non-reversible identifier". If an app can have multiple RPs, those are different guarantees.
   Our design keys "one human, one approval, per unlock" on `(unlock_id, nullifier)` and
   deliberately does *not* enforce global `(action, nullifier)` uniqueness, because the same person
   legitimately approves different unlocks under the same action. Getting that right required
   knowing precisely what the nullifier is scoped to, and we had to pick the stricter reading.

8. **`nullifier_replayed` suggests World enforces per-action uniqueness, while the integration
   guide says the backend must.** `/world-id/idkit/error-codes` lists `nullifier_replayed` —
   *"Nullifier was already used for this action… do not retry the same action as a new
   verification"* — alongside `max_verifications_reached`. `/world-id/idkit/integrate` step 6 says
   the opposite-shaped thing: the Portal confirms the proof is valid and *"your backend must check
   that the nullifier hasn't been used before"*. If World already refuses a repeat, then any
   design where the same person legitimately verifies twice under one action is impossible, and
   integrators need a per-occurrence action string instead. That is a design-level decision and it
   is currently inferable only by trying it. For BOLT it decides whether one approver can approve
   two different unlocks under a single `bolt-unlock-approval` action, or whether we need an
   action per unlock; we will find out in Phase 8 and report back here.

9. **Nothing says whether a nullifier may be displayed publicly.** BOLT publishes each approver's
   proof reference on a page anyone can read — that is the point of the product, and the nullifier
   is the natural reference because it is exactly what World issued. The docs say it "reveals
   nothing about the user — safe to store", which is about storage, not publication. A sentence on
   whether publishing a nullifier is expected, acceptable, or discouraged would let integrators
   make that call with confidence instead of by inference.

10. **The package layout is one hop deeper than the docs suggest.** `signRequest` is imported from
   `@worldcoin/idkit-core/signing`, which is a re-export of `@worldcoin/idkit-server` — a third
   package that appears in the lockfile and is never mentioned. Not a problem, but it is a
   surprise when auditing a dependency tree for a financial product, and the useful JSDoc (the
   message format, the link to the Rust implementation) lives only in that unmentioned package.

11. **Env var names drift between pages.** `/world-id/idkit/integrate` step 3 uses
    `process.env.RP_SIGNING_KEY`; `/world-id/from-idkit-standalone` uses
    `process.env.WORLD_ID_RP_ID`. Cosmetic, but copy-paste integrations inherit the inconsistency.

12. **The docs' own agent guidance assumes a Portal MCP that the public docs MCP does not
    provide.** `/world-id/SKILL` step 2 says *"Use the MCP when available"* and names
    `configure_world_id` and `get_world_id_signing_key`. The `docs.world.org` MCP server exposes
    search and read tools only. For an agent-driven integration this is the hard stop: everything
    else in Phase 6 could be built and tested, but the app, RP and action had to be handed back to
    a human. If a Portal MCP exists, saying where would unblock a whole class of integration; if
    it does not, the SKILL page should not imply one.

---

## (b) Developer Portal — navigation, search, product discovery, debugging guidance

**Status: partial, and honestly labelled.** BOLT does not yet have a Portal app — creating one is
the manual step Phase 6 stopped on — so this section reports on what the Portal is *documented* to
do and on the discovery experience of finding that out. It gets topped up in Phase 8 with the
experience of actually using it.

1. **The Portal is five jobs in one console, described in five places.** From the docs, a Selfie
   Check integrator has to: create an app; complete RP registration (via an "Enable World ID 4.0
   banner" if migrating); capture the signing key; create an action in the right environment; and,
   separately, enrol test devices under a **World ID Sandbox** panel. Those are covered in
   `/world-id/idkit/integrate` step 2, `/world-id/sandbox/sandbox-access`, and `/world-id/SKILL`
   step 2 — never together. A single "Portal setup" page that walks the five in order, with a
   screenshot each, would be the highest-value page you could add for a first integration.

2. **The signing key is shown exactly once and the consequence is stated only in the agent
   guidance.** `/world-id/SKILL` says the Portal returns it once and that
   `get_world_id_signing_key` cannot recover it — rotation invalidates the old signer. That is a
   serious operational fact and it is not on the human-facing integrate page, where step 2 just
   says *"`signing_key` - this should be stored as a secret."* For a financial integration, "you
   get one chance to copy this, and rotating it breaks live proof requests" belongs in a callout.

3. **Product discovery: the credential catalogue is good; the "which do I want" table is better,
   and it is on a Mini Apps page.** `/world-id/idkit/mini-apps` has a three-row table mapping goal
   → preset (`proofOfHuman` / `selfieCheckLegacy` / `passport`). That is the table a new
   integrator needs, and it is filed under Mini Apps, which a desktop-web integrator has no reason
   to open. `/world-id/idkit/credentials` has a fuller version; it would carry more weight on the
   World ID overview page.

4. **Search surfaces the SKILL page above the human pages for integration queries.** Searching the
   documentation for "Selfie Check IDKit integration verify proof" returned the agent SKILL page's
   Phase 4 checklist among the top hits. That was useful *for us*, but a human searching the same
   thing lands on a page written for coding agents, complete with "copy this checklist into your
   TODO". Either is fine; it is worth knowing that is what search does.

5. **The error-code reference is good and almost impossible to find from where you need it.**
   `/world-id/idkit/error-codes` is exactly the right page — every code with a "typical action"
   column, which is the column that actually helps — and neither
   `/api-reference/developer-portal/verify` nor `/world-id/idkit/integrate` links to it. Worse, it
   is not stated whether the verify endpoint's `code` / `detail` values are drawn from that same
   set or from a separate server-side one; the reference documents the two fields and gives no
   values. BOLT has to categorise these — a refused Selfie Check is an audit event in our product,
   not an error toast, and "the user cancelled" and "someone replayed a proof" must not land in
   the same bucket — and today we cannot tell from the docs which failures the verifier can even
   return. A link from the verify reference, plus a sentence saying whether the sets are the same,
   would fix this outright.

6. **Nothing in the Portal documentation describes how to see what your app has actually done.**
   For a product whose whole claim is public verifiability, the question "which proofs did my RP
   verify, when, and against which action" is the first thing we would want from the console. If
   the Portal has that view, the docs do not say; if it does not, it is a gap worth naming.

---

## (c) Sandbox — App states, proof flows, test users, errors, edge cases

**Scope of what follows, stated up front so nothing here reads as more than it is.** With
`app_c1634cdf…`, `rp_2b39e68a…`, the RP signing key and the `bolt-unlock-approval` action in
place, we drove the Sandbox from a terminal as far as it goes without a device: an RP signature,
a real `selfieCheckLegacy()` request on the sandbox bridge, and probes of the verifier. The
Hot / Cold / Semi-cold matrix and the device-side journeys are **not** reported on, because we have
not run them; that half is topped up in Phase 8. Evidence for everything below is in
`docs/evidence/phase6-world-credentials-live.json`.

1. **`environment: "sandbox"` is honoured end to end by the SDK, and you can see it.** IDKit 4.2.4
   returns a connect URL on `https://sandbox.world.org/verify?t=wld&i=…&k=…` rather than the
   production host. That is a useful, concrete confirmation that the value took effect, and it is
   not stated anywhere — `/world-id/sandbox/sandbox-access` says to set the flag but not what
   changes. One sentence naming the sandbox connect host would let an integrator confirm their
   configuration by eye.

2. **There is no way to complete a Selfie Check without a physical device, and that is the single
   biggest cost of this integration.** Sandbox is described as "a full end-to-end round trip", and
   it is — but the middle of the round trip is a human holding a phone that runs a TestFlight or
   private-Play build. Every other gate in BOLT is regression-tested from a terminal: the Privy
   policy refusal, the 3-of-5 quorum, the 24-hour timer, the on-chain events. The Selfie Check is
   the only one that cannot be, so it is the only one whose *positive* path has no automated test.
   A Sandbox-only affordance for this — a request-level "complete this request as test user N"
   endpoint, or a scriptable Sandbox account — would let integrators put the happy path in CI. As
   it stands the only assertions we can automate are negative ones plus "the bridge accepted my RP
   signature".

3. **What you *can* check without a device is worth documenting, because it is the cheapest
   possible credential smoke test.** `request.pollOnce()` returning `{"type":
   "waiting_for_connection"}` proves `app_id`, `rp_id`, the signing key and the action are all
   correct *together* — the bridge would not hold the request otherwise. Without knowing that, the
   first feedback on a mistyped credential arrives after you have installed a build and scanned a
   QR. Two lines in the Sandbox guide ("before you install anything, do this and expect this")
   would save a whole cycle.

4. **The RP signature window is 300 seconds, and that number is not on the integration page.**
   `signRequest()` returns `expires_at - created_at = 300` with no way to ask for more. That is the
   budget for the entire handoff, and it interacts badly with the documented Cold journey: install
   → create account → date of birth → invite code → enroll → Selfie Check does not fit in five
   minutes. So either the window bounds only *starting* the flow (in which case say so, because
   `rp_signature_expired` reads as though it bounds the whole thing), or Cold is not reachable
   cross-device at all. We could not tell from the docs, and it decides whether a QR on a laptop
   needs re-minting while the user is mid-install.

5. **Getting to a first request needs three separate grants, and only two are described as
   grants.** Selfie Check's beta flag on the app, Sandbox tester access for the device's Apple or
   Google account, and — the one that reads as configuration rather than access — the Portal app
   and RP registration themselves. This is the practical form of (a)1 and (a)2, and having now
   been through it we would put a five-line preflight checklist at the top of
   `/world-id/sandbox/testing-selfie-check`.

## (d) What was confusing, missing, broken, or hard to test

1. **(b)5 answered, and the answer is that there are two error vocabularies and only one is
   documented.** Live, `POST /api/v4/verify/{rp_id}` returned `all_verifications_failed`,
   `invalid_merkle_root`, `app_not_migrated`, `validation_error` and `invalid_request`. **None** of
   those appear in `/world-id/idkit/error-codes`, whose canonical table is the IDKit/bridge set
   (`user_rejected`, `credential_unavailable`, `nullifier_replayed`, …). For BOLT this is not
   cosmetic: a refused Selfie Check is an audit event in our product, and "the person cancelled"
   and "someone presented a proof that does not verify" must not land in the same bucket. We are
   classifying against a set the reference does not publish. Please either document the verifier's
   codes beside the endpoint or state plainly that the two sets are disjoint and link both.

2. **An rp_id that does not exist is reported as one that needs migrating.** `rp_0000000000000000`
   returns `app_not_migrated` — *"This app has not been migrated to World ID 4.0. Please use the v2
   verify endpoint."* The error-code reference has `unknown_rp` for precisely this case and the
   verifier does not use it. During bring-up a typo therefore reads as a migration problem and
   sends you back to the Portal to fix something that is not broken. (Useful side effect, which we
   are relying on as evidence: because a *registered* rp_id gets past this check and on to proof
   verification, the difference between the two responses is a clean, device-free proof that your
   RP exists and is migrated.)

3. **`app_id` works where the docs say `rp_id`.** `POST /api/v4/verify/{app_id}` behaved
   identically to `{rp_id}` for our app. Convenient, and undocumented — which means a plausible
   wrong value silently succeeds and the mistake surfaces somewhere else later. Worth one line
   saying whether this is supported or incidental.

4. **(a)5 is still open, and could not be closed without a real proof.** We hoped to settle whether
   forwarding a Sandbox proof verbatim — carrying `environment: "sandbox"`, a value the verify
   reference's enum does not list — is accepted. It cannot be settled with a deliberately invalid
   proof: the response is the same `invalid_merkle_root` whether `environment` is `"sandbox"` or
   absent entirely. So the question stands exactly as written in (a)5, and it is the thing we are
   least confident about going into the device-side run.

5. **The verifier gives no signal about whether it enforces `action`.** A proof presented under a
   completely different action returned the identical `invalid_merkle_root`. With an invalid proof
   that is inconclusive — proof validation plausibly just runs first — but it means an integrator
   cannot learn from the verifier whether action scoping is enforced server-side, and "the
   nullifier is action-scoped" is not the same guarantee as "a proof minted for another action is
   refused". BOLT does not rely on finding out: `verifySelfieCheck` compares the action itself
   before the round trip. A sentence in the verify reference would let others skip that decision.

6. **`IDKit.request` cannot run under Node at all.** It initialises its WASM with
   `fetch(new URL("idkit_wasm_bg.wasm", import.meta.url))`; under Node that is a `file://` URL,
   which `fetch` refuses, so every call fails with
   `Failed to initialize IDKit WASM: TypeError: fetch failed`. We shim `fetch` for `file://` URLs in
   our scripts (`packages/privy/scripts/phase6-*.ts`) and it works fine after that, so the WASM
   itself is not the problem — the loader is. `@worldcoin/idkit-core/hashing` has no such issue and
   `hashSignal` works in Node out of the box, which suggests the fix is local to the bridge
   transport's entrypoint. This is what makes (c)2 more expensive than it needs to be: even the
   parts of a Selfie Check flow that *could* be driven from a server currently need a shim first.

7. **A brand-new action string works with no Developer Portal step at all, and we cannot tell whether
   that is intended.** Phase 8 needed a second action (`bolt-beneficiary-claim`) so a beneficiary's
   nullifier would not share a scope with a quorum approver's. We went looking for where to register
   it and never found one — the RP signature was accepted and the bridge held a real request for it
   on first use, exactly as it did for `bolt-unlock-approval`, which *had* been through the Portal
   (`docs/evidence/phase8-world-action-probe.json`). Convenient, and it is the right ergonomics. But
   nothing in `/world-id/concepts` or the IDKit pages says whether actions are free-form by design or
   whether an unregistered one is a lower-trust request that will behave differently once a real
   proof is minted against it, and that difference decides whether an app can mint an action per
   unlock. One sentence stating that actions need no pre-registration — or that they do — would close
   it. *(Noticed during the Phase 8 bring-up; written up here afterwards rather than at the moment it
   was hit, unlike the items above.)*

8. **(a)8 remains unanswered.** Whether World itself refuses a repeat nullifier for the same action
   — and therefore whether one approver can legitimately approve two different unlocks under a
   single `bolt-unlock-approval` action, or whether we need an action per unlock — can only be
   learned by completing two real Selfie Checks. It is the first thing we will check on the
   device-side run.
