# BOLT — UI design direction and Stitch prompt

Two parts. **Part 1** is the design rationale: the brainstorm, the self-critique against generic
AI-design defaults, and the resolution. It exists so that anyone reading Part 2 knows *why* the
prompt says what it says. **Part 2** is the prompt itself — self-contained, paste-ready for Google
Stitch, written as if Stitch has never heard of BOLT.

Nothing here is code and nothing here has been implemented. It is a design brief.

---

# Part 1 — Design rationale

## 1.1 What is actually being designed

BOLT's credibility is its entire product. The claim is *"we removed the ability to move this money,
and here is a page where you can check that yourself."* A design that looks like a consumer fintech
app makes that claim sound like marketing. A design that looks like an instrument — a gauge, an assay
mark, a bank plate — makes it sound like a measurement.

So the design job is not "make a finance app look nice". It is: **make verifiability visible.**
Every figure on the public page traces to an on-chain event or balance (invariant 8); the design must
show that lineage as a *structural* fact, not a footnote. And the single most persuasive object in
the product is Privy's raw refusal string. That is the hero, not a hero stat.

Two audiences, one language:

- **Operator** (finance lead, admin, approver) — Android app, used at a desk and on a phone, daily.
- **Public** (a customer, a seller, an auditor, a judge) — arrives skeptical, leaves having checked.

## 1.2 Brainstorm — token system

### Color

Silver-grey was the brief's starting point and it survives, because it is materially true to the
subject: machined steel, a deposit-box door, a hallmarked plate. But generic grey plus generic blue
is where every enterprise fintech lands, so the palette is pinned to a specific material story:
**oxidised silver** (a cool grey-green neutral, not a warm or blue grey) with **blued steel** as the
one interactive hue — gun-bluing is the real chemical finish on worked steel, and it is a dark,
desaturated navy-slate that is nothing like fintech's bright #2563EB.

The identity accent is deliberately *not* green and *not* red, because this product needs both of
those as semantics: green means covered, red means refused. Hue in BOLT is a statement about money,
never a decoration.

| Token | Light | Role |
|---|---|---|
| `--ground` | `#E9EBE8` | Page background. Milled steel, faint green-grey cast. Never cream, never white. |
| `--plate` | `#F4F5F2` | Raised surface — panels and anything the operator may act on. |
| `--inlay` | `#DCDFDA` | **Recessed** surface — darker than ground. Anything the machine controls: locked accounts, policy text, on-chain values. |
| `--ink` | `#171C1A` | Primary text. Oxidised-silver black, not a tinted chrome near-black. |
| `--steel` | `#656E69` | Secondary text, provenance lines, hairlines at 40% alpha. |
| `--blued` | `#24404F` | The only interactive hue: links, primary buttons, focus ring, selected nav. |

Semantics, used nowhere except for their meaning:

| Token | Light | Meaning |
|---|---|---|
| `--covered` | `#2F6B55` | Coverage ≥ 100%, permitted destination, verified human, signed. |
| `--refused` | `#8A2822` | Policy refusal, shortfall, severe Monitor finding. Deep iron-oxide, **not** warm clay. |
| `--pending` | `#8A6A1F` | 24-hour timer running, quorum incomplete, indexer behind head, "not yet proven". |

Dark mode is a **night plate**, not a neon console: `--ground #141817`, `--plate #1D2321`,
`--inlay #0E1211`, `--ink #E6E9E5`, `--steel #97A09A`, `--blued #7FB0C8`, `--covered #6FBE9B`,
`--refused #E08078`, `--pending #D6B25E`.

### Type

One superfamily, three registers, and the register carries meaning:

- **IBM Plex Serif** — published claims only. The public page headline and its standing statement
  paragraphs. It says *this is a document, not a screen*.
- **IBM Plex Sans** — the entire interface, both apps. Institutional, engineering-flavoured, with
  enough character (the flared stems, the humanist `a`) to not read as Inter-by-default.
- **IBM Plex Mono** — machine truth only. Addresses, hashes, policy grammar, block numbers, raw
  enclave errors. Mono is never used for a label; if it is mono, a machine produced it.

That rule does real work: a reader learns within one screen that mono text is checkable and sans
text is ours. Scale (Android sp, Material 3 aligned): Display 36/44, Headline 28/36, Title large
22/28, Title 16/24 medium, Body 16/24 and 14/20, Label 12/16 medium **sentence case**, Mono data
13/18 tabular. Amounts use tabular figures always. Measure ≤ 68ch sans, ≤ 74ch serif.

### Layout

The organising device is the **value-and-source pair**: no figure appears alone. Every amount,
ratio and status is set immediately above a small steel-coloured provenance line naming the block,
the transaction or the address it came from, with the explorer link on that line. It is not a
tooltip and it is not a footnote — it is the same component everywhere, and it is the layout
expression of invariant 8. On wide screens these stack into a left-hand **datum rail** running down
the public page.

Android: 4-column compact grid, 16dp margins, 8dp baseline, bottom navigation with five
destinations, navigation rail at ≥600dp, expanded 12-column at ≥840dp. Public page: 12 columns,
1120px max, 720px reading column, tables full-bleed with horizontal scroll.

Alignment is left throughout; numbers right-align in tables with tabular figures. Centred layout is
permitted only where a screen holds exactly one object (an approval, a confirmation, a refusal).

### Principles

1. **Every number wears its source.** If it cannot show a block, a transaction or an address, it
   does not get to look like a fact.
2. **Depth encodes lock state.** Recessed (inlay, inset hairline) = the machine controls it and you
   cannot. Raised (plate, shadowless tonal elevation) = you can act on it. This is the one idea the
   whole visual system is built on, and it is semantic rather than decorative.
3. **The refusal is the hero.** Printed verbatim, monospaced, never styled into a friendly error.
4. **A rule must mean something.** Dividers appear only where they separate a value from its
   provenance or one class of money from another. No decorative hairlines.
5. **Weight matches consequence.** Nothing irreversible is one tap away from a floating button.
6. **State what is not proven.** "Awaiting a device", "testnet only", "mint did not land" get the
   same typographic dignity as the successes. The honesty is the brand.

### Wireframes

**Operator home (Android compact, 360–412dp)**

```
┌───────────────────────────────┐
│ Acme Marketplace          ⌄ ⚙ │  top app bar, business switcher
├───────────────────────────────┤
│                               │
│  Coverage                     │  Title
│  ┌─────────────────────────┐  │
│  │      ╱╲      ╱──────    │  │  engraved coverage plot, 7d
│  │ ────╱──╲────╱────────── │  │  ← 100% datum, engraved inset rule
│  │                         │  │
│  │ 104.2%   all classes    │  │  tabular, Display size
│  │ block 8 412 097 · 11:04 │  │  provenance line, steel, linked
│  └─────────────────────────┘  │
│                               │
│  By class                     │
│  ┌ ▣ Client money ──────────┐ │  ▣ = recessed lock plate icon
│  │ held 340 000.00 USDC     │ │
│  │ owed 340 000.00 USDC     │ │
│  │ 100.0% covered · yield off│ │  covered green, small
│  │ 0x9f3a…c210 ↗            │ │  mono, explorer link
│  └──────────────────────────┘ │
│  ┌ ▣ Tax reserve ───────────┐ │
│  │ 92.4% — shortfall        │ │  refused red
│  └──────────────────────────┘ │
│                               │
│  Needs you                    │
│  ┌──────────────────────────┐ │
│  │ Unlock #418  2 of 3       │ │  quorum pips ●●○
│  │ 23h 41m before executable │ │  pending amber
│  └──────────────────────────┘ │
│                               │
├───────────────────────────────┤
│  ⬒      ▤      ≡      ◎     ⚑ │  bottom nav, no FAB
│ Cover  Accts  Activity Appr Alerts
└───────────────────────────────┘
```

**Public solvency page (desktop ≥1024px)**

```
┌──────────────────────────────────────────────────────────────────┐
│ BOLT                                    Acme Marketplace  ·  live │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Acme Marketplace holds 340 000.00 USDC                         │  Plex Serif, 40/48
│   for its sellers in accounts it cannot pay itself from.         │
│                                                                  │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │  coverage, 90 days                    ┌ client money  ─── │ │  THE HERO
│   │                                       │ tax reserve   ─ ─ │ │
│   │  110% ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │
│   │  100% ════════════════════════════════════════════════════ │ │  engraved datum
│   │        ╱‾‾╲___╱‾‾‾‾‾‾╲______╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾    │ │
│   │   90%                    ▼ unlock #402                     │ │  events on the axis
│   │        Jun          Jul          Aug          Sep          │ │
│   └────────────────────────────────────────────────────────────┘ │
│   Every point is an indexed CoverageSnapshot. 4 117 of them.      │
│                                                                  │
├────────────┬─────────────────────────────────────────────────────┤
│ datum rail │  Owed vs held, by class                             │
│            │  ┌───────────┬─────────┬─────────┬──────┬────────┐  │
│ block      │  │ class     │ held    │ owed    │ cov. │ yield  │  │
│ 8 412 097  │  ├───────────┼─────────┼─────────┼──────┼────────┤  │
│ 11:04 UTC  │  │ Client    │ 340 000 │ 340 000 │ 100% │ off    │  │
│ 6s ago     │  │ Tax       │  25 880 │  28 000 │ 92%  │ on     │  │
│ ↗ explorer │  └───────────┴─────────┴─────────┴──────┴────────┘  │
│            │  Client money never earns. That is the account      │
│            │  class, not a setting we can flip.                  │
│            │                                                     │
│            │  Accounts            [each row: address ↗ · policy] │
│            │  Unlocks ever performed   [reason · approvers · tx] │
│            │  Find my balance          [email → address ↗]       │
└────────────┴─────────────────────────────────────────────────────┘
```

**Approver mobile page (the one screen a quorum member ever sees)**

```
┌───────────────────────────────┐
│ ← Unlock #418                 │
├───────────────────────────────┤
│                               │
│   Release 12 000.00 USDC      │  Display, tabular
│                               │
│   from  Tax reserve           │
│         0x4c1b…88fa ↗         │  mono, inlay-recessed block
│   to    Revenue authority     │
│         0x77de…901c ↗         │
│                               │
│   "Q2 filing, due 31 July,    │  the typed reason, body 16
│    ref VAT-2026-Q2."          │
│   keccak 0x9ab3… matches the  │  steel + covered tick
│   hash committed on chain ✓   │
│                               │
│   ●  ●  ○     2 of 3 approved │  quorum pips, engraved seats
│   ┌──────────────────────────┐│
│   │ Rania K.   approved 09:12││
│   │ selfie check ✓ 0x2f…a1   ││
│   │ Tom V.     approved 09:40││
│   │ selfie check ✓ 0x8c…4d   ││
│   │ you        not yet       ││
│   └──────────────────────────┘│
│                               │
│  ┌────────────────────────────┐
│  │  Verify it is you          │  blued, 56dp, full width
│  └────────────────────────────┘
│   A World Selfie Check runs   │
│   before your approval counts.│
│                               │
│   After the third approval a  │
│   24-hour timer starts on     │
│   chain. Nobody can shorten   │
│   it, including us.           │
└───────────────────────────────┘
```

## 1.3 Morphism survey — and the commitment

Assessed against *this* product: a trust instrument whose job is to make a claim checkable.

**Claymorphism** — inflated, soft-shadowed, high-radius pastel shapes. Reads as playful, tactile,
low-stakes; it is the vocabulary of a habit tracker. Applied to a page stating how much of other
people's money is held, it undercuts the claim faster than any wording could. Rejected outright.

**Neumorphism** — the temptation, because BOLT's whole metaphor is a worked metal plate, and
neumorphism is literally extruded-from-the-surface. But its fatal flaw is exactly the thing BOLT
cannot afford: near-zero contrast between control and background, notoriously failing WCAG and
making "can I press this?" ambiguous. A product whose pitch is *unambiguous refusal* cannot have
ambiguous buttons. Rejected as a system — but its **one good idea, that recession and extrusion are
readable states, is kept and repurposed** (see below).

**Brutalism / neo-brutalism** — raw, oversized type, hard black borders, unstyled defaults, visible
structure. Genuinely tempting: it signals "we are not selling you anything", which matches the
honesty posture, and the raw-error aesthetic is native to it. Rejected as the primary system for two
reasons: its offset hard shadows and acid pops are now a recognisable trend costume rather than
honesty, and the operator app is a daily tool for a finance lead who needs density, quiet and
scanability over a decade of use, not a poster. Its residue survives in exactly one place — the
refusal specimen, which really is set raw.

**Skeuomorphism** — full material illusion (leather, stitching, brushed-metal photo-textures).
Wrong as a wholesale style: it dates instantly and it implies the interface is *pretending* to be a
physical object, which invites the reading that the security is also a pretence. But the
*instrument* subset — engraved rules, milled edges, stamped hallmarks, seated bolts — is the
subject's real vernacular and carries meaning cheaply. Kept as an accent vocabulary, never as a
texture.

**Glassmorphism** — frosted translucent panels over a colourful blur. The reflex choice for fintech
and the wrong one here: translucency literally means *you can see through this and it might not be
solid*. Nothing about BOLT should look provisional or floaty, dense financial tables lose legibility
behind blur, and the blur cost on mid-range Android is real. Rejected, and rejected specifically
because it is the default — not because it is ugly.

**Flat / Material 3** — tonal surfaces, semantic elevation, no fake depth, world-class accessibility
and component behaviour, and it is the native idiom of the target platform. Its weakness is that on
its own it is anonymous: Material 3 with a grey palette is indistinguishable from a thousand
enterprise apps.

**Swiss / International typographic** (not a morphism, but the honest fourth option) — grid, type
hierarchy, no ornament. Excellent bones, and the discipline underneath the type scale here, but as a
complete answer it produces the broadsheet look the AI-tell list warns about.

**Committed direction: "Engraved Material" — Material 3 structure, instrument vocabulary, one
semantic depth rule.**

Material 3 provides the shell, the components, the accessibility floor and the Android-native
behaviour. On top of it sits one idea, borrowed from the honest half of neumorphism and executed
with the restraint of skeuomorphism's instrument tradition:

> **Depth means lock state. Recessed surfaces are things the machine controls and you cannot;
> raised surfaces are things you can act on.**

A locked account balance sits in an inlay — a panel darker than the page, with a 1px inner shadow at
the top edge and a 1px light hairline at the bottom, as if milled into the plate. A policy condition,
an on-chain hash, a coverage figure: all recessed. A button, an editable mandate rule, an unsent
form: raised on `--plate`, tonal, no drop shadow. The user learns the rule in one screen and it then
tells them, everywhere and without words, which parts of this product they are allowed to move.

This beats the alternatives for BOLT specifically because it is the only one of them where the
*visual* system encodes the *product's* central claim rather than decorating it. Glass would say
"modern". Clay would say "friendly". Brutalism would say "authentic". Engraved Material says
"this part is not yours to move", which is the actual sentence BOLT is selling.

## 1.4 What "premium" means here

Not gloss. For a compliance-adjacent trust tool, premium is: tabular figures that never shift width
as they tick; a 90-day chart that renders at 60fps on a 3-year-old Android; a full 42-character
address shown rather than truncated whenever the width allows; provenance links that actually
resolve; empty states that say what will fill them; loading states that admit the indexer is 40
blocks behind rather than spinning a lie; identical vertical rhythm across every screen; and copy
that never once uses a word it cannot defend. Premium is the absence of anything that would make an
auditor raise an eyebrow.

## 1.5 "Apple thinking, Android body" — resolved concretely

The brief asks for Apple's design *thinking* on an Android-native shell. That resolves into four
concrete rules, not a visual skin:

1. **Deference** (Apple) → the chrome recedes so the data is the interface. Concretely: no coloured
   app bars, no branded headers on data screens, no iconography competing with numbers. **Android
   body**: that deference is executed as Material 3's surface tinting and a plain top app bar, not
   as iOS large titles or a translucent tab bar.
2. **Clarity** (Apple) → one idea per screen, ruthless type hierarchy, nothing decorative competing
   with the primary figure. **Android body**: the hierarchy is the Material type scale in `sp` with
   the system font fallback intact, and it must survive the user's font-size and display-size
   settings up to 200% without clipping.
3. **Depth** (Apple) → depth communicates state, not style. **Android body**: implemented with M3
   tonal elevation and the engraved-inlay treatment, **not** iOS blur materials or parallax.
4. **Restraint in motion** (Apple) → few, purposeful, interruptible. **Android body**: Material
   motion — shared-axis transitions between nav destinations, container transform from an account
   row into its detail, predictive-back aware so the gesture peels the screen back rather than
   cutting. No entrance animations on scroll.

What is explicitly *not* imported from iOS: no bottom sheet used as primary navigation, no iOS
segmented controls, no back-chevron-with-label in place of a real Android back affordance, no
system-font substitution, no centred nav titles on data screens.

## 1.6 Self-critique against the generic-AI-design tells

Run honestly against the five known clusters, with what changed.

**(a) Cream + high-contrast serif + terracotta.** Two near-misses. The ground `#E9EBE8` is a cool
grey-green, not cream `#F4F1EA` — but it was drifting warm in the first pass and has been pulled
cooler and explicitly pinned. The serif was originally proposed for headlines product-wide, which is
exactly the tell; **revised**: Plex Serif is now permitted *only* on the public solvency page's
headline and standing statement paragraphs, and is forbidden anywhere in the operator app, where it
would be costume. The refusal red was checked against terracotta `#D97757` and deliberately pushed
to a deep, low-chroma iron-oxide `#8A2822`, and it is **forbidden as a decorative accent** — it may
only appear on an actual refusal or shortfall.

**(b) Near-black + one neon accent.** The dark theme was the risk. **Revised**: dark mode is
specified as a graphite plate with the *same* muted semantic hues lifted for contrast, and saturated
neon greens, cyans and vermilions are explicitly banned in the prompt. No glow, no `box-shadow` in
an accent colour.

**(c) Broadsheet hairlines, zero radius, dense columns.** Real risk, since "engraved" invites
hairlines everywhere. **Revised** with two hard rules: a rule or divider may only appear where it
separates a value from its provenance or one account class from another — decorative rules are
banned; and radius is not zero but *semantic*: 4dp on recessed/locked elements (tight, machined),
16dp on interactive cards and inputs, 28dp on dialogs and sheets. Hierarchy therefore reads in the
radius rather than being flattened by one global value.

**(d) The SaaS card kit.** Present in the first pass as "class cards". **Revised**: identical
rounded cards with a uniform `rgba(0,0,0,.1)` shadow are banned outright. There are exactly three
surface levels with defined meanings (ground, plate, inlay), elevation is tonal, and drop shadows
are permitted only on genuinely floating elements — dialogs, menus, snackbars — per Material 3.
Gradient washes as decoration are banned; the only gradient in the system is the two-stop emboss on
the refusal seal.

**(e) Template chrome.** The current shipped code is full of it — `uppercase tracking-wide` on every
`<dt>`, middot-joined meta strings, `— fragment` labels, a `→` in link text. All of it is now
explicitly banned in the prompt: labels are sentence case at 12sp/500; meta is separated by layout
and whitespace, not middots; mono is reserved for machine-produced values and never for labels; no
arrow glyphs appended to buttons or links. The single permitted exception is the small-caps
"refused" punch mark on the refusal specimen — allowed because it is a stamp doing semantic work
once per object, not an eyebrow above a heading.

**One more cut, per Chanel.** The first pass had four 3D accents. The lock-plate illustration and
the axonometric icon set are demoted to quiet system furniture, and the boldness budget is spent in
exactly two places: **the refusal specimen** (operator and simulator) and **the engraved coverage
plot** (public page). Everything else stays flat and quiet.

## 1.7 3D accents, named, with guardrails

| Accent | Where | Guardrail |
|---|---|---|
| **The engraved coverage plot** *(primary spend)* | Public page hero, operator home | The 100% datum is drawn as a true engraved rule: one 1px `--steel` line with a 1px `--plate` highlight directly beneath it. Area under the curve is a 6% opacity milled hatch, not a gradient. Pure SVG/CSS — no WebGL, no charting library's 3D mode, no scroll-scrubbed animation. Must be legible in a screenshot and in print. Draw-in animation on first load only, 400ms, disabled under `prefers-reduced-motion`. |
| **The refusal seal** *(primary spend)* | Refusal specimen, simulator and unlock screens | An embossed hallmark punch beside the raw error: one radial gradient plus one inner shadow, two layers maximum, ≤4KB SVG. `aria-hidden`; it must never overlap or sit behind the error text; it is removed below 360dp width. Decorative only — the meaning is carried by the text. |
| **The lock plate** *(quiet)* | Account detail header, account list rows (24dp) | A flat axonometric line drawing at a fixed 30° projection: a plate with a recessed circular seat and a bolt seated in it. Two flat tones plus one highlight, single 1.5px stroke, static SVG. One 200ms bolt-seat animation permitted, only on the moment an account's policy is confirmed, never on page load. Degrades to a flat 2D lock glyph under reduced motion. |
| **Axonometric icon set** *(quiet)* | System-wide | Five to eight icons — plate, bolt, split, stamp, eye — at the same 30° projection and 1.5px stroke as the lock plate, so the family is coherent. Total sprite ≤20KB. Must read unambiguously at 24dp. No per-icon gradients, no colour beyond `currentColor` plus one optional `--steel` fill. Where a Material Symbol already communicates better at 24dp, use the Material Symbol — the axonometric set is not a completeness exercise. |

---

# Part 2 — The Stitch prompt

> **How to use this.** Paste **§A (system preamble)** first, then append the single **screen block**
> you want generated. Generating one screen per prompt with the preamble repeated produces far more
> consistent output than pasting the whole document at once. Screen blocks are written to be
> independent.

---

## §A — System preamble (paste this before every screen block)

**Product.** BOLT — Beneficiary-Only Ledger Transfers. A business that holds other people's money —
a marketplace holding sellers' balances, sales tax owed to a government, payroll — splits every
incoming payment the moment it arrives into separate accounts that are *cryptographically incapable*
of paying anyone except the rightful owner. The block on spending is not application code; it is a
policy evaluated inside a secure hardware enclave before a signing key is ever assembled, so no
signature is produced for a disallowed payment. BOLT also publishes a page that anyone can use to
verify the money is there, without trusting the business or BOLT.

**Two audiences, one design language.**
1. An **operator** — a finance lead or admin at that business, on an Android phone and tablet, daily.
2. The **public** — a customer, a seller owed money, an auditor or a skeptical stranger, on any
   device, arriving once and leaving either convinced or not.

**The design must read as an instrument, not an app.** It should look like it belongs on a screen in
a bank's compliance department: precise, quiet, dense where density helps, and visibly checkable.
It must not look like a consumer money app — no playful illustrations, no celebratory confetti, no
motivational copy, no gradient hero blobs.

### Visual system

**Palette (light).** Use these exact values.
- `#E9EBE8` — page background. A cool grey-green "milled steel". Never cream, never pure white.
- `#F4F5F2` — raised surface. Panels, cards, anything the user can act on.
- `#DCDFDA` — **recessed** surface, darker than the page. Anything the machine controls and the user
  cannot: locked balances, policy text, on-chain hashes.
- `#171C1A` — primary text.
- `#656E69` — secondary text, provenance lines, hairlines (use at 40% opacity for rules).
- `#24404F` — "blued steel". The **only** interactive colour: links, primary buttons, focus rings,
  selected navigation.

**Semantic colours — use only for their meaning, never as decoration.**
- `#2F6B55` green — coverage at or above 100%, a permitted destination, a verified person, a signed
  transaction.
- `#8A2822` deep iron-oxide red — a policy refusal, a shortfall, a severe alert. This is not orange
  and not terracotta; keep it dark and low-chroma.
- `#8A6A1F` amber — a timer running, an incomplete approval quorum, data not yet confirmed, anything
  honestly labelled "not yet proven".

**Palette (dark).** `#141817` background, `#1D2321` raised, `#0E1211` recessed, `#E6E9E5` text,
`#97A09A` secondary, `#7FB0C8` interactive, `#6FBE9B` green, `#E08078` red, `#D6B25E` amber. Dark
mode is a night plate, not a neon console — no glowing accents, no saturated cyan or lime, no
coloured shadows.

**Typography — IBM Plex, three registers, and the register carries meaning.**
- **IBM Plex Serif** — the public solvency page's headline and its standing statement paragraphs
  only. It signals "a published claim". Never use it in the operator app.
- **IBM Plex Sans** — all interface text everywhere.
- **IBM Plex Mono** — machine-produced values only: wallet addresses, transaction hashes, policy
  hashes, block numbers, policy rule text, raw error output. Never use mono for a label or for body
  copy. If it is mono, a machine produced it and the reader can check it.

Scale: Display 36/44 medium, tracking −0.02em (once per screen at most) · Headline 28/36 ·
Title large 22/28 · Title 16/24 medium · Body 16/24 and 14/20 · Label 12/16 medium, **sentence case**
· Mono data 13/18. All numerals tabular, always. Reading measure at most 68 characters (74 for
serif). Left-aligned throughout; right-align numbers in table columns. Centre a layout only on
screens holding a single object.

**The one structural idea: depth means lock state.**
- **Recessed** (`#DCDFDA` panel, 4dp radius, 1px inner shadow along the top edge, 1px light hairline
  along the bottom edge — as if milled into a metal plate) = the machine controls this; the user
  cannot change it. Locked balances, policy conditions, on-chain values, hashes.
- **Raised** (`#F4F5F2` panel, 16dp radius, tonal elevation, **no drop shadow**) = the user can act
  on this. Buttons, inputs, editable rules, unsent forms.
- Drop shadows are permitted *only* on genuinely floating elements — dialogs, menus, snackbars.

**The second structural idea: every number wears its source.** No figure ever appears alone. Under
every amount, ratio or status, set a 12sp line in `#656E69` naming where it came from — a block
number, a transaction hash, a wallet address — with the block-explorer link on that line. Use the
identical pattern on every screen. It is the visible proof that these numbers are checkable and not
invented.

**Radius is semantic, not global.** 4dp on recessed/locked elements · 16dp on interactive cards and
inputs · 28dp on dialogs and sheets.

**3D and depth accents, restrained.** Exactly two places carry visual weight: the coverage chart's
engraved 100% datum line (one dark 1px rule with a 1px light rule directly beneath, area fill as a
6%-opacity hatch — never a gradient), and the refusal specimen's embossed stamp (two layers
maximum). Elsewhere, a small set of axonometric line icons at a fixed 30° projection and 1.5px
stroke — plate, bolt, split, stamp, eye — plus a single axonometric "lock plate" illustration (a
plate with a recessed seat and a bolt seated in it) used at the account-detail header. Flat, two
tones and one highlight, no gradients, no photorealism, no 3D rendering.

### Android platform requirements (the operator app)

- Material 3. Bottom navigation bar with five destinations: Coverage, Accounts, Activity, Approvals,
  Alerts. Navigation rail at ≥600dp width, expanded two-pane layout at ≥840dp.
- **No floating action button anywhere.** Every consequential action in this product is slow and
  deliberate — a three-of-five approval ceremony, a quorum-signed policy change — and a floating
  shortcut would misrepresent its weight. Primary actions live in context, as full-width 56dp
  buttons at the end of the screen they belong to.
- Plain top app bar, no colour fill, no centred title on data screens. Business switcher on the left,
  settings on the right.
- Predictive-back aware: back peels the current screen away rather than cutting.
- Material motion only: shared-axis transitions between navigation destinations, container transform
  from a list row into its detail. No entrance animation on scroll, no hover effects, no per-card
  animations.
- 48dp minimum touch targets, 16dp screen margins, 8dp baseline grid.
- Layouts must survive the user's font-size and display-size settings up to 200% without clipping.

### Copy rules — these are strict

- **Never use the words "compliant", "compliance", "certified" or "guaranteed"** about what this
  product does. BOLT provides technical enforcement and public verifiability. It does not make
  anyone compliant with any regulation, and the interface must never imply it does.
- Sentence case everywhere. No ALL-CAPS labels or eyebrow text above headings.
- No meta strings joined with middle dots. No "Word — fragment" labels with a spaced em dash. No
  arrow glyph appended to buttons or links.
- Active voice, and a button names exactly what happens: "Request unlock", "Approve release",
  "Withdraw to my bank address". Never "Submit", "Continue" where something specific happens, or
  "Learn more".
- Errors say what happened and what to do. They never apologise and are never vague.
- Empty states say what will fill them and why it is empty now.
- State honestly what is not yet proven. "No approver has completed a check yet" is better than an
  empty table, and a placeholder number is never acceptable.

### Do not

Do not use frosted glass or blurred translucent panels. Do not use soft inflated pastel shapes. Do
not use offset hard-shadow neo-brutalist blocks. Do not chop the content into identical rounded
cards with the same soft grey shadow under each. Do not use gradient washes as decoration. Do not
use a cream background, a warm terracotta accent, or a bright saturated fintech blue. Do not use
photographic textures or metal photo-fills — the metal is implied by colour and by engraved rules,
never by a picture of metal. Do not truncate an address when there is width to show all of it. Do
not render any number without its source line.

---

## §B — Screen blocks

### B1. Operator — sign in

Android phone. A single centred object on the milled-steel background: the BOLT wordmark in Plex
Sans medium, the line "Sign in to Acme Marketplace", an email field, a 56dp blued primary button
"Send sign-in link", and a secondary text button "Use a passkey". No password field anywhere — this
product has no passwords. Small `#656E69` footer: "BOLT never holds your keys, and cannot move money
out of your locked accounts." Dark mode variant too.

### B2. Operator — business setup, five steps

A stepped flow, one step per screen, with a slim linear progress indicator under the top app bar
(not numbered circles).
1. **Business** — legal name, public page address (`bolt.app/` prefix shown inline in the field, mono
   for the slug itself), and the live preview of the resulting URL.
2. **Account tree** — pick which classes of money this business holds. Three selectable recessed
   plates: *Client money* (money that belongs to your customers), *Obligation reserve* (money owed to
   institutions — tax, payroll), *Operating* (your own). Each shows one plain-English line of what
   its lock will permit. Client money and obligation reserve are shown as permanently locked with the
   axonometric lock-plate icon; operating is shown unlocked, visually raised.
3. **Split rule** — a plain-language sentence builder: "Every payment we receive → __% to sellers,
   __% to sales tax, __% to operating." Percentages as large tabular inputs. A persistent running
   total that reads "100.00% allocated" in green or "2.50% unallocated" in amber, and the continue
   button is disabled until the total is exactly 100%.
4. **Approvers** — add five people who can approve releasing locked money early, with a note that
   three of the five will be required and that each will verify they are a live person on their phone.
5. **Review and publish** — everything as recessed read-only plates, and a final button "Publish and
   lock the accounts", with the line "Once published, changing any of this needs three of your five
   approvers. There is no administrator override, including for us."

### B3. Operator — home (Coverage)

Android phone, per the wireframe in this brief's rationale. Top app bar with the business switcher.
Then:
- A coverage chart panel: a 7-day line of the coverage ratio with an **engraved 100% datum line**
  (one 1px `#656E69` rule with a 1px `#F4F5F2` highlight directly beneath it) running across the
  plot. Under the plot, the current figure at Display size with tabular figures — "104.2%" — the
  label "all classes", and beneath that its source line: "block 8 412 097, 6 seconds ago" with an
  explorer link.
- A "By class" section: one panel per account class, each with the axonometric lock-plate icon, held
  and owed amounts in tabular figures, the coverage percentage in green or red, the yield setting
  stated in words ("earns nothing" / "earns while idle"), and the holding address in mono with an
  explorer link. The locked classes' balance blocks are **recessed**; the operating account's is
  raised.
- A "Needs you" section listing any open unlock ceremony with quorum pips (filled and empty circles,
  drawn as engraved seats) and the countdown in amber.
- Bottom navigation, five destinations, no FAB.

Also produce the ≥840dp tablet layout: navigation rail on the left, chart and class list side by side.

### B4. Operator — accounts list

A list of every account, grouped by class with a quiet section header. Each row: the lock-plate icon
at 24dp, the account label, the balance right-aligned in tabular figures, and under the label the
address in mono, truncated only if the width forces it. Locked accounts carry a small recessed
"locked" chip stating in words what the lock permits — "can only pay verified sellers", "can only pay
the revenue authority". Tapping a row uses a container transform into the detail.

### B5. Operator — account detail

Header: the axonometric lock-plate illustration, the account label, the class, and the full address
in mono with a copy control and an explorer link.

Then, in order:
- **Held and owed** — two large tabular figures in a recessed plate, with the coverage ratio between
  them and a source line naming the block.
- **What this account may do** — the policy rendered in plain English as a short list: "May send USDC
  to 0x77de…901c, and to no other address." / "May not approve any spender." / "May not carry native
  value alongside a transfer." Below it, a collapsed "Show the policy as written" disclosure that
  reveals the machine-readable policy in mono inside a recessed block, plus the policy hash and a
  note that changing it requires three of five approvers.
- **History** — a reverse-chronological list of deposits in, payouts out and policy changes, each row
  with amount, counterparty, time, and a transaction link.
- At the end, a single full-width secondary button "Request an early unlock" — deliberately at the
  bottom, deliberately not a floating button.

### B6. Operator — split rule editor

The plain-language builder from setup, now in edit mode, with three additions:
1. A persistent validation bar pinned above the keyboard showing the running total: green
   "100.00% allocated" or amber "0.75% unallocated — this must be exactly 100% before you can
   publish".
2. A **"Replay against the last 30 days"** panel: a small comparison table showing, for real past
   deposits, what the current rule did versus what the proposed rule would have done, per class, with
   the difference in tabular figures.
3. A publish button reading "Publish to your approvers", and under it: "Three of your five approvers
   must sign before this takes effect. The current rule stays in force until they do."
Show the version history as a compact list: version, published date, who signed, and a link to the
on-chain record.

### B7. Operator — activity feed and deposit detail

**Feed**: reverse-chronological, grouped by day with a quiet date header. Each row is a deposit with
its total amount, the payer, the time, and a one-line summary of the split ("→ 88% sellers, 4% tax,
8% operating"). Failed or partial splits appear in amber with the text "Partially split — 240.00 USDC
unallocated", never hidden.

**Detail**: the deposit amount at Display size with its transaction link as its source line, then the
split as a set of recessed rows — one per destination account, each with the amount, the percentage,
the destination address in mono, and its own transaction link. A footer line states which version of
the split rule was in force at the moment the money arrived.

### B8. Operator — request an early unlock

A form, one field per section, each with plain-language help:
- Which account (a picker showing only locked accounts).
- How much (large tabular input, with the available balance shown beneath).
- Where it goes — and critically, a recessed explanatory block: "You can only send to an address this
  account's policy already permits. An unlock releases money the policy allows; it does not widen the
  policy." The destination picker lists only permitted addresses.
- Why (a free-text field, minimum length enforced, with "This reason is published permanently and its
  hash is written to the blockchain. Write it for someone reading it in two years.").
- A summary at the end, then a 56dp button "Send to your approvers", and under it: "Three of five
  approvers must verify they are a live person and approve. Then a 24-hour timer runs before the
  money can move. Nobody can shorten it."

### B9. Operator — unlock ceremony status

The state of one ceremony, on a phone.
- The amount, source account and destination at the top, recessed.
- **Quorum progress**: five engraved circular seats in a row, filled as approvals land. Beneath, a
  list of the five approvers with their state: "Approved 09:12, identity verified" in green with the
  proof reference in mono; "Not yet" in `#656E69`; "Declined" in red with their reason.
- **The timer**: once the third approval lands, a prominent countdown in amber with the line "This is
  enforced by a contract on chain, not by this app." Show both states — before quorum (timer not
  started, greyed) and running.
- At the bottom, once everything has elapsed: a full-width "Release the funds" button in blued steel.
- A permanent footer note: "Every step of this ceremony appears on your public page within a minute."

### B10. Operator — team and approvers

A list of team members with their role stated in words rather than a badge — "can approve releases",
"can view only", "can change settings". An approvers section showing the three-of-five threshold as a
sentence, not a number badge. Adding or removing an approver shows the warning that the change itself
requires three of five signatures. Include the dialog for that: a 28dp-radius dialog, the change
summarised, and the line "This needs three of five approvers, the same as moving money."

### B11. Operator — alerts inbox and alert detail

**Inbox**: findings from an automated monitor, severity-coded with a 4px leading bar in red, amber or
`#656E69`, never with an emoji or a coloured circle. Each row: a plain-language title ("Splits have
been running 5% under the rule for 11 days"), the time first seen, and the class affected. A filter
row of Material chips: All, Severe, Warning, Resolved.

**Detail**: the finding in full — what was observed, what was expected, and *the evidence*: a
recessed table of the specific transactions, block numbers and basis-point deltas involved, every row
linking to the explorer. A closing line: "This was computed from indexed blockchain history. The
monitor has no private data source — you can recompute it from the same public data." No "dismiss"
button; resolution is by fixing the cause, and the only actions are "Mark as investigated" and
"Open the affected account".

### B12. Operator — settings

Plain grouped list: business details, public page address with a preview link, block explorer, and a
**read-only** yield section that states per class, in words and without a toggle: "Client money —
earns nothing. This is fixed by the account class and cannot be switched on." / "Obligation reserve —
earns while idle." Then the policy hashes, the contract addresses, and a sign-out. No toggle switches
for anything that is enforced elsewhere; where a setting is not the user's to change, show the value
and say who or what decides it.

### B13. Public — landing page

Device-agnostic, desktop-first, dark-on-milled-steel. The hero is **not** a big number with a
gradient. It is a short, plainly set statement in IBM Plex Serif at 44/54:

> "Your customers' money should live in an account you are not able to spend from."

Beneath it, two sentences of Plex Sans explaining the split-on-arrival mechanism, and two
destinations: "See a live business's page" (primary, blued) and "Try to break it" (secondary, leading
to the simulator).

Then three sections, each a piece of evidence rather than a feature card:
1. **The rule that does the work** — the actual policy, set in mono inside a recessed plate, with a
   one-line annotation beside the recipient condition explaining that a token transfer's on-chain
   destination is the token contract, not the payee, so the policy reads inside the transaction data.
2. **The refusal** — a real, verbatim enclave error in mono on a recessed plate with the embossed
   stamp. Above it one sentence: "This is what happens when the business itself tries to pay the
   wrong address. It is not our error page; it is the enclave's own words."
3. **Coverage through time** — the engraved chart, with the line "A proof of reserves gives you three
   points across ninety days. An index gives you every block."

A closing line, set in serif: "We didn't prove the money is safe. We removed the ability to move it,
and put the proof on a page anyone can check." No pricing table, no logo wall, no testimonial.

### B14. Public — the solvency page

The most important screen in the product. Desktop and mobile layouts both.

**Header**: the business name, and in Plex Serif 40/48: "Acme Marketplace holds 340 000.00 USDC for
its sellers in accounts it cannot pay itself from." A live-data indicator stating the last indexed
block and how many seconds ago, in `#656E69`.

**Hero — the coverage chart.** Full width, 90 days, one line per account class, with the engraved
100% datum. Unlock events are marked on the time axis as small downward ticks with a label on hover
or tap. Under the chart, in `#656E69`: "Every point is an indexed snapshot from the blockchain. 4 117
of them." No 3D, no gradient fill, no animated counters.

**Owed versus held, by class.** A table: class, held, owed, coverage percentage, yield setting, and
the block the figures come from. Numbers right-aligned and tabular. Coverage in green or red. Beneath
the table, in body text: "Client money never earns. That is the account class, not a setting the
business can flip."

**Accounts.** Every account address in full, in mono, each linked to the block explorer, with its
label, its class, its balance and its policy hash. A one-line instruction above: "Don't trust this
page. Open any address on the block explorer and check the balance yourself."

**Every unlock ever performed.** A table of ceremonies: date, amount, destination, the typed reason
in full, the approvers who signed, whether each completed an identity check, and the transaction. If
none have happened, the empty state reads "No locked money has ever been released early from this
business." If approvals exist but no identity check has been completed yet, say that plainly rather
than showing a tick.

**Find my balance.** A small, quiet section: an email field and the button "Find my balance", showing
the beneficiary their own balance and the address holding it, with an explorer link.

**Monitor findings**, if any are severe: shown near the top in a red-barred recessed block, with the
same evidence-and-explorer treatment as the operator app.

Footer: a short honest-limits statement — what is on testnet, what has not yet been demonstrated —
in the same type size as everything else, not in fine print.

### B15. Public — beneficiary claim flow

Mobile-first, five screens. The person here is a seller owed money who has never used a crypto wallet
and must never learn that they are using one.

1. **Sign in** — email field only, button "Send me a sign-in link". Under it: "You don't need a
   wallet, a seed phrase, or any cryptocurrency. Your balance already exists."
2. **Identity check** — a World Selfie Check step. A single centred instruction, what will happen,
   how long it takes, and why: "Before we pay out money held for you, we check that a live person is
   behind this account. It takes about fifteen seconds." Show the waiting state honestly ("Open the
   check on your phone — waiting for you to finish") and the success state in green with the
   verification reference in mono.
3. **Your balance** — the amount at Display size, the address holding it in mono with an explorer
   link, and a recessed note: "This money sits in an account that is only able to pay you and the
   other sellers it holds money for. The business cannot spend it."
4. **Withdraw** — a destination address field, the amount, and two options presented plainly: "Send
   on Arc" and "Send to another chain" (the second explaining it will be bridged, in one sentence,
   with no chain jargon beyond the network name). If the destination is one they have already
   verified, no identity check is required and the screen says so: "You've used this address before,
   so there's no check this time." If it is a new address, show that a fresh identity check is
   required, and why: "Changing where your money goes needs a fresh check. It's what stops someone
   who steals your session from redirecting your balance."
5. **Confirmation** — the amount sent, the transaction hash in mono with an explorer link, and the
   updated remaining balance. No confetti, no celebration illustration.

### B16. Public — approver's mobile page

The screen a quorum member opens from a link on their phone. Per the wireframe in this brief: a
single object per screen, generous type, everything a person needs to decide and nothing else.
Amount at Display size; source and destination accounts in mono inside recessed blocks, both with
explorer links; the typed reason set at body 16 in full, never truncated; the reason's hash with a
green check and the line "matches the hash committed to the blockchain"; the quorum pips and the
list of who has approved, each with their identity-check state and proof reference; and one 56dp
blued button, "Verify it is you", followed after verification by "Approve this release". A permanent
note: "After the third approval a 24-hour timer starts on chain. Nobody can shorten it, including
us." Include the three states: not yet verified, verified and ready to approve, and already approved
by you.

### B17. Public — breach simulator

An adversarial page. A stranger is handed the operator's seat on a real locked account holding real
funds and invited to steal from it.

- **Header**: "You are the operator. Try to move the money." Two paragraphs explaining that this is a
  real account behind a real policy, that the server does not check where the visitor is sending
  funds, and that whatever comes back is the enclave's own words rather than an error page.
- **The account you are attacking**: a recessed plate listing the locked account address, the one
  address its policy permits, the policy identifier and the balance — every one of them in mono with
  an explorer link.
- **The console**: an address field ("Paste any address — yours, if you like") and a set of attack
  choices as a vertical list of selectable rows, each with a plain-English name and a one-line
  description: send to your address · send native value instead of a token transfer · send a
  permitted transfer with native value riding along · approve a spender · use an allowance · pad the
  address bytes · append junk bytes to the transaction data · wrap the transfer in a batch call. A
  single button: "Attempt the transfer".
- **The refusal specimen — the visual centrepiece of this page.** The result appears as a recessed
  dark plate with the embossed stamp, containing the raw, unedited error text in mono, at a
  comfortable 14/22 rather than shrunk into a code-block, selectable and copyable. Above it, in
  `#656E69`: "Returned by the enclave, unedited." Below it, one sentence of what just happened: "No
  signature was produced. There is nothing to broadcast."
- **A running tally**: attempts, refusals, signatures produced — the last permanently at zero, stated
  as a figure and not as a boast.
- A closing recessed block explaining why this sandbox cannot touch a real business.

### B18. Public — ask the monitor

A single query field — "Was this business ever short in August?" — with the answer rendered as prose
in body 16 followed by its evidence: the dates, block numbers and transactions it drew on, each
linked. Show the honest failure state too: if the reasoning service is unavailable, the page returns
the assembled evidence anyway, with the line "The reasoning step is unavailable right now. Here is
the evidence it would have read, so you can draw the conclusion yourself."

### B19. Auditor view (read-only)

The public page's layout with two additions: a date-time picker that reconstructs the exact state at
any past moment from indexed history ("State as it stood at 14 August 2026, 09:00 UTC, block
8 001 244"), and an export control producing a report generated from that indexed history. A
permanent recessed banner: "Read-only. This view cannot initiate anything."

### B20. Shared states — design these once, reuse everywhere

1. **The refusal specimen** (described in B17) — the single most important reusable component.
   Recessed dark plate, embossed stamp, raw error text in mono at 14/22, selectable, never wrapped in
   friendly language, never truncated, never replaced with a summary. It appears in the simulator, in
   the operator's activity feed when a transaction is refused, and on the landing page.
2. **The value-and-source pair** — the universal number component: the figure in tabular Plex Sans,
   with a 12sp `#656E69` line beneath naming its block, transaction or address, linked to the
   explorer. Design its three sizes: display, title and inline-table.
3. **"Verify this yourself"** — the recurring link pattern: mono address or hash, a copy control, and
   an explorer link that is a visible affordance rather than an underline on the text. Never an arrow
   glyph.
4. **Syncing with the chain** — the loading state. Never a generic spinner: show the last indexed
   block, how far behind the chain head it is, and whether what is on screen is stale. "Showing block
   8 412 040. The chain is 57 blocks ahead; updating."
5. **Empty states** — one sentence saying what will appear here and why it is empty now. "No locked
   money has ever been released early." / "No approver has completed an identity check yet. This
   table fills in the moment one does."
6. **Not-yet-proven state** — an amber recessed block used wherever the product is honest about a
   limit. Same type size as body copy, never fine print.
7. **Consequential-action dialog** — 28dp radius, the change summarised in plain words, the
   irreversibility stated, and a button naming the action rather than saying "Confirm".
8. **Permission-denied state** for a viewer-role user: what they can see, who to ask, and no
   greyed-out teasing of controls they will never have.

### B21. Deliverables

For every screen above, produce the light theme first, then the dark. For operator screens, produce
the 360dp compact phone layout and the ≥840dp expanded layout. For public screens, produce a 1280px
desktop and a 390px mobile layout. Keep spacing, type scale, radius semantics and the
value-and-source pattern identical across all of them — consistency is the point; this product's
credibility is built out of the reader's sense that nothing here is improvised.
