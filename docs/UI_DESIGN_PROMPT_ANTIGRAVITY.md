# BOLT — full UI rebuild prompt, for Antigravity

Paste this whole document as the build brief. It describes one app: every screen, the design
system, and which real backend endpoint each screen wires to. Nothing here should be mocked —
every route named below already exists and works.

---

## 0. What you're building

BOLT puts a business's customer money into on-chain accounts the business is physically unable to
spend from. The block is a policy evaluated inside a secure hardware enclave before any signing
key is assembled — a disallowed payment never produces a signature. A public page lets anyone
verify the money is there without trusting the business or BOLT. This is a **custody instrument**,
not a consumer wallet and not a generic SaaS dashboard. Treat every screen as if it belongs on a
piece of controlled financial equipment, not a startup's marketing site.

Build it **mobile-first**: a native-feeling app on a 390×844 iOS-style phone viewport, not a
website. No browser chrome, no desktop layout, no marketing hero sections, no scrolling landing
page in the SaaS sense.

The codebase is Next.js 15 (App Router) + TypeScript + Tailwind, at `apps/web` in a pnpm
workspace. **Every API route already exists and is real** — Privy policy enforcement, live
subgraph queries, a live LLM-backed "ask the monitor" endpoint, live Privy auth. Read
`apps/web/src/app/api/**` before building each screen so you wire to what's actually there rather
than inventing a data shape. Do not touch anything under `api/**`, `app/providers.tsx`,
`lib/operator-session.ts`, or `lib/format.ts` — those are backend/auth logic, already correct.
Everything else under `apps/web/src/app` is presentation and yours to (re)build.

---

## 1. Design direction: claymorphism, reconciled with Apple's design language

**Style: claymorphism** — soft, puffy, extruded matte surfaces with paired inner and outer
shadows. Its default register is playful (inflated pastel shapes, candy hues, bouncy overshoot),
which would destroy this product's only real asset, credibility. So the direction is restrained,
matte **instrument clay** — think the soft-touch rubber keypad on a piece of premium lab or studio
equipment, or the material language of Apple Wallet's card stack, not a children's app. Five hard
rules pin it there:

1. **No pastel or candy fills anywhere.** Colour appears only where it carries meaning (see §2).
2. **Matte only.** No gloss, no shine sweeps, no specular highlights, no glassmorphism, no
   decorative gradient washes. The one gradient allowed is a two-stop inner highlight that makes an
   edge look moulded rather than flat.
3. **Shadows are tinted with black only**, never colour, one fixed light source (top-left) on every
   surface on every screen, forever.
4. **No bounce.** Press-in is ~120ms ease-out. Springs, overshoot and squash are banned — this is
   soft-touch rubber over a rigid chassis, not jelly.
5. **One fully-extruded "hero" object per screen.** Everything else is barely lifted or pressed in.
   A screen that extrudes everything equally has said nothing; restraint is what makes the one bold
   object read as important.

The Apple half of the brief shows up as **materiality and interaction discipline**, not colour:
Apple's Human Interface Guidelines principles of clarity, deference and depth; a clear SF-Pro-style
type hierarchy; 44px+ touch targets; generous whitespace on a 4/8/16/24/48/96 spacing scale;
pill-shaped primary buttons; one primary action per screen, always reachable by the thumb.

**Extrusion is a semantic channel, not decoration.** Recessed ("well") surfaces are things the
machine controls and the person cannot touch — a locked balance, a policy condition, an on-chain
hash, a raw enclave refusal. Raised surfaces are things the person can act on — a button, an
editable field, an unsent form. A reader should learn this rule within one screen, and from then on
the material itself tells them which parts of this product are not theirs to move.

---

## 2. Palette — white primary, black secondary, nothing else

**White is the background. Black is the only accent** (buttons, primary ink, focus states, the
selected tab). No third colour, no chromatic hue, anywhere — no blue, no green, no red, no amber,
in either direction of meaning. This is a deliberate, repeated instruction: two prior passes at this
UI used a coloured or dark-first palette and were both rejected.

Greys are not a third colour — each one is black over white at a fixed opacity, resolved to a
stable hex, existing only so a surface can read as lifted or pressed relative to its neighbour
(claymorphism cannot render without at least one intermediate shade). Suggested ramp — adjust
precisely as needed, but stay within "black at N% over white":

| Token | Hex | Use |
|---|---|---|
| Ground | `#FFFFFF` | Page background. The dominant tone everywhere. |
| Ink | `#0A0A0A` | Primary text, primary buttons, focus rings. The only accent. |
| Shade 25 | `#FBFBFB` | Barely-seated surfaces |
| Shade 50 | `#F6F6F6` | Seated rows |
| Shade 100 | `#EFEFEF` | Well fill (recessed, machine-controlled content) |
| Shade 150 | `#E7E7E7` | Deep well fill (the refusal specimen) |
| Shade 200 | `#DCDCDC` | Hairlines, grooves |
| Shade 300 | `#C4C4C4` | Disabled ink |
| Shade 400 | `#A0A0A0` | Placeholder text |
| Shade 500 | `#7C7C7C` | Caption / secondary ink |
| Shade 600 | `#5A5A5A` | Stronger secondary ink |
| Shade 700 | `#3A3A3A` | Emphasis without weight |

**Semantic state without colour.** Refused/covered/pending/severity must be carried by **weight,
border style, and a glyph or word — never by hue**:
- *Covered / verified / signed*: full-weight ink, a thin solid border, a filled marker glyph.
- *Refused / severe*: bold ink, a **thicker** solid border (2px vs 1px), a filled square marker.
- *Pending / not yet proven*: mid-grey ink, a **dashed** border, a hollow marker.

One fixed light theme. No dark mode this pass.

---

## 3. Type

Two roles, not two decorative typefaces:
- **Interface text** (everything a person wrote or reads as prose/labels): a clean system-adjacent
  sans — SF Pro Text / -apple-system stack, or a deliberately chosen geometric-humanist sans if a
  system font isn't available in the target environment. Not a default "Inter because it's the
  default" choice — pick on purpose and say so.
- **Machine-emitted values only** — wallet addresses, transaction and policy hashes, block numbers,
  policy rule text, raw enclave error output — get a monospace face (SF Mono / ui-monospace stack).
  **Never for a label, never for body copy.** If it's mono, a machine produced it and the reader can
  go check it themselves; that's the whole point of the distinction.

All numerals tabular, always — columns of USDC amounts must line up.

Rough scale (pt, 390-wide phone): Amount 40/44 semibold −0.02em tracking · Title1 28/34 semibold ·
Title2 20/26 semibold · Headline 17/22 semibold · Body 16/24 regular · Callout 15/20 · Footnote
13/18 medium · Caption 12/16 medium, **sentence case, never uppercase** · Mono data 13/18.

Spacing scale: 4 / 8 / 16 / 24 / 48 / 96. Screen margin 16px. Card padding 20px. Section gap 24px.
Primary buttons 56px tall, full width, pill radius (999px). Touch targets ≥44px, 48px preferred.

---

## 4. Navigation — four shells, mobile-first

- **Operator shell — bottom tab bar.** A floating raised clay slab, ~64px tall, pill-radius corners
  (or 28px), inset from the screen edges and sitting above the home-indicator safe area. Five tabs:
  Coverage, Accounts, Activity, Approvals, Alerts. The selected tab is a **well pressed into the
  bar** with its icon/label in ink — selection reads as clay physics, not a colour swap. No
  floating-action-button anywhere: every consequential action in this product is slow and
  deliberate, so primary actions sit as full-width buttons at the end of the screen they belong to,
  above the tab bar, never floating over content.
- **Beneficiary shell — linear flow.** No tab bar. A back chevron top-left, one idea per screen, one
  full-width primary button at thumb height.
- **Public shell — scroll-spy pill bar.** No tab bar. A compact header (business name + a small
  "live, block N" indicator) and a bottom sticky segmented pill control with 3–4 anchors that jumps
  down the page and tracks scroll position.
- **Single-object shell.** Approver authorisation links, confirmations, refusal displays. No
  navigation chrome at all — one object, one decision, one button.

Every screen with a fixed bottom bar/nav must reserve equivalent bottom padding on its scrollable
content — a known failure mode in earlier passes was text clipping behind the sticky bar.

---

## 5. Motion

At most one orchestrated moment per screen. Press-in (120ms ease-out, no bounce) is the entire
interaction language and is always user-triggered. No scroll-reveal, no staggered entrances, no
hover-card effects, no animated counters, no confetti/celebration illustrations anywhere — not even
on a successful payment confirmation. Respect `prefers-reduced-motion`.

---

## 6. Copy discipline

Cut aggressively. Every screen prompt below carries a hard copy budget — treat it as a ceiling.
- Never restate a label the visual already gives.
- Sentence case everywhere. No ALL-CAPS eyebrow labels, no tracked-out headers.
- A button names what happens: "Request unlock", "Approve release", "Withdraw". Never "Submit",
  "Continue", "Learn more".
- Errors say what happened and what to do. Never apologise, never go vague.
- Empty states say what will fill them and why they're empty now.
- Never the words "compliant", "compliance", "certified", "guaranteed" — BOLT provides technical
  enforcement and public verifiability, and the copy must never imply more.
- State honestly what isn't proven yet (testnet is testnet; an index behind the chain head is
  behind head; a workflow store that's unreachable says so, not "loading" forever).

---

## 7. Avoid every generic AI-design tell

No uppercase tracked-out eyebrow labels · no monospace used for an ordinary label · no identical
rounded cards with the same shadow regardless of hierarchy (the extrusion tiers in §1 exist
specifically to prevent this) · no middle-dot-joined meta strings ("A · B · C") · no "Word —
fragment" em-dash labels · no → arrow glyphs on buttons or links · no warm-cream+terracotta or
near-black+neon-accent palettes (moot here — there's no colour to misuse) · no numbered 01/02/03
markers except where content is a genuine sequence (a setup wizard's steps, a quorum's approval
seats) · no big-number-plus-gradient-plus-stat-row hero treatment.

The one place the design is allowed to be bold: **the raw policy-refusal display.** Wherever
Privy's enclave returns a refusal, show its exact, unedited error body — full weight, generous
size, in mono, in the deepest well on the screen. It's the single most persuasive object in the
product; everything around it should stay quiet by comparison.

---

## 8. Screens to build

Build a shared component kit first — buttons (primary/secondary/consequence/quiet-text), inputs
(every input is a "well," recessed, with a floating 12pt caption label), the **value-and-source**
pattern used everywhere a figure appears (a big tabular number with a small mono caption underneath
naming the block/tx/address it came from, plus an explorer-link icon — never a bare number), the
raw-refusal display component, the bottom tab bar, status chips, and empty/loading/error/
not-yet-proven states. Every screen below composes from this kit.

### Landing (`/`)
Server component. Reads real businesses + coverage history via `@bolt/core`'s `queryBusinesses` /
`queryBusinessBySlug` / `queryCoverageHistory` (see `apps/web/src/app/api/**` for the exact
functions already in use elsewhere). One plainly-set headline statement, two sentences of body copy,
two stacked buttons ("See a live business's page", "Try to break it"). Then three evidence sections
— not three identical cards: (1) the real policy conditions in mono inside a well, (2) a real
recorded refusal (pull one verbatim from `docs/evidence/*.json` if present, or wire live), shown at
full weight as the hero object, (3) a coverage-through-time teaser linking to the auditor view.
Close with the product's standing line. No pricing, no logo wall, no testimonials, no feature grid.
Bottom scroll-spy pill bar with 3 anchors.

### Simulator (`/simulator`)
Wires to `apps/web/src/app/api/simulator/route.ts` and `app/simulator/sandbox.json`. A stranger is
handed the operator's seat on a real locked sandbox account and invited to steal from it. Show the
account under attack (address, permitted payee, policy hash, live balance) all in mono with explorer
links. A free-text address field (not a picker — nothing here is validated client-side, matching the
real route). A vertical list of the real attack options the route supports, each with a one-line
caption naming what stops it. The result renders as the raw refusal specimen — the visual centrepiece
of this screen. A tally of attempts/refusals/signed-through, reset-on-restart, stated plainly.

### Ask the Monitor (`/ask`)
Wires to `apps/web/src/app/api/ask/route.ts`. One query field (real placeholder example question), one
button. The answer renders as prose (not bullet soup) with its evidence as a list of block
numbers/tx hashes, each linking to the explorer. Handle the real degraded states this route
actually returns (reasoning-unavailable-but-evidence-still-shown; monitor-unreachable) without
treating either as a generic error screen.

### Public solvency page (`/[slug]`)
The most important screen. Wires to the same `@bolt/core` subgraph queries as the landing page, for
a specific business slug. Header statement, a coverage-over-time hero chart (the 100% line rendered
as a literal groove pressed into the card — not a plain chart line), an owed-vs-held table per
account class, an accounts list with every address linking to the explorer ("don't trust this page,
check it yourself"), full unlock history, and a "find my balance" lookup. Surface any severe monitor
findings near the top. An honest limits footer (testnet, what isn't proven) at full body size, never
fine print.

### Auditor view (`/auditor`)
Wires to `apps/web/src/app/api/auditor/route.ts`. Read-only version of the public page's content
with a permanent non-dismissible banner saying so, plus a time-machine control to reconstruct state
at any past indexed block, plus a JSON export with a note that BOLT doesn't sign the export (a
signature from BOLT would prove nothing worth accepting).

### Beneficiary claim flow (`/claim`)
Wires to `apps/web/src/app/api/beneficiary/route.ts` and `.../beneficiary/claim/route.ts`, plus
real Privy client auth. A linear flow: sign in (email, no password field anywhere in this product) →
identity check (a World Selfie Check step — ready/waiting/verified/rejected states, showing World's
own response verbatim on rejection) → balance (outstanding amount as the hero, with source caption)
→ withdraw (amount, destination address, same-chain vs. bridge-to-another-chain choice, and the
real branch: previously-verified destination skips the check, a new destination requires a fresh
one) → confirmation (transaction + settlement hashes, updated balance, no celebration animation).

### Operator dashboard (`/operator` + sub-routes)
Bottom tab bar shell. Wires to `apps/web/src/app/api/operator/**` (business, mandate,
policy-preview, session, unlock, workflow) plus Privy auth for sign-in.
- **Sign in** — email only, no tab bar, states for resting/link-sent/workflow-store-unreachable.
- **Setup** (only if unpublished) — a short numbered sequence: business name/slug, account classes
  (client money / obligation reserve / operating, the first two rendered as permanently-locked
  wells), split rule (a running-total validator as the hero, must hit exactly 100% before
  continuing), approvers (name five people, state the quorum threshold as a sentence not a badge),
  review (state honestly that a quorum's signing keys can't be generated from a browser — direct to
  a CLI step rather than faking a "publish" button that would do nothing real).
- **Coverage (home)** — the daily screen. Coverage hero chart, per-class breakdown (locked classes'
  balances live inside wells, the operating account's balance sits on raised clay — that one
  material difference states the whole product), an open-ceremony card if one exists, severe
  findings surfaced above everything else.
- **Accounts** — grouped by class, locked accounts get a padlock glyph and a plain-English "what
  this account can do" chip; operating renders visibly differently (raised, no lock).
- **Account detail** — held/owed hero, the policy in plain English plus a disclosure revealing the
  raw machine-readable policy and hash, transaction history, a "request an early unlock" button at
  the very bottom (deliberately not floating — this action is slow on purpose).
- **Split rule editor** — the plain-language sentence builder, a running-total validator as the
  hero, a real replay-against-last-30-days comparison table, version history.
- **Request early unlock** — account picker, amount, a genuinely free-text destination field (say
  explicitly in the UI that this isn't validated — the enclave is what refuses it, not the app),
  a reason field whose hash goes on-chain, a summary hero.
- **Unlock ceremony / approvals** — five approval seats as a hero object (numbering is fine here,
  it's a genuine sequence), each approver's state, the on-chain 24-hour timer in both its
  not-yet-armed and counting-down states, a permanent note that every step appears on the public
  page within a minute.
- **Team & approvers**, **Alerts** (inbox + finding detail, evidence table with explorer links, no
  dismiss button, only "mark as investigated"), **Settings** (read-only where a value isn't the
  user's to change — never a disabled toggle, which is a lie about who's in control).

### Unlock approval (`/approve/[unlockId]`)
Single-object shell, no navigation. Opened from a link on the approver's own phone. Amount, from/to
wells with explorer links, the full typed reason (never truncated) with its hash verified against
chain, the same five-seat quorum hero, a verify-then-approve button with real Selfie-Check gating,
and the real failure states (World rejected the check; a proof already used for this ceremony) shown
verbatim.

---

## 9. Verification

Build mobile-first and verify every screen at a 390px viewport before considering it done — actually
render it, don't just write the code and assume. Run the project's test suite and production build
before finishing; both must pass clean.
