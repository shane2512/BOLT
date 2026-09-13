# BOLT — presentation script

Every slide and every video scene carries two readings, one after the other: **Concise**
for a tighter cut, **Normal** for a bit more explanation on screen. Pick whichever fits the
moment as you go — no need to commit to one for the whole run.

**Slide 9 is the cue to cut to your recorded video.** The video has its own 11 scenes,
in the second section below, same two-reading format — read Concise there if you want to
stay safely inside 2:25.

A few words that read fine but trip people up out loud have been swapped for plainer ones
throughout: "enclave" → "vault," "calldata" → "transaction data," "reassembled" → "rebuilt,"
"subgraph" → "index," and "BoltRegistry" is written as two words so it doesn't run together.
"Base Sepolia" stays as-is — it's a real network name, no simpler way to say it.

---

## PPT slides

### Slide 1 — Title

**Concise**
> This is BOLT — money a business can't spend from, checkable by anyone on a public page.
> Built on Privy, Arc, and World.

**Normal**
> This is BOLT, short for Beneficiary-Only Ledger Transfers. Customer money sits in
> accounts a business is physically unable to spend from, and there's a public page where
> anyone can check that — no trust required. We built this for ETHOnline 2026, on Privy,
> Arc, and World.

### Slide 2 — The problem

**Concise**
> A business collects sellers' money, tax, and its own cut into one wallet. Anyone with
> the company keys can spend any of it — proof of reserves doesn't stop that.

**Normal**
> So here's the problem we're solving. Say a marketplace collects four hundred thousand
> dollars in a month — three hundred forty of that's owed to sellers, twenty-eight thousand
> is sales tax, and thirty-two thousand is the company's own cut. All of it sits in one
> wallet, and a founder with the normal company keys can spend any of it, whenever they
> want, and it looks just like any other transaction. Proof of reserves doesn't fix
> that — it only tells you the money was there yesterday.

### Slide 3 — The idea

**Concise**
> We didn't try to prove the money is safe — we removed the ability to move it, and made
> the proof public. Enforcement runs inside a secure vault, before a signature ever exists.

**Normal**
> So instead of trying to prove the money's safe, we removed the ability to move it, and
> put the proof on a page anyone can check. The enforcement itself is a policy that runs
> inside a secure vault, before a signing key is ever rebuilt. If it refuses, there's no
> signature — period.

### Slide 4 — The mechanism

**Concise**
> The policy reads inside the transaction itself, not just where it's headed, so only one
> recipient is ever allowed — and this refusal message is real.

**Normal**
> Here's the actual rule doing the work. A USDC transfer's on-chain destination is the
> token contract, not the person getting paid — so the policy has to read inside the
> transaction itself, and it only allows one exact recipient. And this refusal message
> right here? That's real. That's what the vault said back when we tried paying the wrong
> address.

### Slide 5 — Privy, the lock

**Concise**
> Privy is the lock — policies, session signers, key quorums, and intents. We threw ten
> attacks at it, and every one was refused. A deposit splits across accounts in under
> twenty seconds, live on Arc.

**Normal**
> Privy is the lock here. Four things do the work: policies that decode the actual
> transaction data, session signers that box in the splitter's own key, key quorums on
> every policy change, and intents for every approval. We threw ten attacks at this
> policy, and all ten were refused — the public simulator is at nine for nine. A real
> deposit splits across three accounts in about eighteen seconds, live on Arc.

### Slide 6 — Arc, the rail

**Concise**
> Arc is the rail — every balance is USDC on Arc. Deposits split themselves
> automatically, and we've bridged funds live to Base Sepolia. Testnet today; mainnet's
> rehearsed, not claimed.

**Normal**
> Arc is the rail — every balance, every split, every payout is USDC on Arc. USDC is also
> Arc's own gas token, which is why every policy checks that the value is zero — otherwise
> a transfer could sneak native value along with it. Deposits split themselves the moment
> they land, and we've run a live bridge from Arc to Base Sepolia — burn, attest, mint, all
> real. This is on Arc testnet right now; mainnet is rehearsed, not claimed, since it isn't
> public yet.

### Slide 7 — World, the gate

**Concise**
> World is the gate — a real human has to verify before money leaves a locked account,
> either way.

**Normal**
> World is the gate. Money leaves a locked account exactly two ways — an early unlock, or
> a beneficiary's first claim — and Selfie Check needs a real human before Privy will even
> sign either one. A verified person still can't send to a random address, and a permitted
> address still can't be paid by a bot.

### Slide 8 — How it fits together

**Concise**
> A buyer pays, Privy splits it, Arc holds it, the chain logs it, and the public page
> reads it straight from there — not from our own database.

**Normal**
> Quick look at how it all connects. A buyer pays, the Privy policy splits it inside its
> own vault, the money lands in locked accounts on Arc, the Bolt Registry logs the event,
> the index picks it up, and the public page — along with our monitor — read straight from
> that. Every number you see traces back to an actual event or balance, never our own
> database.

### Slide 9 — Bridge into the video

**Concise**
> Let's just show you.

**Normal**
> Alright, enough talking about it — let's just show you.

*[ cut to video — see Video scenes below ]*

### Slide 10 — Three sponsors

**Concise**
> Privy decides where money can go, Arc is where it lives, and World decides who can
> start it moving — three jobs, none replaceable.

**Normal**
> Three sponsors, three different jobs, and you can't pull any one of them out. Privy
> decides where money can go — that's what we're submitting for Best B2B financial product
> and Best financial flow. Arc is where it all actually lives — that's Best DeFi and
> Onchain Finance Application. And World decides who's even allowed to start it moving.

### Slide 11 — Thank you

**Concise**
> Thanks for watching. Everything here is checkable — that's BOLT.

**Normal**
> Thanks for watching. Everything in here points to a real transaction, a real policy, or
> a real address — not just our word for it. We're happy to open any of it up. That's BOLT.

---

## Video scenes

Plays during Slide 9. Concise reads the whole video in about 1:20. Normal reads it in
about 2:25–2:29, matching your actual recording.

### Scene 1 — Homepage

**Concise**
> This is BOLT. Money that isn't really the business's own sits somewhere the business
> can't spend from — enforced by Privy, checked before a signature exists.

**Normal**
> This is BOLT. When a business is holding money that isn't really theirs — say, what it
> owes its sellers — that money sits somewhere the business can't spend from. Not a policy
> on paper. A rule enforced by Privy, checked before a signature can even exist.

### Scene 2 — Operator login

**Concise**
> Signing in as the business. No password — Privy emails a code, and it doesn't give
> anyone power over customer money.

**Normal**
> Let's log in as the business first. No password, no wallet setup — Privy just emails a
> code. And logging in doesn't give you any power to touch customer money.

### Scene 3 — Coverage

**Concise**
> The coverage dashboard — does what's held match what's owed? Split by category, and two
> of these accounts are locked — nobody set that by hand.

**Normal**
> This is the first screen an operator sees — coverage. Does what's held match what's
> owed? Below it, you've got customer money, tax reserves, and the business's own funds.
> Two of these say Locked, one says Spendable — nobody flipped a switch for that. It's just
> which account the money happens to sit in.

### Scene 4 — Accounts

**Concise**
> The actual accounts behind those numbers — a locked one can only pay a verified
> recipient, and every address is publicly checkable.

**Normal**
> Here are the actual accounts behind those numbers — what each one holds, what it owes,
> and what it's even allowed to do. A locked account can only pay someone who's already
> verified. And every address links to a public explorer, so don't take our word for it.

### Scene 5 — Activity

**Concise**
> A live feed of what's happened on-chain — deposits splitting automatically, releases
> being requested, nothing typed in after the fact.

**Normal**
> This is just a live feed of what's happened on-chain — a deposit coming in and
> splitting itself automatically, or a release being requested. Every line links to its
> own transaction.

### Scene 6 — Approvals

**Concise**
> Releasing locked money early takes several people, each proving in person they're
> real — and every approval is its own public transaction.

**Normal**
> Sometimes a business genuinely needs money out early — a refund, say. That's allowed,
> but it's not easy. It takes several people, and each one has to prove, in person, that
> they're a real human. You can see exactly who's signed off, and each approval is its own
> public transaction.

### Scene 7 — Alerts

**Concise**
> An automated monitor reading the same public data anyone else can, watching for money
> split in the wrong proportions.

**Normal**
> This monitor reads the exact same public data anyone else can. It's not watching for a
> hack — it's watching for something quieter, like money being split in the wrong
> proportions while the totals still add up.

### Scene 8 — Operator settings

**Concise**
> There's barely anything to configure in settings, on purpose — what matters is a
> public contract address, not a toggle.

**Normal**
> The settings page has almost nothing to configure, and that's on purpose. What actually
> matters — the contract, the USDC address on Arc — isn't a toggle at all. It's a public
> address you can go look up yourself.

### Scene 9 — Claim page

**Concise**
> Now the other side — someone who's actually owed money. Just an email, no password.

**Normal**
> Now let's flip to the other side — this is what it looks like for someone who's
> actually owed money. No account to create, no password. Just the email their payment is
> recorded under.

### Scene 10 — World ID verification

**Concise**
> One more step before anything pays out — a quick face scan from World, proving a real
> person's here, not a script.

**Normal**
> Before anything pays out, there's one more step — proving a real person is here. This
> is World's Selfie Check, a quick face scan. It's not collecting an ID. It's just
> confirming that a real, living person is here right now, not a script and not someone
> using a stolen session.

### Scene 11 — Successful claim

**Concise**
> And that's it — paid straight to their address, checkable by anyone. Nobody had to
> trust us.

**Normal**
> And that's it. The payout goes straight to the destination address. The amount, who
> received it, the transaction itself — it's all right here, checkable by anyone. Nobody
> had to trust the business, and nobody had to trust us.
