/**
 * The mandate engine (FR-3.4, FR-3.5). Pure functions — no Privy, no database,
 * no chain. Given an amount and a mandate's rules, it says exactly how much goes
 * to each destination account, and it refuses to answer at all if the ratios do
 * not sum to 10000.
 *
 * `assertBpsSumTo10000` is called here on every computation, which is the
 * "asserted again immediately before signing" half of FR-3.5 — the splitter
 * calls `computeSplits` on the signing path, not just at write time. The other
 * half is `validateMandateRules`, called before a mandate row is ever inserted.
 *
 * There is a never-delete test for both. Do not soften either check.
 */
import { assertBpsSumTo10000, type Bps } from "./bps.js";
import { usdc, type Usdc } from "./usdc.js";

export interface MandateRule {
  /** `accounts.id` of the account this share lands in. */
  destinationAccountId: string;
  bps: Bps;
}

export interface SplitAllocation {
  destinationAccountId: string;
  amount: Usdc;
}

/**
 * Write-time gate (FR-3.5, first assertion). Call this before inserting a
 * mandate; it is the reason a mandate whose ratios sum to 9999 never reaches
 * the database, let alone a signer.
 */
export function validateMandateRules(rules: readonly MandateRule[]): void {
  if (rules.length === 0) throw new Error("mandate: a mandate has no rules");
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.destinationAccountId) {
      throw new Error("mandate: a rule has no destinationAccountId");
    }
    if (seen.has(rule.destinationAccountId)) {
      throw new Error(
        `mandate: destination ${rule.destinationAccountId} appears twice; ` +
          `merge the rules so each account has exactly one share`
      );
    }
    seen.add(rule.destinationAccountId);
  }
  assertBpsSumTo10000(rules.map((r) => r.bps));
}

/**
 * Splits `amount` across the mandate's rules (FR-3.5, second assertion — this
 * runs on the signing path).
 *
 * Allocation is by cumulative basis points rather than per-rule rounding, so the
 * allocations sum to `amount` exactly, with no dust left over and no remainder
 * quietly assigned to whichever rule happened to be last. Every share is within
 * one base unit of its exact ratio, and the result is deterministic: the same
 * deposit under the same mandate version always splits the same way, which is
 * what makes the Monitor's mandate-drift check (FR-7.3) meaningful.
 */
export function computeSplits(
  amount: Usdc,
  rules: readonly MandateRule[]
): SplitAllocation[] {
  validateMandateRules(rules);

  const allocations: SplitAllocation[] = [];
  let cumulativeBps = 0;
  let allocated = 0n;
  for (const rule of rules) {
    cumulativeBps += rule.bps;
    const cumulativeAmount = (amount * BigInt(cumulativeBps)) / 10_000n;
    allocations.push({
      destinationAccountId: rule.destinationAccountId,
      amount: usdc(cumulativeAmount - allocated)
    });
    allocated = cumulativeAmount;
  }

  // Belt and braces: the arithmetic above cannot lose a unit, but money is the
  // one place where "cannot" gets checked anyway.
  const total = allocations.reduce((sum, a) => sum + a.amount, 0n);
  if (total !== amount) {
    throw new Error(`mandate: splits sum to ${total}, deposit was ${amount}`);
  }
  return allocations;
}
