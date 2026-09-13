# BOLT — presentation script

Every slide and every video scene carries two readings, one after the other: **Concise**
for a tighter cut, **Normal** for a bit more explanation on screen. Pick whichever fits the
moment as you go — no need to commit to one for the whole run.

**Slide 9 is the cue to cut to your recorded video.** The video has its own 11 scenes,
in the second section below, same two-reading format.

---

## PPT slides

### Slide 1 — Title

**Concise**
> This is BOLT — money sits where a business physically can't spend it, and there's a
> public page for anyone to check. Built on Privy, Arc, and World.

**Normal**
> This is BOLT, short for Beneficiary-Only Ledger Transfers. Customer money sits in
> accounts a business is physically unable to spend from, and there's a public page where
> anyone can check that — no trust required. We built this for ETHOnline 2026, on Privy,
> Arc, and World.

### Slide 2 — The problem

**Concise**
> A business holding four hundred thousand dollars collects it all in one wallet —
> sellers' money, tax, and its own cut, all mixed together. Anyone holding the company keys
> can spend any of it, and proof of reserves doesn't stop that.

**Normal**
> So here's the problem we're solving. Say a marketplace collects four hundred thousand
> dollars in a month — three hundred forty of that's owed to sellers, twenty-eight thousand
> is sales tax, and thirty-two thousand is the company's own cut. All of it sits in one
> wallet, and a founder with the normal company keys can spend any of it, whenever they
> want, and it looks just like any other transaction. Proof of reserves doesn't fix
> that — it only tells you the money was there yesterday.

### Slide 3 — The idea

**Concise**
> We didn't try to prove the money is safe. We removed the ability to move it, and made
> the proof public. That enforcement runs inside a secure enclave, before a signature ever
> exists.

**Normal**
> So instead of trying to prove the money's safe, we removed the ability to move it, and
> put the proof on a page anyone can check. The enforcement itself is a policy that runs
> inside a secure enclave, before a signing key even gets reassembled. If it refuses,
> there's no signature — period.

### Slide 4 — The mechanism

**Concise**
> The policy reads inside the transaction itself, not just where it's headed, so only one
> exact recipient is ever allowed. And this refusal message you're looking at is real.

**Normal**
> Here's the actual rule doing the work. A USDC transfer's on-chain destination is the
> token contract, not the person getting paid — so the policy has to read inside the
> transaction itself, and it only allows one exact recipient. And this refusal message
> right here? That's real. That's what the enclave said back when we tried paying the
> wrong address.

### Slide 5 — Privy, the lock

**Concise**
> Privy is the lock. Policies, session signers, key quorums, and intents all work together
> here. We threw ten attacks at it, and every one was refused. A deposit splits across
> accounts in under twenty seconds, live on Arc.

**Normal**
> Privy is the lock here, and it's the core of this whole build. Four things are doing the
> work: policies that decode the actual calldata, session signers that box in the
> splitter's own key, key quorums on every policy change, and intents for every approval.
> We threw ten different attacks at this before building anything on top of it, and all ten
> were refused. The public simulator is at nine for nine. And a real deposit splits across
> three accounts in about eighteen seconds, live on Arc.

### Slide 6 — Arc, the rail

**Concise**
> Arc is the rail — every balance is USDC on Arc. Deposits split themselves
> automatically, and we've already bridged funds live to Base Sepolia. This is running on
> testnet today, and mainnet is rehearsed, but we're not claiming it yet.

**Normal**
> Arc is the rail — every balance, every split, every payout is USDC on Arc. And that
> matters more than it sounds, because USDC is Arc's own gas token, which is exactly why
> every policy checks that the value is zero — otherwise a transfer could sneak native
> value along with it. Deposits split themselves the moment they land, and we've actually
> run a live bridge from Arc to Base Sepolia — burn, attest, mint, all real, not simulated.
> This is running on Arc testnet right now. Mainnet is rehearsed, not claimed, since Arc's
> mainnet isn't public yet.

### Slide 7 — World, the gate

**Concise**
> World is the gate. On either exit, a real human has to verify before any money can leave
> a locked account.

**Normal**
> World is the gate. There are exactly two ways money leaves a locked account — an early
> unlock, or a beneficiary's first claim — and Selfie Check needs a real human before Privy
> will even consider signing either one. A verified person still can't send to some random
> address, and a permitted address still can't get paid by a bot.

### Slide 8 — How it fits together

**Concise**
> A buyer pays, Privy splits it, Arc holds it, the chain logs it, and the public page
> reads it straight from there. None of it comes from our own database.

**Normal**
> Quick look at how it all connects. A buyer pays, the Privy policy splits it inside its
> own enclave, the money lands in locked accounts on Arc, BoltRegistry logs the event, the
> subgraph picks it up, and the public page — along with our monitor — read straight from
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
> Privy decides where money can go, Arc is where it actually lives, and World decides who
> can even start it moving. Three jobs, and none of them are replaceable.

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

Plays during Slide 9. Concise reads the whole video in about 1:35. Normal reads it in
about 2:25–2:29, matching your actual recording.

### Scene 1 — Homepage

**Concise**
> This is BOLT. Money that isn't really the business's own sits somewhere it physically
> can't spend from, enforced by Privy and checked before a signature ever exists.

**Normal**
> This is BOLT. When a business is holding money that isn't really theirs — say, what it
> owes its sellers — that money sits somewhere the business can't spend from. Not a policy
> on paper. A rule enforced by Privy, checked before a signature can even exist.

### Scene 2 — Operator login

**Concise**
> We're signing in as the business now. No password — Privy just emails a code, and
> signing in doesn't give anyone power over customer money.

**Normal**
> Let's log in as the business first. No password, no wallet setup — Privy just emails a
> code. And logging in doesn't give you any power to touch customer money.

### Scene 3 — Coverage

**Concise**
> This is the coverage dashboard — does what's held match what's owed? It's split by
> category, and two of these accounts are locked. Nobody set that by hand.

**Normal**
> This is the first screen an operator sees — coverage. Does what's held match what's
> owed? Below it, you've got customer money, tax reserves, and the business's own funds.
> Two of these say Locked, one says Spendable — nobody flipped a switch for that. It's just
> which account the money happens to sit in.

### Scene 4 — Accounts

**Concise**
> These are the actual accounts behind those numbers. A locked one can only pay a verified
> recipient, and every address here is publicly checkable.

**Normal**
> Here are the actual accounts behind those numbers — what each one holds, what it owes,
> and what it's even allowed to do. A locked account can only pay someone who's already
> verified. And every address links to a public explorer, so don't take our word for it.

### Scene 5 — Activity

**Concise**
> This is a live feed of what's actually happened on-chain — deposits splitting
> automatically, releases being requested. Nothing here was typed in after the fact.

**Normal**
> This is just a live feed of what's happened on-chain — a deposit coming in and
> splitting itself automatically, or a release being requested. Every line links to its
> own transaction.

### Scene 6 — Approvals

**Concise**
> Releasing locked money early takes several people, each one proving in person that
> they're real. Every approval shows up as its own public transaction.

**Normal**
> Sometimes a business genuinely needs money out early — a refund, say. That's allowed,
> but it's not easy. It takes several people, and each one has to prove, in person, that
> they're a real human. You can see exactly who's signed off, and each approval is its own
> public transaction.

### Scene 7 — Alerts

**Concise**
> This is an automated monitor reading the same public data anyone else can, watching for
> things like money split in the wrong proportions.

**Normal**
> This monitor reads the exact same public data anyone else can. It's not watching for a
> hack — it's watching for something quieter, like money being split in the wrong
> proportions while the totals still add up.

### Scene 8 — Operator settings

**Concise**
> There's barely anything to configure in settings, and that's on purpose. What actually
> matters is a public contract address, not a toggle.

**Normal**
> Settings has almost nothing to configure, and that's on purpose. What actually
> matters — the contract, the USDC address on Arc — isn't a toggle at all. It's a public
> address you can go look up yourself.

### Scene 9 — Claim page

**Concise**
> Now let's flip to the other side — someone who's actually owed money. Just an email, no
> password.

**Normal**
> Now let's flip to the other side — this is what it looks like for someone who's
> actually owed money. No account to create, no password. Just the email their payment is
> recorded under.

### Scene 10 — World ID verification

**Concise**
> Before anything pays out, there's one more step — a quick face scan from World, proving
> a real person is here and not a script.

**Normal**
> Before anything pays out, there's one more step — proving a real person is here. This
> is World's Selfie Check, a quick face scan. It's not collecting an ID. It's just
> confirming that a real, living person is here right now, not a script and not someone
> using a stolen session.

### Scene 11 — Successful claim

**Concise**
> And that's it — paid straight to their address, and every part of it is checkable by
> anyone. Nobody had to trust us.

**Normal**
> And that's it. The payout goes straight to the destination address. The amount, who
> received it, the transaction itself — it's all right here, checkable by anyone. Nobody
> had to trust the business, and nobody had to trust us.
