# The judge-holds-the-keys demo

**Ninety seconds in which someone who does not trust us tries to steal from a locked account and watches it fail.**

This is the one beat that does not require believing anything in the README. The judge does the typing. We do not touch the keyboard.

Target: **`/simulator`** — a real Privy organization, a real locked account holding real USDC on Arc testnet, behind a real policy. Rehearsed and timed on 2026-09-11; the measured run is at the bottom of this file.

---

## Before anyone is watching

Three things, in this order. The first one is not optional — it is the only way this beat has ever failed in rehearsal.

1. **Open `/simulator` once and wait for the nine attack buttons to appear.** In dev the first compile of that route took **52 seconds**; after that a reload is under five. If you show up cold, the page renders its header and an empty grid and you will be talking to a blank box. Load it, see nine buttons and a live balance, then leave the tab open.
2. **Check the balance line reads a number, not `unavailable`.** It says `account holds 0.2368… USDC · read live from Arc`. If it says `unavailable`, the Arc RPC is not answering and the refusals will still work but the opening line will not.
3. **Have a throwaway address in the clipboard** in case the judge does not have one — any 40-hex address will do, the policy refuses all of them equally. `0x1111111111111111111111111111111111111111` is fine.

> If the page has been open a long time and the dev server has hot-reloaded behind it, the buttons can disappear (stale chunks, 404s in the console). One hard reload fixes it. Reload before the demo, not during it.

---

## The script

Square brackets are what you say. Everything else is what happens on screen.

### 0:00 — hand over the keys

> **[** "This account holds someone else's money. You are now the operator — full privileges, no login, no approval step. I want you to steal it." **]**

Point at the two addresses in the grey box at the top:

> **[** "That's the account. That's the one address its policy permits. Click either, they're on the block explorer." **]**

### 0:15 — the judge types their own address

Hand over the keyboard. They paste **their own address** into *"Your address — where the money should go"*.

> **[** "Your address. Not one we chose." **]**

The nine attack buttons light up the moment the field parses as an address. Say the one line that matters about that:

> **[** "The only thing on this page that stops you is that the encoder needs twenty bytes. There is no check on *which* address." **]**

### 0:30 — the obvious theft

They click **"Send the client money to your own address"**.

Refused. **~0.6 seconds.** The panel says *Refused by the enclave — no signature was produced*, tagged `POLICY_VIOLATION`, and prints Privy's error body untouched:

```json
{ "error": "RPC request denied due to policy violation", "code": "policy_violation" }
```

> **[** "That is not our error page. That is Privy's, verbatim. The refusal happened inside the enclave before the signing key was reassembled — so there is no signature, and nothing to broadcast. Our server didn't get a vote." **]**

Open the **"what was sent to Privy"** disclosure for one second if they look sceptical. It is the exact transaction, built from their address.

### 0:50 — close the obvious loophole

They click **"Pull the money out with transferFrom"**.

Refused. **~1.0 second.**

> **[** "That's the one that usually works. Approve yourself an allowance, pull the money from a second wallet, never touch the locked account's own transfer. The policy decodes the calldata, so it sees the function name too." **]**

*(Optional third, if they're enjoying it — **"Wrap the transfer in Arc's Multicall3From batcher"**, refused in ~0.6 s. Cut this first if you are behind.)*

### 1:10 — prove the lock is not just a brick

They click **"Control: pay the one address the policy permits"**.

**Signed.** ~0.7 seconds. The panel header changes to *Signed* and prints the signed transaction.

> **[** "Same account, same policy, one second later — and this one signs. The account isn't frozen. It pays exactly one address and refuses the rest of the internet. The difference is not who asked or how senior they are. It is whether the decoded recipient is a permitted payee." **]**

### 1:25 — the tally

Point at **Attempts / Refused / Signed**.

> **[** "Everything anyone has tried on this page, since this server started." **]**

**Stop there.** Do not explain the architecture. The point has been made by someone who isn't us.

---

## If something goes wrong

| What you see | What it is | What to do |
|---|---|---|
| No attack buttons, balance `unavailable` | Page loaded before the route compiled, or stale chunks after a hot reload | Hard reload. It comes back in under five seconds. |
| `Too many attempts from this address in the last minute` | The per-IP cap, 20/minute. A quota guard, never a safety control | Say so — it is a fair question, and the honest answer is "that protects our Privy bill, not the money". Wait, or move to the public page. |
| `"0x…" is not an EVM address` | The judge's address is malformed | Retype it. Say the line about the encoder limit again — it is the truthful one. |
| An attack returns **Signed** when it should refuse | The lock is broken and the transaction is spendable | Do not spin. The page already says *"Please tell us."* Say the same thing out loud. |

---

## Timed rehearsal — 2026-09-11

Run against the live `/simulator` at `localhost:3000`, driving the real page and the real `/api/simulator` endpoint against the real Privy sandbox organization (`cmtwgf4pm000h0dl06apptrlv`, locked account `0x42e895aD56D76c230BAF106F7d2BA52aA00Dc2F0`). Clicks were dispatched against the live buttons; each round trip is a genuine call to the enclave.

**Full sequence, page reload to final result: 10.7 seconds**, of which 8.2 s was the dev-server page load. With the page already open — which is the pre-flight step above, and how the demo is actually run — the four beats cost **2.3 seconds of machine time**.

| Beat | Result | Round trip |
|---|---|---|
| Send the client money to your own address | Refused by the enclave | 561 ms |
| Pull the money out with `transferFrom` | Refused by the enclave | 553 ms |
| Wrap the transfer in Arc's Multicall3From batcher | Refused by the enclave | 563 ms |
| Control: pay the one address the policy permits | **Signed** | 655 ms |

Repeat single-beat measurements across the session: 550 ms, 985 ms, 1094 ms — so budget **~1 second per click**, not 0.5.

Session tally at the end: **10 attempts, 8 refused, 2 signed** — every one of them the outcome its attack expected. Nothing failed, and nothing behaved unexpectedly.

**Verdict: fits in 90 seconds with room to spare.** The machine work is under 3 seconds; the remaining 87 are talking, and the script above is written to be read at a normal speaking pace with the optional third attack as the slack. The only real risk to the clock is a cold page load, which is why it is step 1 of the pre-flight.

**Known limits of this rehearsal.** It ran against the dev server, not a production build — a production build's page load will be faster, not slower. Clicks were dispatched programmatically because the rehearsal ran with the browser window off-screen; the code path from click to enclave is identical either way, and the same page was driven by hand in Phase 9 Day 8 (`docs/evidence/phase9-simulator-live-page.json`).

---

## What this beat is not

It is not the whole demo. It proves *where* money may go, and nothing about *who* may start it moving — that is the World Selfie Check gate on the unlock ceremony and the beneficiary claim, and it is a different beat with a different honest caveat (see the README's World section). Do not let this one carry an argument it does not make.
