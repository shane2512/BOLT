import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  AccountRegistered,
  BusinessRegistered,
  DepositObserved,
  MandatePublished,
  ObligationAccrued,
  ObligationSettled,
  PolicyRotated,
  RecorderUpdated,
  SplitExecuted,
  UnlockApproved,
  UnlockCancelled,
  UnlockExecuted,
  UnlockRequested
} from "../generated/BoltRegistry/BoltRegistry";
import {
  Account,
  Approval,
  Business,
  Deposit,
  Mandate,
  Obligation,
  ObligationSettlement,
  PolicyRotation,
  RecorderChange,
  Split,
  Unlock
} from "../generated/schema";
import {
  className,
  getOrCreatePosition,
  refreshAndSnapshot,
  refreshHeld,
  writeSnapshot
} from "./coverage";

/** tx hash ++ log index — the standard unique-per-log id (subgraph-dev SKILL.md). */
function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function handleBusinessRegistered(event: BusinessRegistered): void {
  const business = new Business(event.params.businessId);
  business.slug = event.params.slug;
  business.admin = event.params.admin;
  business.registeredAtBlock = event.block.number;
  business.registeredAtTimestamp = event.block.timestamp;
  business.registeredTx = event.transaction.hash;
  business.mandateVersion = BigInt.zero();
  business.depositCount = BigInt.zero();
  business.totalDeposited = BigInt.zero();
  business.save();
}

export function handleAccountRegistered(event: AccountRegistered): void {
  // The account address is the entity id: everything downstream — splits,
  // obligations, USDC transfers — joins on it.
  const account = new Account(event.params.account);
  account.business = event.params.businessId;
  account.class_ = className(event.params.class_);
  account.label = event.params.label;
  account.policyHash = event.params.policyHash;
  account.registeredAtBlock = event.block.number;
  account.registeredAtTimestamp = event.block.timestamp;
  account.registeredTx = event.transaction.hash;
  account.held = BigInt.zero();
  account.heldAtBlock = event.block.number;
  account.owed = BigInt.zero();
  account.totalIn = BigInt.zero();
  account.totalOut = BigInt.zero();
  account.save();

  const position = getOrCreatePosition(
    event.params.businessId,
    account.class_,
    event.block.number
  );
  position.accountCount = position.accountCount + 1;
  position.updatedAtBlock = event.block.number;
  position.save();

  // Read whatever is already on chain at this address, then snapshot: an
  // account may be funded before it is registered, and coverage must not
  // pretend otherwise.
  refreshHeld(account, event.block.number);
  writeSnapshot(
    getOrCreatePosition(event.params.businessId, account.class_, event.block.number),
    "AccountRegistered",
    event
  );
}

export function handlePolicyRotated(event: PolicyRotated): void {
  const rotation = new PolicyRotation(eventId(event));
  rotation.business = event.params.businessId;
  rotation.account = event.params.account;
  rotation.oldPolicyHash = event.params.oldPolicyHash;
  rotation.newPolicyHash = event.params.newPolicyHash;
  rotation.quorumRef = event.params.quorumRef;
  rotation.blockNumber = event.block.number;
  rotation.timestamp = event.block.timestamp;
  rotation.txHash = event.transaction.hash;
  rotation.save();

  const account = Account.load(event.params.account);
  if (account != null) {
    account.policyHash = event.params.newPolicyHash;
    account.save();
  }
}

export function handleMandatePublished(event: MandatePublished): void {
  const mandate = new Mandate(eventId(event));
  mandate.business = event.params.businessId;
  mandate.version = event.params.version;
  mandate.rulesHash = event.params.rulesHash;
  mandate.quorumRef = event.params.quorumRef;
  mandate.blockNumber = event.block.number;
  mandate.timestamp = event.block.timestamp;
  mandate.txHash = event.transaction.hash;
  mandate.save();

  const business = Business.load(event.params.businessId);
  if (business != null) {
    business.mandateVersion = event.params.version;
    business.save();
  }
}

export function handleDepositObserved(event: DepositObserved): void {
  const deposit = new Deposit(event.params.depositId);
  deposit.business = event.params.businessId;
  deposit.amount = event.params.amount;
  deposit.mandateVersion = event.params.mandateVersion;
  deposit.blockNumber = event.block.number;
  deposit.timestamp = event.block.timestamp;
  deposit.txHash = event.transaction.hash;
  deposit.splitTotal = BigInt.zero();
  deposit.save();

  const business = Business.load(event.params.businessId);
  if (business != null) {
    business.depositCount = business.depositCount.plus(BigInt.fromI32(1));
    business.totalDeposited = business.totalDeposited.plus(event.params.amount);
    business.save();
  }
}

export function handleSplitExecuted(event: SplitExecuted): void {
  const split = new Split(eventId(event));
  split.deposit = event.params.depositId;
  split.account = event.params.account;
  split.amount = event.params.amount;
  split.blockNumber = event.block.number;
  split.timestamp = event.block.timestamp;
  split.txHash = event.transaction.hash;
  split.save();

  const deposit = Deposit.load(event.params.depositId);
  if (deposit != null) {
    deposit.splitTotal = deposit.splitTotal.plus(event.params.amount);
    deposit.save();
  }

  // The split moved money; re-read the balance rather than trusting the amount
  // in the event (invariant 8 — the record is the claim, the balance is the fact).
  const account = Account.load(event.params.account);
  if (account != null) refreshAndSnapshot(account, "SplitExecuted", event);
}

export function handleObligationAccrued(event: ObligationAccrued): void {
  let obligation = Obligation.load(event.params.obligationId);
  if (obligation == null) {
    obligation = new Obligation(event.params.obligationId);
    obligation.business = event.params.businessId;
    obligation.account = event.params.account;
    obligation.beneficiaryRef = event.params.beneficiaryRef;
    obligation.accrued = BigInt.zero();
    obligation.settled = BigInt.zero();
    obligation.outstanding = BigInt.zero();
    obligation.accruedAtBlock = event.block.number;
    obligation.accruedAtTimestamp = event.block.timestamp;
    obligation.accruedTx = event.transaction.hash;
  }
  obligation.accrued = obligation.accrued.plus(event.params.amount);
  obligation.outstanding = obligation.outstanding.plus(event.params.amount);
  obligation.save();

  applyOwedDelta(
    event.params.account,
    event.params.amount,
    "ObligationAccrued",
    event
  );
}

export function handleObligationSettled(event: ObligationSettled): void {
  const obligation = Obligation.load(event.params.obligationId);
  if (obligation == null) return;

  const settlement = new ObligationSettlement(eventId(event));
  settlement.obligation = obligation.id;
  settlement.amount = event.params.amount;
  settlement.txRef = event.params.txRef;
  settlement.blockNumber = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.txHash = event.transaction.hash;
  settlement.save();

  obligation.settled = obligation.settled.plus(event.params.amount);
  obligation.outstanding = obligation.outstanding.minus(event.params.amount);
  obligation.save();

  applyOwedDelta(
    Bytes.fromByteArray(obligation.account),
    event.params.amount.neg(),
    "ObligationSettled",
    event
  );
}

/**
 * Move `owed` on the account and on its class position, refresh the balance, and
 * cut one snapshot covering both halves of the ratio.
 */
function applyOwedDelta(
  accountAddress: Bytes,
  delta: BigInt,
  trigger: string,
  event: ethereum.Event
): void {
  const account = Account.load(accountAddress);
  if (account == null) return;

  account.owed = account.owed.plus(delta);
  account.save();

  const position = getOrCreatePosition(
    account.business,
    account.class_,
    event.block.number
  );
  position.owed = position.owed.plus(delta);
  position.updatedAtBlock = event.block.number;
  position.save();

  refreshHeld(account, event.block.number);
  writeSnapshot(
    getOrCreatePosition(account.business, account.class_, event.block.number),
    trigger,
    event
  );
}

export function handleUnlockRequested(event: UnlockRequested): void {
  const unlock = new Unlock(event.params.unlockId);
  unlock.business = event.params.businessId;
  unlock.account = event.params.account;
  unlock.amount = event.params.amount;
  unlock.destination = event.params.destination;
  unlock.reasonHash = event.params.reasonHash;
  unlock.executableAt = event.params.executableAt;
  unlock.status = "REQUESTED";
  unlock.approvalCount = 0;
  unlock.requestedAtBlock = event.block.number;
  unlock.requestedAtTimestamp = event.block.timestamp;
  unlock.requestedTx = event.transaction.hash;
  unlock.save();
}

export function handleUnlockApproved(event: UnlockApproved): void {
  const unlock = Unlock.load(event.params.unlockId);
  if (unlock == null) return;

  const approval = new Approval(eventId(event));
  approval.unlock = unlock.id;
  approval.approver = event.params.approver;
  approval.humanProofRef = event.params.humanProofRef;
  approval.blockNumber = event.block.number;
  approval.timestamp = event.block.timestamp;
  approval.txHash = event.transaction.hash;
  approval.save();

  unlock.approvalCount = unlock.approvalCount + 1;
  unlock.save();
}

export function handleUnlockExecuted(event: UnlockExecuted): void {
  const unlock = Unlock.load(event.params.unlockId);
  if (unlock == null) return;

  unlock.status = "EXECUTED";
  unlock.executedAmount = event.params.amount;
  unlock.executedAtBlock = event.block.number;
  unlock.executedAtTimestamp = event.block.timestamp;
  unlock.executedTx = event.transaction.hash;
  unlock.save();

  const account = Account.load(Bytes.fromByteArray(unlock.account));
  if (account != null) refreshAndSnapshot(account, "UnlockExecuted", event);
}

export function handleUnlockCancelled(event: UnlockCancelled): void {
  const unlock = Unlock.load(event.params.unlockId);
  if (unlock == null) return;

  unlock.status = "CANCELLED";
  unlock.cancelReasonHash = event.params.reasonHash;
  unlock.cancelledAtBlock = event.block.number;
  unlock.cancelledAtTimestamp = event.block.timestamp;
  unlock.cancelledTx = event.transaction.hash;
  unlock.save();
}

export function handleRecorderUpdated(event: RecorderUpdated): void {
  const change = new RecorderChange(eventId(event));
  change.oldRecorder = event.params.oldRecorder;
  change.newRecorder = event.params.newRecorder;
  change.blockNumber = event.block.number;
  change.timestamp = event.block.timestamp;
  change.txHash = event.transaction.hash;
  change.save();
}
