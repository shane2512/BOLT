# BOLT — UI design direction v2, and the per-screen Stitch prompts

**Status:** design brief only. Nothing here is implemented and nothing here touches code.

This replaces the visual direction in `docs/UI_DESIGN_PROMPT.md` entirely. The per-screen *content*
in that document — what data each screen holds, what each action does — was sound and has been kept,
corrected against the route handlers in `apps/web/src/app/api/**`, which are still in the tree. Its
visual direction ("Engraved Material": flat Material 3 + engraved metal) is dead and must not be
referenced.

**Direction: restrained matte claymorphism, mobile-first, wallet-app shell.**

Read Part 1 once. Then paste **§0** and exactly one screen block into Stitch per generation.

---

# Part 1 — The design plan

## 1.1 What is being designed

BOLT puts a business's customer money into on-chain accounts the business is *physically unable* to
spend from. The block is a Privy policy evaluated inside a secure enclave before a signing key is
reassembled — not application code. A public page lets anyone verify it without trusting us.

That makes this a **custody instrument**, not a consumer wallet and not a SaaS dashboard. The
nearest physical object is not an app: it is a sealed keypad on a piece of controlled equipment —
a soft-touch membrane panel where some buttons press and some are moulded shut.

That object is the whole reason claymorphism earns its place here, and it is also the constraint
that keeps it from going toy-like. Both of those need stating plainly, because they are the two
things a reader will doubt.

## 1.2 Reconciliation 1 — why claymorphism, and why it is not a toy here

Claymorphism's default register is playful: inflated pastel shapes, candy hues, thick cartoon
shadows, bouncy overshoot. That register would destroy this product's only asset, which is
credibility. It is also not a property of claymorphism — it is a property of *how claymorphism is
usually coloured and animated*. The soft extrusion itself is neutral.

So the direction is **matte instrument clay**, pinned by five hard rules:

1. **Chroma ceiling.** The clay body is a near-neutral cool grey. No pastel fills anywhere — no
   mint, no lavender, no bubblegum, no peach. Colour appears only where it carries meaning.
2. **Matte, never glossy.** No specular blobs, no shine sweeps, no glassy top-light, no gradient
   washes. The only gradient in the system is the two-stop inner highlight that makes an edge look
   moulded.
3. **Shadows are tinted with the ink colour, never pure black and never coloured per-element.**
   One fixed light source, top-left, on every surface on every screen, forever.
4. **No bounce.** Press-in is 120ms with a standard ease-out. Springs, overshoot and squash are
   banned — this is soft-touch rubber over a metal chassis, not jelly.
5. **Restraint in count.** One fully-extruded "hero" object per screen. Everything else is barely
   lifted or pressed in.

The result reads the way the rubberised keypad on a good instrument reads: soft to touch,
serious to look at.

And clay buys something the flat direction could not: **extrusion is a semantic channel.** See 1.5.

## 1.3 Reconciliation 2 — clay vs. "the same shadow on everything"

The generic-AI-design tell list bans *identical rounded cards with the same soft shadow under
each*. A naive claymorphism pass reintroduces that tell immediately, in its own dialect: every block
becomes a puffy pill with the same `0 8px 24px` beneath it, and the page turns to gravel.

So extrusion depth is treated exactly the way the frontend-design skill asks every other property to
be treated: **it varies by hierarchy, and the variation is legible.** The five-tier ladder in 1.5 is
not a decorative range; each tier means something specific, and a screen that uses only one tier is
wrong. If two adjacent blocks carry the same shadow, they are the same *kind* of thing. If they are
not the same kind of thing, their shadows must differ.

## 1.4 Palette — "Casing"

Six base values. Cool mineral grey with a faint violet cast: the colour of anodised instrument
housings and moulded ABS. Deliberately not warm cream, not near-black, not the grey-green of the
rejected v1 palette.

| Name | Light | Dark | Role |
|---|---|---|---|
| **Casing** | `#D8DBE1` | `#191B21` | Page ground. Never white, never cream. |
| **Keycap** | `#E6E8ED` | `#242731` | Raised clay. Anything the user can act on. |
| **Well** | `#C7CBD4` | `#101218` | Recessed clay, *darker than the ground*. Anything the machine controls. |
| **Graphite** | `#22242E` | `#E7E9EF` | Primary text. A true indigo-graphite, not a tinted near-black. |
| **Mist** | `#6C7184` | `#949AAD` | Secondary text, source lines, disabled. |
| **Indigo** | `#3A4172` | `#8089C6` | The only interactive hue: primary buttons, focus ring, selected tab, links. |

Semantic colours. Used **only** for their meaning, never as decoration, never as a fill behind large
areas:

| Name | Light | Dark | Means |
|---|---|---|---|
| **Covered** | `#3D6E58` | `#7FA98F` | Coverage ≥ 100%, permitted destination, verified person, signed. |
| **Refused** | `#8C3F4A` | `#C97A7E` | Policy refusal, shortfall, severe finding. Cool oxblood. |
| **Pending** | `#8A6B32` | `#C3A468` | Timer running, quorum incomplete, index behind head, not yet proven. |

`Refused #8C3F4A` was chosen by explicitly rejecting terracotta `#D97757` — it is pulled cool and
dark so it can never read as a warm decorative accent. Dark mode is a *dark clay casing*, not a neon
console: the same muted semantics lifted for contrast, no glow, no saturated cyan or lime, no
coloured shadows.

## 1.5 Materiality — the extrusion ladder

This is the core of the system. Light source is fixed top-left. Shadow colour is always the
Graphite hue at low alpha.

| Tier | Name | Use | Light-mode recipe |
|---|---|---|---|
| **0** | Ground | Page background | No shadow. Flat Casing. |
| **1** | Seated | List rows, chips, quiet meta blocks | `box-shadow: 0 1px 2px rgba(34,36,46,.10), inset 0 1px 0 rgba(255,255,255,.55)` |
| **2** | Pad | Standard cards, the tab bar, sheets | `0 6px 14px -4px rgba(34,36,46,.18), 0 2px 4px rgba(34,36,46,.10), inset 0 2px 2px rgba(255,255,255,.65), inset 0 -3px 4px rgba(120,126,145,.22)` |
| **3** | Hero | **One per screen.** The single most important object. | `0 16px 28px -10px rgba(34,36,46,.28), 0 4px 8px rgba(34,36,46,.12), inset 0 3px 3px rgba(255,255,255,.75), inset 0 -6px 8px rgba(120,126,145,.28)` |
| **−1** | Well | Recessed. Machine-owned content and all inputs. | Background `Well`. **No outer shadow.** `inset 0 3px 6px rgba(34,36,46,.20), inset 0 -1px 0 rgba(255,255,255,.50)` |

Dark mode keeps the geometry and swaps the two ingredients: highlights drop to
`rgba(255,255,255,.05–.08)`, shadows rise to `rgba(0,0,0,.45–.60)`.

**Pressed state.** Any Tier 1/2/3 element on `:active` adopts the Tier −1 recipe and shifts down
1px over 120ms. That is the entire interaction language: things you can press, press in.

**The semantic rule that makes this more than styling:**

> **Recessed means the machine controls it and you cannot. Raised means you can act on it.**

A locked balance, a policy condition, an on-chain hash, a raw enclave refusal, a permitted-payee
address: all Wells. A button, an editable split rule, an unsent form: raised clay. A reader learns
this in one screen, and thereafter the interface tells them — without a word of copy — which parts
of this product are not theirs to move. That is BOLT's central claim expressed as material.

**Radius scale** (concentric: inner radius = outer − padding):

| Radius | Applies to |
|---|---|
| `999px` | Primary buttons, tab pills, status chips |
| `28px` | Tier 3 hero cards, bottom sheets, the tab bar |
| `20px` | Tier 2 standard cards |
| `14px` | Inputs, Wells, list rows |
| `10px` | Small chips, icon buttons |

## 1.6 Type

Two families, distinct roles, no third.

- **Manrope** — everything in the interface. Geometric-humanist, low contrast, slightly softened
  terminals; it sits on matte clay without looking like a system default and without looking cute.
  Deliberately not Inter and not IBM Plex.
- **Spline Sans Mono** — **machine-produced values only**: wallet addresses, transaction and policy
  hashes, block numbers, policy rule text, raw enclave error output. Never a label. Never body copy.
  Never a number that a human typed. If it is mono, a machine emitted it and the reader can go check
  it.

Scale (SF-Pro-style hierarchy, in pt on a 390-wide phone). All numerals **tabular, always**:

| Role | Size/Leading | Weight |
|---|---|---|
| Amount | 40 / 44, tracking −0.02em | 600 |
| Title 1 | 28 / 34 | 600 |
| Title 2 | 20 / 26 | 600 |
| Headline | 17 / 22 | 600 |
| Body | 16 / 24 | 400 |
| Callout | 15 / 20 | 400 |
| Footnote | 13 / 18 | 500 |
| Caption | 12 / 16, **sentence case** | 500 |
| Mono data | 13 / 18 | 400 |

Spacing scale: **4 / 8 / 16 / 24 / 48 / 96**. Screen margin 16. Card padding 20. Section gap 24.
Measure ≤ 64 characters. Left-aligned throughout; numbers right-align in tables. Centre a layout
only when a screen holds exactly one object.

## 1.7 Navigation — mobile-first, four shells

Viewport for every prompt: **390 × 844, iOS-style**, with the status bar and a 34px home indicator
safe area. There is no browser chrome, no desktop layout, no scrolling marketing page.

1. **Operator shell — bottom tab bar.** A floating Tier 2 clay slab, 28px radius, inset 8px from the
   left and right edges and 12px above the home indicator, 64px tall. Five tabs: **Coverage ·
   Accounts · Activity · Approvals · Alerts**, 24px outlined icons with 2px rounded-cap strokes and
   an 11pt sentence-case label. The selected tab is a **Well pressed into the slab** with its icon
   and label in Indigo — selection reads as clay physics, not as a colour swap. No FAB anywhere:
   every consequential action in this product is slow and deliberate, so primary actions live at the
   end of the screen they belong to, as 56px full-width buttons sitting above the tab bar.
2. **Beneficiary shell — linear flow.** No tab bar. A 44px back chevron top-left, an optional
   discreet step dot row, one idea per screen, and one Tier 3 primary button at thumb height.
3. **Public shell — scroll-spy pill bar.** No tab bar. A compact 56px header (business name, plus a
   Seated "live" pill showing the last indexed block) and a bottom sticky segmented pill control of
   3–4 anchors that jumps down the page and tracks position as the reader scrolls.
4. **Single-object shell.** Approver authorisation, confirmations, refusals. No navigation at all:
   one object, one decision, one button.

Touch targets ≥ 44px (48 preferred). Everything the thumb needs sits in the bottom third.

## 1.8 Motion

One orchestrated moment per screen, at most. Press-in is the workhorse and it is always
user-triggered. No scroll-reveal, no staggered entrances, no card hover effects, no animated
counters, no confetti. `prefers-reduced-motion` collapses press-in to a 1-step opacity change and
removes every transition.

## 1.9 Copy discipline

**Remove unnecessary text.** Every prompt below carries a hard copy budget. The rules:

- No restating a label the visual already gives. No explanatory paragraph where a Well and a number
  already say it.
- Sentence case everywhere. No ALL-CAPS eyebrows.
- A button names what happens: "Request unlock", "Approve release", "Withdraw to my address".
  Never "Submit", "Continue", "Learn more".
- Errors say what happened and what to do. They never apologise, never go vague.
- Empty states say what will fill them and why they are empty now.
- **Never** the words "compliant", "compliance", "certified", "guaranteed". BOLT provides technical
  enforcement and public verifiability, and the interface must never imply more.
- State honestly what is not proven. Testnet is testnet, an index behind head is behind head.

## 1.10 Why this isn't generic — self-check

| Tell | Ruling |
|---|---|
| Uppercase tracked-out eyebrow labels | Banned. Labels are 12pt sentence case in Mist. |
| Monospace for every small label | Banned. Mono is reserved for machine-emitted strings; it is a truth claim, not a texture. |
| Identical rounded cards, same shadow on everything | Structurally prevented by the five-tier ladder and the one-Tier-3-per-screen rule. Adjacent blocks with equal shadow must be the same kind of thing. |
| Middle-dot joined meta strings | Banned. Meta separates by line and whitespace. |
| "Word — fragment" em-dash labels | Banned. |
| `→` on buttons and links | Banned. |
| Warm cream + terracotta | Ground is cool mineral grey `#D8DBE1`; the red was chosen by explicitly rejecting `#D97757`. |
| Near-black + neon accent | Dark mode is dark clay with the same muted semantics. No glow, no coloured shadows. |
| `01 / 02 / 03` numbered markers | Permitted **only** where the content is genuinely a sequence: the five setup steps and the quorum seats. Nowhere else. |
| Big number + gradient + supporting stats hero | Replaced. The hero on the public page is the coverage line and the verbatim refusal, both of which are evidence rather than decoration. |
| Candy claymorphism | Bound by the five rules in 1.2. |

**The one place boldness is spent:** the refusal specimen — a deep Well containing Privy's raw,
unedited enclave error. It is the most persuasive object in the product and it gets the most visual
weight on every screen it appears on. Everything around it stays quiet.

## 1.11 Two corrections to the v1 content (carried into the prompts below)

- **B8's destination field is free text, not a picker of permitted addresses.**
  `apps/web/src/app/api/operator/unlock/route.ts` deliberately does not check the destination —
  invariant 1 says the enclave refuses, not our code. A picker restricted to permitted addresses
  would be exactly the app-layer check the product claims does not exist. v1 specified a picker;
  that was wrong.
- **B2 cannot actually provision a business from the web form.**
  `api/operator/policy-preview/route.ts` previews the real policy and hash but creates nothing: the
  key quorum's P-256 private halves must be generated where they can be held, not typed into a
  browser. The final setup step says so rather than showing a button that would have to pretend.

---

# Part 2 — §0, the shared system block

> Paste this block first, then append exactly one screen block. Generate one screen per prompt.

```
Design a mobile app screen for a 390 x 844 iOS-style phone viewport. This is a native-feeling
wallet/instrument app, not a website: no browser chrome, no desktop layout, no marketing hero, no
landing-page sections.

PRODUCT. BOLT holds a business's customer money in on-chain accounts the business is physically
unable to spend from. The block is a policy evaluated inside a secure hardware enclave before any
signing key is assembled, so a disallowed payment never produces a signature. A public page lets
anyone verify the money is there without trusting the business or BOLT. Treat this as a custody
instrument, not a consumer money app.

STYLE: CLAYMORPHISM — soft, puffy, extruded matte surfaces with paired inner and outer shadows.
Restrained and professional, not playful. Think the soft-touch rubber keypad on a premium piece of
instrumentation, not a children's app. Hard rules:
- Near-neutral cool grey clay body. No pastel or candy fills anywhere. Colour only where it means
  something.
- Matte only. No gloss, no shine sweeps, no specular highlights, no glassmorphism, no decorative
  gradient washes. The only gradient is the two-stop inner highlight that moulds an edge.
- Shadows are tinted with the dark ink colour, never pure black, never coloured per element. One
  fixed light source, top-left, on every surface.
- No bounce, no springs, no squash. Press-in is 120ms ease-out.

PALETTE (light). Casing #D8DBE1 page ground. Keycap #E6E8ED raised clay. Well #C7CBD4 recessed clay,
darker than the ground. Graphite #22242E primary text. Mist #6C7184 secondary text. Indigo #3A4172
is the only interactive hue: primary buttons, focus rings, selected tab, links.
SEMANTIC, used only for meaning and never as decoration: Covered #3D6E58 (coverage at or above 100%,
permitted destination, verified person, signed), Refused #8C3F4A (policy refusal, shortfall, severe
alert — a cool oxblood, not terracotta and not orange), Pending #8A6B32 (timer running, quorum
incomplete, index behind the chain head, anything not yet proven).
PALETTE (dark). Casing #191B21, Keycap #242731, Well #101218, Graphite #E7E9EF, Mist #949AAD,
Indigo #8089C6, Covered #7FA98F, Refused #C97A7E, Pending #C3A468. Dark mode is dark clay, not a
neon console: no glow, no saturated cyan or lime, no coloured shadows.

EXTRUSION LADDER. Depth varies by hierarchy — never the same shadow on everything.
  Tier 0 Ground: page background, flat, no shadow.
  Tier 1 Seated (list rows, chips, quiet meta): 0 1px 2px rgba(34,36,46,.10),
    inset 0 1px 0 rgba(255,255,255,.55)
  Tier 2 Pad (standard cards, the tab bar, sheets): 0 6px 14px -4px rgba(34,36,46,.18),
    0 2px 4px rgba(34,36,46,.10), inset 0 2px 2px rgba(255,255,255,.65),
    inset 0 -3px 4px rgba(120,126,145,.22)
  Tier 3 Hero — EXACTLY ONE PER SCREEN: 0 16px 28px -10px rgba(34,36,46,.28),
    0 4px 8px rgba(34,36,46,.12), inset 0 3px 3px rgba(255,255,255,.75),
    inset 0 -6px 8px rgba(120,126,145,.28)
  Tier -1 Well (recessed): background Well, NO outer shadow,
    inset 0 3px 6px rgba(34,36,46,.20), inset 0 -1px 0 rgba(255,255,255,.50)
Pressed state: any raised element adopts the Well recipe and shifts down 1px.

THE SEMANTIC RULE. Recessed means the machine controls it and the user cannot. Raised means the user
can act on it. Locked balances, policy conditions, on-chain hashes, addresses and raw enclave errors
are always Wells. Buttons, editable fields and unsent forms are always raised clay.

RADIUS: 999px primary buttons / tab pills / status chips. 28px hero cards, sheets, the tab bar.
20px standard cards. 14px inputs, Wells, list rows. 10px small chips and icon buttons.

TYPE. Manrope for all interface text. Spline Sans Mono for machine-produced values ONLY — wallet
addresses, transaction and policy hashes, block numbers, policy rule text, raw error output — never
for a label and never for body copy. All numerals tabular.
Amount 40/44 semibold tracking -0.02em. Title1 28/34 semibold. Title2 20/26 semibold.
Headline 17/22 semibold. Body 16/24. Callout 15/20. Footnote 13/18 medium.
Caption 12/16 medium sentence case. Mono data 13/18.

SPACING: 4 / 8 / 16 / 24 / 48 / 96. Screen margin 16. Card padding 20. Section gap 24.
Touch targets at least 44px, 48 preferred. Primary buttons 56px tall, full width, above the tab bar.
Left-aligned; numbers right-align in tables. Centre only when a screen holds one object.

EVERY NUMBER WEARS ITS SOURCE. No figure appears alone. Under each amount, ratio or status, set a
12pt Mist caption naming where it came from — a block number, transaction hash or address — with the
block-explorer link on that line. Same component on every screen.

COPY. Minimal and essential only. Cut any sentence the visual already communicates. No filler, no
restated labels, no explanatory paragraphs. Sentence case throughout. Buttons name what happens
("Request unlock", not "Submit"). Errors say what happened and what to do, without apologising.
Empty states say what will fill them.

DO NOT: uppercase tracked-out eyebrow labels; monospace for ordinary labels; identical cards with
identical shadows; meta strings joined by middle dots; "Word — fragment" em-dash labels; arrow
glyphs on buttons or links; frosted glass; gradient decoration; pastel clay; confetti or celebration
illustrations; the words "compliant", "compliance", "certified" or "guaranteed"; any number without
its source line.

Produce the light theme and the dark theme of every screen.
```

---

# Part 3 — Screen prompts

Each block is appended to §0. Build **B20 first** — every other screen references its components.

---

## B20 — Shared states and components reference

> Build this first. Every other screen reuses these.

```
Produce a component reference sheet on the 390-wide phone canvas, laid out as labelled specimens
down a single scrolling column. No marketing framing — this is a spec sheet.

1. BUTTONS, four kinds, each shown at rest, pressed and disabled.
   Primary: 56px, full width, 999px radius, Indigo clay, white label, Tier 2 extrusion. Pressed
   adopts the Well recipe and shifts down 1px.
   Secondary: 56px, Keycap clay, Graphite label, Tier 1.
   Destructive-consequence: 56px, Keycap clay with a Refused label and a 1px Refused hairline; never
   a filled red button — the weight comes from the confirmation sheet, not the colour.
   Quiet text button: 44px, Indigo label, no extrusion.
2. INPUTS. Every input is a Well: recessed, 14px radius, 52px tall, Mist placeholder, label as a
   12pt caption above it. Show: text field, amount field (40pt tabular figures, USDC suffix),
   address field (Spline Sans Mono, wrapping to two lines rather than truncating), multi-line reason
   field with a character counter. Focus state adds a 2px Indigo inner ring inside the Well.
3. THE VALUE-AND-SOURCE PAIR — the universal number component, in three sizes: amount (40pt), title
   (20pt) and inline-table (15pt). Each is the figure in tabular Manrope with a 12pt Mist caption
   beneath naming its block, transaction or address, the address or hash in mono, and an explorer
   link rendered as a small 24px outlined icon button rather than an underline or an arrow glyph.
4. THE REFUSAL SPECIMEN — the most important component in the product and the one place the design
   is allowed to be bold. A deep Well, 20px radius, full bleed to the 16px margin, containing the
   raw unedited enclave error in Spline Sans Mono at 13/20, selectable, wrapping, never truncated,
   never summarised, never rewritten as a friendly message. A small moulded Refused-coloured
   circular stamp pressed into the top-right corner of the Well, decorative and never overlapping
   the text. A 12pt Mist caption above: "Returned by the enclave, unedited."
5. THE BOTTOM TAB BAR. Floating Tier 2 clay slab, 64px tall, 28px radius, inset 8px from the side
   edges and 12px above the home indicator. Five tabs: Coverage, Accounts, Activity, Approvals,
   Alerts. 24px outlined icons, 2px rounded-cap strokes, 11pt sentence-case labels. The selected tab
   is a Well pressed into the slab with its icon and label in Indigo. Show a small Refused dot on
   Alerts for unread severe findings.
6. CHIPS. Seated pills, 10px radius, 12pt: a locked chip (a small padlock glyph plus plain words
   like "can only pay verified sellers"), a class chip, and status chips in Covered, Refused and
   Pending.
7. SYNCING STATE. Never a spinner. A Seated strip naming the last indexed block, how far behind the
   chain head it is, and whether what is on screen is stale: "Showing block 8 412 040. The chain is
   57 blocks ahead."
8. EMPTY STATE. One sentence saying what will appear and why it is empty now. No illustration.
9. ERROR STATE. A Well with a Refused hairline, what happened, what to do. No apology.
10. NOT-YET-PROVEN STATE. A Pending-hairlined Well at full body size, never fine print, for anything
    honestly unfinished — testnet, an index behind head, a check nobody has completed yet.
11. PERMISSION-DENIED STATE for a viewer-role user: what they can see and who to ask. Never greyed
    out controls they will never have.
12. CONSEQUENTIAL-ACTION SHEET. A 28px-radius Tier 2 bottom sheet, the change summarised in plain
    words, the irreversibility stated in one line, and a button naming the action rather than
    "Confirm".

Copy budget: labels and one line of specimen text per component. Nothing else.
```

---

## B1 — Operator sign in

```
One screen, one object, centred. No tab bar.

The BOLT wordmark, small, Graphite. Below it in Title 2: "Sign in to Acme Marketplace".
A Well email field. A 56px Indigo primary button "Send sign-in link". A quiet text button "Use a
passkey". There is no password field anywhere in this product.

The single Tier 3 object is the sign-in card holding those three elements — a moulded clay panel
centred at 40% of the screen height, 28px radius, with the field pressed into it as a Well. Nothing
else on the screen is extruded.

At the bottom, above the home indicator, one 13pt Mist line: "BOLT never holds your keys and cannot
move money out of your locked accounts."

States to show: resting, link sent (the button becomes a Seated strip reading "Check your email —
the link lasts 10 minutes"), and the workflow-store-unreachable case as a Pending Well: "Signed in,
but the workflow store is unreachable. Read-only screens work; anything that writes does not."

NAVIGATION: a successful sign-in goes to B3 Operator Home if the business is already published, or
to B2 step 1 if it is not.

Copy budget: the heading, two button labels, one footer line. Nothing else.
```

---

## B2 — Operator business setup

```
A five-step flow, one step per screen. Produce all five. A slim 4px Well progress track sits under a
plain 56px header, filling with Indigo clay as steps complete. Because this is genuinely a sequence,
numbered step markers are allowed here and nowhere else in the product. No tab bar; a 44px back
chevron top-left and a 56px primary button at the bottom of each step.

Step 1 — Business. Two Well fields: legal name, and the public page address with a "bolt.app/"
prefix rendered inline in Mist and the slug itself in mono. Below, a live preview of the resulting
URL. Button: "Continue to accounts".

Step 2 — Account tree. Three selectable clay plates, one per class:
  Client money — money that belongs to your customers.
  Obligation reserve — money owed to institutions, like tax and payroll.
  Operating — your own.
Client money and obligation reserve render as Wells with a moulded padlock pressed into the clay:
they are permanently locked and the material says so. Operating renders as a raised Tier 1 Keycap
plate. Each carries one plain line of what its lock will permit. Button: "Continue to the split
rule".

Step 3 — Split rule. A plain-language sentence builder: "Every payment we receive goes __% to
sellers, __% to sales tax, __% to operating." Percentages are large tabular Well inputs. A Tier 3
running-total bar is the hero of this screen, pinned above the keyboard, reading "100.00% allocated"
in Covered or "2.50% unallocated" in Pending. The continue button stays disabled until the total is
exactly 100%. (Internally these are basis points and must sum to 10000.)

Step 4 — Approvers. Add five people who can approve releasing locked money early. A Seated row per
person: name, email, and a 12pt line noting each will verify they are a live person on their own
phone. One line beneath the list: "Three of these five will be required."

Step 5 — Review and publish. Every decision from steps 1–4 as read-only Wells: the business, the
account classes with their generated policy hash in mono, the split rule, the five approvers. Then
the honest constraint, as a Pending Well at full body size: "The quorum's signing keys are generated
where their private halves can be held, not in a browser. Finish provisioning from the command
line." Primary button "Publish and lock the accounts", and beneath it one line: "Changing any of
this afterwards needs three of your five approvers. There is no administrator override, including
for us."

NAVIGATION: each step advances to the next; the final step lands on B3.

Copy budget: one explanatory line per step, plus the class descriptions and the two closing lines.
```

---

## B3 — Operator home (Coverage)

```
The operator's daily screen. Bottom tab bar present, Coverage selected.

Header, 56px: the business name with a small chevron opening a business switcher, and a settings
icon button on the right. To the right of the business name, a Seated "live" pill showing the last
indexed block.

HERO (the single Tier 3 object): the coverage panel. A 28px-radius moulded clay card containing a
7-day coverage line chart with a 100% datum line drawn as a thin Well groove pressed into the card
face — the line the curve must stay above is literally a channel in the clay. Under the plot, the
current ratio at 40pt tabular ("104.2%"), a 15pt line "all classes", and the source caption
"block 8 412 097, 6 seconds ago" with an explorer link icon. Area fill under the curve is a flat 6%
tint, never a gradient.

BY CLASS: one Tier 1 Seated row per account class. Each has a small moulded padlock for the locked
classes, the held and owed amounts in tabular figures, the coverage percentage in Covered or
Refused, the yield setting stated in words ("earns nothing" / "earns while idle"), and the holding
address in mono with an explorer link. The balance figures of the locked classes sit inside Wells;
the operating account's balance sits on raised clay. That single difference is the whole product,
stated materially.

NEEDS YOU: any open unlock ceremony as a Tier 2 card — five moulded circular seats in a row, filled
as approvals land, with the countdown in Pending: "Unlock #418, 2 of 3 approved, 23h 41m before it
can execute."

If severe monitor findings exist, one Refused-hairlined Seated strip above Needs You, tapping
through to B11.

NAVIGATION: a class row opens B5 Account Detail. The Needs You card opens B9. The tab bar reaches
B4, B7, B9 and B11. The settings icon opens B12.

Copy budget: section headings only. No introductory prose anywhere on this screen.
```

---

## B4 — Operator accounts

```
Tab bar present, Accounts selected.

A list of every account, grouped by class under quiet 13pt Mist section headers: Client money,
Obligation reserve, Operating. Each row is a Tier 1 Seated clay row, 72px tall:
  - a 24px moulded padlock icon for locked accounts, absent for operating;
  - the account label;
  - the balance right-aligned in tabular figures;
  - the address in mono on a second line, wrapping rather than truncating when the width allows;
  - for locked accounts only, a Well "locked" chip stating in plain words what the lock permits —
    "can only pay verified sellers", "can only pay the revenue authority".

The operating account's section renders visibly differently: raised Keycap rows, no padlock, no
chip. Nothing else distinguishes it and nothing needs to.

A Seated syncing strip at the top naming the indexed block. Empty state: "No accounts yet. They
appear once the business is published and its policies are attached."

NAVIGATION: tapping a row opens B5 Account Detail with a shared-element transition from the row into
the detail header.

Copy budget: three section headings and the lock chips. Nothing else.
```

---

## B5 — Operator account detail

```
Tab bar present. A 44px back chevron in a plain header.

HEADER: the account label at Title 1, the class as a Seated chip, and the full address in Spline
Sans Mono inside a Well with a copy icon button and an explorer icon button. Wrap the address to two
lines rather than truncating it.

HELD AND OWED (the single Tier 3 object): one moulded clay card holding two 40pt tabular figures
side by side with the coverage ratio between them in Covered or Refused, and the source caption
naming the block.

WHAT THIS ACCOUNT MAY DO: the policy in plain English as a short list inside a Well:
  "May send USDC to 0x77de…901c, and to no other address."
  "May not approve a spender."
  "May not carry native value alongside a transfer."
Beneath, a collapsed disclosure "Show the policy as written" that expands into a deeper Well
containing the machine-readable policy in mono, the policy hash, and one 13pt line: "Changing this
needs three of five approvers."

HISTORY: reverse-chronological Seated rows — deposits in, payouts out, policy rotations. Each row
carries amount, counterparty, time and a transaction link.

At the very end of the scroll, above the tab bar, a single 56px secondary button "Request an early
unlock". Deliberately at the bottom and deliberately not a floating button: this action is slow and
the layout should say so.

If the account is OPERATING, replace that button with a Well reading: "This account carries no
policy. It holds the business's own money and is already spendable."

NAVIGATION: the button opens B8, pre-filled with this account. History rows open B7's deposit
detail.

Copy budget: the three policy lines, the disclosure label, the quorum line. Nothing else.
```

---

## B6 — Operator split rule editor

```
Tab bar hidden while editing; a plain header with a back chevron and the mandate version.

THE BUILDER: the plain-language sentence from setup, now editable. One Seated row per destination:
the account label, and a large tabular percentage in a Well input. A small icon button adds a row.

THE HERO (Tier 3): a validation bar pinned above the keyboard, moulded clay, showing the running
total — "100.00% allocated" in Covered, or "0.75% unallocated — this must be exactly 100% before you
can publish" in Pending. It is the only fully extruded object on the screen because it is the only
thing that decides whether anything can happen.

REPLAY: a section headed "Replay against the last 30 days" containing a compact three-column Well
table — destination, what the current rule did, what the proposed rule would have done — with the
difference per class in tabular figures, computed from real past deposits. Numbers right-aligned.

PUBLISH: a 56px primary button "Publish to your approvers", and beneath it exactly one line: "Three
of your five approvers must sign before this takes effect. The current rule stays in force until
they do."

VERSION HISTORY: a compact Seated list — version number, published date, who signed, and a link to
the on-chain record.

Show the invalid state too: a Refused-hairlined Well carrying the validator's own message verbatim
rather than a rewritten one.

NAVIGATION: publishing opens the consequential-action sheet from B20, then returns to B5.

Copy budget: the section headings, the validation strings, the one publish line.
```

---

## B7 — Operator activity and deposit detail

```
Produce two screens.

FEED. Tab bar present, Activity selected. Reverse-chronological, grouped by day under quiet 13pt
Mist date headers. Each entry is a Tier 1 Seated row: the deposit total in tabular figures, the
payer, the time, and a one-line split summary rendered as a thin three-segment clay bar pressed into
the row with percentage labels — "88% sellers, 4% tax, 8% operating" — rather than a sentence.
Partial splits render in Pending with the words "Partially split, 240.00 USDC unallocated", never
hidden. A refused transaction renders in Refused and opens the refusal specimen.
Filter chips across the top: All, Deposits, Payouts, Policy changes, Refusals.

DETAIL. Back chevron. The deposit amount at 40pt as the single Tier 3 card, with its transaction
hash as the source caption. Below it, the split as a set of Wells, one per destination account: the
amount, the percentage, the destination address in mono and its own transaction link. A closing
13pt line states which version of the split rule was in force at the moment the money arrived.

NAVIGATION: a feed row opens the detail; a detail destination row opens B5 for that account.

Copy budget: date headers, filter chip labels, the rule-version line.
```

---

## B8 — Operator request an early unlock

```
A form, one field per section, back chevron header, no tab bar.

1. Which account — a Well picker listing only locked accounts, each with its balance.
2. How much — a 40pt tabular Well amount input with the available balance in a caption beneath.
3. Where it goes — a free-text mono address Well field. Critically, this field is NOT restricted to
   a list of permitted addresses, and the screen says why in one line inside a Well: "We do not check
   this address. If the policy does not already permit it, the enclave refuses and you will see its
   own words." Do not draw a validation tick, a green border, or any affordance implying the app has
   approved the destination.
4. Why — a multi-line Well field with a character counter and a minimum length, and one caption:
   "This reason is published permanently and its hash goes on chain. Write it for someone reading it
   in two years."
5. Summary — a Tier 3 moulded card restating amount, source account and destination, which is the
   only fully extruded object on the screen.

Then a 56px primary button "Send to your approvers", and beneath it one line: "Three of five
approvers must verify they are a live person and approve. Then a 24-hour timer runs on chain before
the money can move. Nobody can shorten it."

Show the rejected state for an operating account as a Refused Well carrying the server's own
sentence: "An operating account carries no policy, so there is nothing to unlock."

NAVIGATION: submitting opens B9 for the new ceremony and surfaces the approver link to share.

Copy budget: the two Well explanations, the counter caption, the closing line. Nothing else.
```

---

## B9 — Operator unlock ceremony status

```
One ceremony. Tab bar present, Approvals selected.

TOP: amount, source account and destination, all inside Wells with mono addresses and explorer
links. The typed reason in full at body 16, never truncated, with its hash beneath in mono and a
Covered tick reading "matches the hash on chain".

QUORUM (the Tier 3 hero): a moulded clay panel containing five circular seats pressed into it in a
row — this is genuinely a sequence, so numbering the seats is allowed. Filled seats are Indigo clay
domes sitting proud of the panel; unfilled seats are empty Wells. Beneath, one Seated row per
approver: "Approved 09:12, identity verified" in Covered with the proof reference in mono; "Not yet"
in Mist; "Declined" in Refused with their reason.

THE TIMER: show both states. Before quorum, a flat Well reading "The timer starts when the third
approval lands." Once armed, a large Pending countdown with one line: "Enforced by a contract on
chain, not by this app."

At the end, once elapsed, a 56px primary button "Release the funds". Before then, that space holds a
Well stating what is still outstanding.

A permanent 13pt Mist footer: "Every step of this appears on the public page within a minute."

NAVIGATION: approver rows are read-only here. The destination opens B5. A completed release lands on
B7's detail for the payout transaction.

Copy budget: the timer line, the footer line, the approver states. Nothing else.
```

---

## B10 — Operator team and approvers

```
Tab bar present.

TEAM: Seated rows, one per member, each stating their role in plain words rather than a badge —
"can approve releases", "can view only", "can change settings".

APPROVERS: a section whose threshold is stated as a sentence, not a number badge: "Three of these
five must sign before locked money moves." Below it, five Seated rows with each approver's name,
their authorisation key reference in mono, and whether they have ever completed an identity check.

The single Tier 3 object is the add/remove approver control at the bottom — a moulded clay card with
a 56px secondary button "Propose an approver change" and one line beneath: "This change needs three
of five signatures, the same as moving money."

Include the consequential-action sheet for that change: 28px radius, the change summarised in plain
words, the irreversibility stated, and a button naming the action.

Include the honest note about where approver keys live, as a Pending Well at body size, since this
deployment holds them server-side for the demo rather than on five separate phones.

NAVIGATION: the sheet's confirm opens a new ceremony in B9; cancel returns here.

Copy budget: the role phrases, the threshold sentence, the two notes.
```

---

## B11 — Operator alerts and finding detail

```
Produce two screens. Tab bar present, Alerts selected.

INBOX. Findings from the automated monitor. Each row is a Tier 1 Seated row with a 4px leading bar
pressed into its left edge in Refused, Pending or Mist by severity — never an emoji, never a coloured
circle. The row carries a plain-language title ("Splits have been running 5% under the rule for 11
days"), the time first seen, and the class affected. Filter chips: All, Severe, Warning, Resolved.
Empty state: "Nothing to look at. The monitor recomputes from indexed history every block."

DETAIL. The finding in full: what was observed, what was expected, and then the evidence as the
Tier 3 object — a moulded card containing a Well table of the specific transactions, block numbers
and basis-point deltas involved, every row linking to the explorer, numbers right-aligned and
tabular.

A closing 13pt Mist line: "Computed from indexed blockchain history. The monitor has no private data
source — you can recompute this from the same public data."

There is no dismiss button. The only actions are a 56px secondary "Mark as investigated" and a quiet
text button "Open the affected account".

NAVIGATION: inbox rows open the detail; the detail's second action opens B5.

Copy budget: the finding title, observed/expected lines, the closing line.
```

---

## B12 — Operator settings

```
Tab bar present. A plain grouped list, quiet by design — this screen should look like the least
interesting screen in the app.

Groups, each a Tier 1 Seated block with 13pt Mist section headings:
  Business — legal name, public page address with a preview link.
  Yield — READ-ONLY, no toggle switches, stated per class in words:
    "Client money — earns nothing. Fixed by the account class and cannot be switched on."
    "Obligation reserve — earns while idle."
  Chain — network name, chain id 5042002, the USDC contract address, the BoltRegistry address and
  the unlock timer address, all in mono inside Wells with explorer links.
  Policies — one row per account, each with its policy hash in mono.
  Index — the subgraph endpoint and the last indexed block, with the syncing strip from B20.
  Session — sign out.

Where a setting is not the user's to change, show the value and say what decides it. Never render a
disabled toggle: a toggle that cannot move is a lie about who is in control.

The single Tier 3 object is the public page preview card at the top — a moulded clay card showing
the slug and a 56px secondary button "Open the public page".

NAVIGATION: the preview card opens B14. Sign out returns to B1.

Copy budget: the two yield sentences, the section headings. Nothing else.
```

---

## B13 — Public landing page

```
Still a 390-wide phone screen, not a website. No tab bar; a 56px header with the BOLT wordmark and
one quiet text button "See a live page". A bottom sticky pill bar with three anchors: The rule,
The refusal, Coverage.

HERO: no big number, no gradient, no stat row. A single plainly set statement at Title 1, 28/34,
sitting on the flat Casing ground with nothing behind it:

  "Your customers' money should live in an account you are not able to spend from."

Beneath it, two sentences of body copy on how a payment splits the moment it arrives. Then two
56px buttons stacked: primary Indigo "See a live business's page", secondary "Try to break it".

Then three sections, each a piece of evidence rather than a feature card. They must not be three
identical cards:

1. The rule that does the work — the actual policy in mono inside a Well, with one short annotation
   beside the recipient condition explaining that a token transfer's on-chain destination is the
   token contract and not the payee, so the policy reads inside the transaction data.
2. The refusal — the refusal specimen from B20, verbatim, with the moulded stamp. THIS IS THE TIER 3
   OBJECT OF THE SCREEN and the only thing on it that carries full extrusion. One sentence above it:
   "This is what happens when the business itself tries to pay the wrong address. Not our error
   page — the enclave's own words."
3. Coverage through time — the coverage line with its Well-groove 100% datum, and one line beneath:
   "A proof of reserves gives you three points across ninety days. An index gives you every block."

Close with the standing line at Title 2, on flat ground: "We didn't prove the money is safe. We
removed the ability to move it, and put the proof on a page anyone can check."

No pricing table, no logo wall, no testimonials, no feature grid.

NAVIGATION: the primary button opens B14; the secondary opens B17.

Copy budget: the hero statement, two sentences, one line per section, the closing line.
```

---

## B14 — Public solvency page

```
The most important screen in the product. Phone-first, 390 wide. No tab bar. A 56px header with the
business name and a Seated live pill showing the last indexed block and how many seconds ago. A
bottom sticky segmented pill control with four anchors: Coverage, Accounts, Unlocks, My balance.

HEADER STATEMENT, Title 1: "Acme Marketplace holds 340 000.00 USDC for its sellers in accounts it
cannot pay itself from."

HERO (Tier 3): the coverage chart. A moulded clay card, 90 days, one line per account class, with
the 100% datum as a Well groove pressed into the card face. Unlock events mark the time axis as
small seats pressed into the baseline, tappable for a label. Beneath, in 12pt Mist: "Every point is
an indexed snapshot from the blockchain. 4 117 of them." No 3D, no gradient fill, no animated
counters.

OWED VERSUS HELD: a Well table — class, held, owed, coverage, yield setting, and the block the
figures came from. Numbers right-aligned and tabular; coverage in Covered or Refused. On a 390
viewport this table scrolls horizontally inside its own Well rather than wrapping. One line beneath:
"Client money never earns. That is the account class, not a setting the business can flip."

ACCOUNTS: one Seated row per account with the full address in mono wrapping to two lines, its label,
class, balance and policy hash, each linking to the block explorer. One instruction above: "Don't
trust this page. Open any address on the explorer and check the balance yourself."

EVERY UNLOCK EVER PERFORMED: Seated rows — date, amount, destination, the typed reason in full,
which approvers signed, whether each completed an identity check, and the transaction. Empty state:
"No locked money has ever been released early from this business." If approvals exist but no
identity check has completed, say that plainly rather than drawing a tick.

MY BALANCE: a quiet section with a Well email field and a 56px secondary button "Find my balance",
returning the amount, the address holding it, and whether the figure came from the index or from a
direct chain read.

SEVERE FINDINGS, if any: near the top, a Refused-hairlined Well with the same evidence-and-explorer
treatment as B11.

FOOTER: an honest-limits statement at full body size, never fine print — what is on testnet, what
has not been demonstrated.

NAVIGATION: "Find my balance" leads into B15.1. The chart's unlock seats open that ceremony's row.

Copy budget: the header statement, one line per section, the footer.
```

---

## B15.1 — Beneficiary sign in

```
A seller who is owed money and has never used a crypto wallet. They must never have to learn that
they are using one. No tab bar, no jargon, no chain names on this screen.

One centred Tier 3 clay card: "Find the money held for you" at Title 2, a Well email field, and a
56px Indigo button "Send me a sign-in link".

Beneath the card, one 13pt Mist line: "You don't need a wallet, a seed phrase, or any
cryptocurrency. Your balance already exists."

States: resting, link sent, and not-found — "We don't have a balance for that email at Acme
Marketplace. Check the address your invoices go to."

NAVIGATION: a valid link opens B15.2 on first claim, or B15.3 if this device has already been
verified for the address on file.

Copy budget: heading, button, one footer line, one not-found line.
```

---

## B15.2 — Beneficiary identity check

```
A World Selfie Check step. One object on the screen, centred, no tab bar.

A Tier 3 moulded clay card with a single 24px outlined icon, one instruction at Title 2 — "Check
that a live person is here" — and two body lines: what will happen and how long it takes ("about
fifteen seconds"), plus why: "We check before paying out money held for you." A 56px Indigo button
"Start the check".

Produce four states:
  Ready — as above.
  Waiting — the card becomes a Well, the button becomes a Seated strip reading "Open the check on
  your phone. Waiting for you to finish." Never a spinner with no text.
  Verified — a Covered tick moulded into the card, the verification reference in mono beneath, and
  the button becomes "Continue to your balance".
  Rejected — a Refused Well carrying World's own response body verbatim, not a rewritten message,
  with one line on what to do next.

Also show the reason variants, since the check is asked for three different reasons and the copy
differs: first claim, a changed withdrawal address, and a new device.

NAVIGATION: verified goes to B15.3. Rejected stays here with a retry.

Copy budget: the instruction, two body lines, the four state strings.
```

---

## B15.3 — Beneficiary balance

```
No tab bar. A 56px header with the business name.

THE HERO (Tier 3): the outstanding amount at 40pt tabular USDC inside a moulded clay card, with its
source caption naming the account address and the block. If several separate obligations make up the
total, list them as Seated rows beneath — each with its amount and what it is for.

Below the card, a Well containing the address holding the money in mono with an explorer link, and
one line: "This account is only able to pay you and the other sellers it holds money for. The
business cannot spend it."

A 56px Indigo button "Withdraw" at thumb height.

Empty state: "Nothing outstanding right now. New balances appear here as payments arrive."

NAVIGATION: the button opens B15.4. The header's business name opens B14.

Copy budget: the one Well line, the empty state. Nothing else.
```

---

## B15.4 — Beneficiary withdraw

```
No tab bar, back chevron. One decision per section.

1. Amount — a 40pt tabular Well input, pre-filled with the full outstanding amount, with the balance
   beneath.
2. Where it goes — a mono address Well field, pre-filled with the address they used last time if
   there is one.
3. How it travels — two selectable Seated rows: "Send on Arc" (the default, one line: "Arrives in
   seconds") and "Send to another chain" (one line naming the network and saying it will be bridged,
   with no other chain jargon).

Then the branch, which is the point of this screen and must be visually unmistakable:
  If the destination is one they have already verified, a Covered Seated strip: "You've used this
  address before, so there's no check this time." The primary button reads "Withdraw".
  If it is a new address, a Pending Well: "Changing where your money goes needs a fresh check. It's
  what stops someone who steals your session from redirecting your balance." The primary button
  reads "Check it's you, then withdraw".

The Tier 3 object is the confirmation summary card above the button: amount, destination, route.

Show the refusal case too: if the enclave refuses the destination, the refusal specimen from B20
appears verbatim, with one line above it in plain words: "That address isn't one this account is
able to pay."

NAVIGATION: verified path goes straight to B15.5. New-address path goes to B15.2 and returns here.

Copy budget: the two branch strings, the three route lines, the refusal line.
```

---

## B15.5 — Beneficiary confirmation

```
One object, centred, no tab bar, no confetti, no celebration illustration, no illustration at all.

A Tier 3 moulded clay card: "Sent" at Title 2 with a small Covered tick pressed into the clay, the
amount at 40pt tabular, and the destination address in mono beneath.

Below the card, two Wells: the transfer transaction hash in mono with an explorer link, and the
settlement transaction hash with its own link. Then the updated remaining balance with its source
caption.

A 56px secondary button "Back to my balance" and a quiet text button "See the public page".

Copy budget: the heading and the two button labels. Nothing else.
```

---

## B16 — Approver quorum authorization

```
The single screen a quorum member ever sees, opened from a link on their own phone. No navigation at
all: one object, one decision, one button. Generous type, nothing else competing.

Top: "Release 12 000.00 USDC" at 40pt tabular.

Then two Wells, stacked:
  from — the account label and its full address in mono with an explorer link.
  to — the destination label and its full address in mono with an explorer link.

The typed reason at body 16, in full, never truncated, on flat ground so it reads as a document
rather than a card. Beneath it, its hash in mono with a Covered tick and one line: "matches the hash
committed on chain".

QUORUM (Tier 3): a moulded clay panel with five circular seats pressed into it, filled seats as
Indigo domes standing proud. Beneath, one Seated row per approver: who, when, whether their identity
check completed, and the proof reference in mono. The current user's row reads "you — not yet".

The button, 56px Indigo. Produce all three states:
  Not yet verified — "Verify it is you", with one line: "A Selfie Check runs before your approval
  counts."
  Verified — "Approve this release", the button now the only extruded thing left on screen.
  Already approved by you — the button replaced by a Covered Seated strip: "You approved at 09:40."

A permanent 13pt Mist line at the bottom: "After the third approval a 24-hour timer starts on chain.
Nobody can shorten it, including us."

Also produce the two failure states as Refused Wells carrying the server's own message verbatim: a
Selfie Check World rejected, and a proof already used for this ceremony.

NAVIGATION: after approving, the screen stays put and updates the seats. It has no other destination
and needs none.

Copy budget: the hash line, the verify line, the closing line. Nothing else.
```

---

## B17 — Public breach simulator

```
An adversarial page. A stranger is handed the operator's seat on a real locked account holding real
funds and invited to steal from it. No tab bar. A 56px header reading "Breach simulator".

HEADER: "You are the operator. Try to move the money." at Title 1, then two short body lines: this
is a real account behind a real policy, the server does not check where you are sending funds, and
whatever comes back is the enclave's own words rather than an error page.

THE ACCOUNT YOU ARE ATTACKING: a Well listing, every value in mono with an explorer link — the
locked account address 0x42e895aD56D76c230BAF106F7d2BA52aA00Dc2F0, the one address its policy
permits 0x5C4107308B15447B6274971639D3EEd2b7974a66, the policy hash
0x6e7e4ac3185b1d1eef1e673223bdd6b67ed3b0b066a6d6d0b93d1c27051c871d, the chain id 5042002, and the
live balance read from the chain rather than reported by us.

THE CONSOLE: a mono address Well field with the placeholder "Paste any address — yours, if you
like", then the attacks as a vertical list of selectable Seated rows, each with a plain-English name
and a 12pt caption naming what stops it:
  Send the client money to your own address
  Skip the token contract — send native value instead
  Permitted transfer, with native value riding along
  Approve yourself as a spender
  Pull the money out with transferFrom
  Hand-encode the transfer with dirty address padding
  Append junk bytes after the calldata
  Wrap the transfer in a batch call
  Control: pay the one address the policy permits
A single 56px Indigo button "Attempt the transfer".

THE REFUSAL SPECIMEN — the Tier 3 object and the visual centrepiece of the whole product. The result
appears as a deep Well with the moulded stamp, containing the raw unedited enclave error in mono at
13/20, comfortably set rather than shrunk into a code block, selectable and copyable. Above it in
Mist: "Returned by the enclave, unedited." Below it, one sentence: "No signature was produced. There
is nothing to broadcast."

THE TALLY: three Seated figures — attempts, refusals, and signatures produced, the last permanently
at zero and stated as a figure rather than a boast. One 12pt line noting the tally resets when the
server restarts.

CLOSING: a Well explaining in two lines why this sandbox cannot touch a real business — it is owned
by a different key quorum.

Also produce the rate-limited state: a Pending Well reading "Too many attempts from this address in
the last minute. The lock is unaffected."

NAVIGATION: a quiet text button at the end, "See a real business's page", opening B14.

Copy budget: the two header lines, the attack captions, the two refusal lines, the closing two.
```

---

## B18 — Public, ask the monitor

```
One question, one answer. No tab bar. A 56px header reading "Ask the monitor".

A Well query field, full width, with a real example as its placeholder: "Was this business ever
short in August?" A 56px Indigo button "Ask".

THE ANSWER (Tier 3): a moulded clay card containing the answer as prose at body 16 — no bullet
soup, no summary card grid. Beneath it, its evidence as Seated rows: the dates, block numbers and
transactions it drew on, each linking to the explorer, with the figures tabular.

Produce three states:
  Thinking — a Seated strip naming what it is doing and roughly how long, never a bare spinner.
  Answered — as above.
  Reasoning unavailable — the evidence renders anyway, inside a Pending Well, with one line: "The
  reasoning step is unavailable right now. Here is the evidence it would have read, so you can draw
  the conclusion yourself." This state is not an error and must not look like one.
  Monitor unreachable — a Refused Well naming the endpoint it tried.

A short row of suggested questions as Seated chips beneath the field, three at most.

NAVIGATION: evidence rows open the block explorer; a quiet text button returns to B14.

Copy budget: the placeholder, the unavailable line, three chip labels.
```

---

## B19 — Auditor view, read-only

```
The public page's content with two additions and one permanent constraint. No tab bar. A 56px
header reading "Auditor view".

PERMANENT BANNER: a Well pinned under the header, at full body size: "Read-only. This view cannot
initiate anything." Never fine print, never dismissible.

TIME MACHINE (Tier 3): a moulded clay card holding a date-and-time control that reconstructs the
exact state at any past moment from indexed history. Once set, the card's heading reads: "State as
it stood at 14 August 2026, 09:00 UTC, block 8 001 244", and every figure elsewhere on the page
switches to that block and says so in its source caption. The control itself is a Well pressed into
the card.

Below: the same coverage chart, the same owed-versus-held table, the same accounts list and the same
unlock history as B14, all reconstructed at the chosen block, all still carrying their source lines.
Findings for that moment render with the same severity treatment as B11.

EXPORT: a 56px secondary button "Export this view as JSON", and beneath it one line: "The file names
the endpoint every figure came from. BOLT does not sign it — a signature from us would prove nothing
you should accept."

Empty state for a block before the business existed: "Nothing was indexed at that block. The first
snapshot is block 7 984 120."

NAVIGATION: a quiet text button opens the live public page B14.

Copy budget: the banner, the export line, the empty state. Nothing else.
```

---

# Part 4 — Deliverables per screen

For every screen block: **light theme first, then dark.** Phone at 390 × 844 is the only required
viewport. Do not produce a desktop or browser layout for any screen until the direction is
explicitly widened.

Keep the spacing scale, the type scale, the radius scale, the extrusion ladder and the
value-and-source pattern identical across all of them. The consistency *is* the argument: this
product's credibility is built out of the reader's sense that nothing here was improvised.
