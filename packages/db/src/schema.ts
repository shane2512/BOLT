import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex
} from "drizzle-orm/pg-core";

/**
 * Off-chain Postgres — config and workflow state only (REQUIREMENTS.md §4).
 * No figure on the public page may come from here (invariant 8); every table
 * below exists to drive the app, not to be the source of truth for a number.
 */

export const accountClassEnum = pgEnum("account_class", [
  "OPERATING",
  "CLIENT_MONEY",
  "OBLIGATION_RESERVE"
]);

export const obligationStatusEnum = pgEnum("obligation_status", [
  "OUTSTANDING",
  "PARTIALLY_SETTLED",
  "SETTLED"
]);

export const unlockStatusEnum = pgEnum("unlock_status", [
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTABLE",
  "EXECUTED",
  "CANCELLED"
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "INFO",
  "WARNING",
  "SEVERE"
]);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    adminAddress: text("admin_address").notNull(), // Privy org admin wallet/user
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("businesses_slug_idx").on(t.slug)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    address: text("address").notNull(), // Privy wallet address on Arc
    class: accountClassEnum("class").notNull(), // FR-1.2: immutable after creation
    label: text("label").notNull(),
    policyId: text("policy_id"), // Privy policy id currently attached (locked classes only)
    policyHash: text("policy_hash"), // matches AccountRegistered / PolicyRotated event
    yieldEnabled: boolean("yield_enabled").notNull().default(false), // FR-1.6/FR-11.2
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("accounts_address_idx").on(t.address)]
);

export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    email: text("email").notNull(),
    // The Privy user the pregenerated wallet is bound to (FR-8.1). Set at
    // pregeneration, before the beneficiary has ever signed in — it is what the
    // familiar email login later resolves to.
    privyUserId: text("privy_user_id"),
    walletAddress: text("wallet_address"), // pregenerated Privy wallet (FR-8.1), null until provisioned
    verifiedAddress: text("verified_address"), // last Selfie-Check-verified withdrawal address (FR-8.8)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("beneficiaries_business_email_idx").on(t.businessId, t.email)]
);

/**
 * FR-8.6 / FR-8.7 / FR-8.8 — one row per completed World Selfie Check by a
 * beneficiary, for one withdrawal address, from one device.
 *
 * This table is the whole of the "does this claim need a fresh check" decision
 * and it is deliberately an append-only ledger rather than a boolean on the
 * beneficiary: a first claim (eligibility) and an address change (continuity)
 * are the same shape of evidence about different facts, and an auditor should
 * be able to see every one of them, not the latest.
 *
 * `deviceId` is an opaque, client-generated identifier persisted in the
 * beneficiary's browser. It is not an authentication factor — it decides only
 * whether a check is *asked for*, never whether a payout is *allowed*. The two
 * things that make a payout safe are the Privy policy (where) and a verified
 * Selfie Check (who).
 */
export const beneficiaryVerifications = pgTable(
  "beneficiary_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => beneficiaries.id),
    // The withdrawal address this check authorised, lowercased.
    address: text("address").notNull(),
    // "FIRST_CLAIM" (FR-8.6) | "ADDRESS_CHANGE" (FR-8.7) | "NEW_DEVICE" (FR-8.7)
    reason: text("reason").notNull(),
    deviceId: text("device_id"),
    humanProofRef: text("human_proof_ref").notNull(), // the World nullifier, as issued
    // Same storage guidance as unlock_approvals: decimal, so 0x0a… and 0xA…
    // can never read as two different people.
    nullifier: numeric("nullifier", { precision: 78, scale: 0 }).notNull(),
    worldProof: jsonb("world_proof"), // World's verify response, verbatim
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // Anti-replay: one proof authorises one (beneficiary, address) once. Scoped
    // rather than global on purpose — the same human legitimately verifies again
    // when they change address, which is exactly what FR-8.7 asks for.
    uniqueIndex("beneficiary_verifications_addr_nullifier_idx").on(
      t.beneficiaryId,
      t.address,
      t.nullifier
    )
  ]
);

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  version: integer("version").notNull(), // FR-4.1: versioned, immutable
  rulesHash: text("rules_hash").notNull(), // matches MandatePublished event
  quorumRef: text("quorum_ref").notNull(), // key quorum approval reference (FR-4.2)
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow()
});

export const mandateRules = pgTable("mandate_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  mandateId: uuid("mandate_id")
    .notNull()
    .references(() => mandates.id),
  description: text("description").notNull(), // plain-language form, FR-4.3
  destinationAccountId: uuid("destination_account_id")
    .notNull()
    .references(() => accounts.id),
  bps: integer("bps").notNull() // basis points; a mandate's rules must sum to exactly 10000 (FR-3.5)
});

export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id), // the operating account that received it
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // USDC base units
    mandateVersion: integer("mandate_version").notNull(), // FR-3.4: active version at receipt time
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // FR-3.2: idempotent on (txHash, logIndex) — redelivery must not double-split
    uniqueIndex("deposits_tx_log_idx").on(t.txHash, t.logIndex)
  ]
);

export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  depositId: uuid("deposit_id")
    .notNull()
    .references(() => deposits.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  txHash: text("tx_hash"), // null until the session-signer transfer confirms
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const obligations = pgTable("obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  beneficiaryId: uuid("beneficiary_id").references(() => beneficiaries.id), // null for OBLIGATION_RESERVE (institutional, not a named beneficiary)
  amount: bigint("amount", { mode: "bigint" }).notNull(), // outstanding amount
  status: obligationStatusEnum("status").notNull().default("OUTSTANDING"),
  txRef: text("tx_ref"), // ObligationSettled(txRef) once paid
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true })
});

export const unlockRequests = pgTable("unlock_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  destination: text("destination").notNull(),
  reason: text("reason").notNull(), // free text (FR-5.1); only its hash goes on chain
  reasonHash: text("reason_hash").notNull(),
  status: unlockStatusEnum("status").notNull().default("PENDING_APPROVAL"),
  executableAt: timestamp("executable_at", { withTimezone: true }), // set once quorum + timer conditions are known
  // FR-5.2 — the Privy intent the quorum signs. The transaction itself lives in
  // the intent, not here; this is the handle used to fetch and authorize it.
  intentId: text("intent_id"),
  keyQuorumId: text("key_quorum_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const unlockApprovals = pgTable(
  "unlock_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unlockRequestId: uuid("unlock_request_id")
      .notNull()
      .references(() => unlockRequests.id),
    approver: text("approver").notNull(), // Privy user id of the approver
    humanProofRef: text("human_proof_ref").notNull(), // World Selfie Check proof reference (FR-5.3)
    // The same nullifier in decimal, per world-docs' storage guidance
    // (/world-id/idkit/integrate.mdx step 6): 0x0a… and 0xA… must never read as
    // two different people.
    nullifier: numeric("nullifier", { precision: 78, scale: 0 }),
    // World's verify response, verbatim. A refused or accepted Selfie Check is
    // evidence, exactly as a Privy policy refusal is.
    worldProof: jsonb("world_proof"),
    // This member's Privy authorization signature over the unlock request
    // (FR-5.2). Collected here, submitted together at execution; Privy's TEE is
    // what decides whether enough of them arrived.
    quorumSignature: text("quorum_signature"),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // One human, one approval, per unlock. The nullifier is per-(RP, action), so
    // the same person approving a *different* unlock is fine and expected —
    // which is why this is scoped to the request rather than being global.
    uniqueIndex("unlock_approvals_request_nullifier_idx").on(t.unlockRequestId, t.nullifier),
    uniqueIndex("unlock_approvals_request_approver_idx").on(t.unlockRequestId, t.approver)
  ]
);

export const policyRefusals = pgTable("policy_refusals", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").references(() => businesses.id),
  accountId: uuid("account_id").references(() => accounts.id),
  // Privy's raw error body, verbatim — never wrapped, prettified or swallowed
  // (invariant: recordPolicyRefusal stores it untouched).
  rawError: jsonb("raw_error").notNull(),
  attemptedAction: jsonb("attempted_action"), // what was attempted (params sent to Privy), for demo/evidence
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  severity: alertSeverityEnum("severity").notNull(),
  kind: text("kind").notNull(), // e.g. "MANDATE_DRIFT", "SHORTFALL_FORECAST", "SPLIT_FAILURE"
  message: text("message").notNull(),
  evidence: jsonb("evidence"), // block numbers, tx hashes, computed figures backing the finding
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true })
});
