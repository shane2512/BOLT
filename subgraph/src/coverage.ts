import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Account, ClassPosition, CoverageSnapshot } from "../generated/schema";
import { Usdc } from "../generated/Usdc/Usdc";

// USDC on Arc. Native gas token and ERC-20 over one balance — see
// docs/evidence/PHASE0_DOC_RESEARCH.md. balanceOf() is the source of `held`.
export const USDC_ADDRESS = Address.fromString(
  "0x3600000000000000000000000000000000000000"
);

export const BPS_SCALE = BigInt.fromI32(10000);

export const CLASS_NAMES: string[] = [
  "OPERATING",
  "CLIENT_MONEY",
  "OBLIGATION_RESERVE"
];

export function className(index: i32): string {
  return index >= 0 && index < CLASS_NAMES.length
    ? CLASS_NAMES[index]
    : "OPERATING";
}

export function classIndex(name: string): i32 {
  for (let i = 0; i < CLASS_NAMES.length; i++) {
    if (CLASS_NAMES[i] == name) return i;
  }
  return 0;
}

/** ClassPosition id = businessId ++ classIndex. */
export function positionId(business: Bytes, klass: string): Bytes {
  return business.concatI32(classIndex(klass));
}

export function getOrCreatePosition(
  business: Bytes,
  klass: string,
  block: BigInt
): ClassPosition {
  const id = positionId(business, klass);
  let position = ClassPosition.load(id);
  if (position == null) {
    position = new ClassPosition(id);
    position.business = business;
    position.class_ = klass;
    position.held = BigInt.zero();
    position.owed = BigInt.zero();
    position.accountCount = 0;
    position.updatedAtBlock = block;
  }
  return position as ClassPosition;
}

/**
 * Read USDC.balanceOf(account) on chain at the current block and fold the delta
 * into the account's class position. Returns true if the balance moved.
 *
 * This is deliberately a live call rather than a running sum of indexed Transfer
 * logs: on Arc a *native-value* send moves USDC without touching the ERC-20
 * contract and so emits no Transfer log at 0x3600…0000. A balance read is the
 * only figure that is true regardless of which interface moved the money.
 *
 * ponytail: a native send that lands between two indexed events is not
 * snapshotted until the next event for that account. Fix, if it ever matters,
 * is a block handler — far too expensive on a chain at Arc's block rate.
 */
export function refreshHeld(account: Account, block: BigInt): boolean {
  const usdc = Usdc.bind(USDC_ADDRESS);
  const result = usdc.try_balanceOf(Address.fromBytes(account.id));
  if (result.reverted) return false;

  const previous = account.held;
  const current = result.value;
  account.heldAtBlock = block;
  account.held = current;
  account.save();

  if (current.equals(previous)) return false;

  const position = getOrCreatePosition(account.business, account.class_, block);
  position.held = position.held.plus(current.minus(previous));
  position.updatedAtBlock = block;
  position.save();
  return true;
}

/**
 * Cut a CoverageSnapshot for one (business, class) at this block. Called
 * whenever held or owed moved — that is the whole contract of FR-6.4: coverage
 * at an arbitrary block N is the latest snapshot with blockNumber <= N.
 */
export function writeSnapshot(
  position: ClassPosition,
  trigger: string,
  event: ethereum.Event
): void {
  const id = position.id
    .concat(Bytes.fromByteArray(Bytes.fromBigInt(event.block.number)))
    .concat(event.transaction.hash)
    .concatI32(event.logIndex.toI32());

  const snapshot = new CoverageSnapshot(id);
  snapshot.business = position.business;
  snapshot.class_ = position.class_;
  snapshot.held = position.held;
  snapshot.owed = position.owed;
  snapshot.ratioBps = position.owed.isZero()
    ? BPS_SCALE
    : position.held.times(BPS_SCALE).div(position.owed);
  snapshot.shortfall =
    position.owed.gt(BigInt.zero()) && position.held.lt(position.owed);
  snapshot.surplus = position.held.minus(position.owed);
  snapshot.trigger = trigger;
  snapshot.blockNumber = event.block.number;
  snapshot.timestamp = event.block.timestamp;
  snapshot.txHash = event.transaction.hash;
  snapshot.save();
}

/** Refresh an account's held balance and, if anything moved, snapshot it. */
export function refreshAndSnapshot(
  account: Account,
  trigger: string,
  event: ethereum.Event
): void {
  if (!refreshHeld(account, event.block.number)) return;
  const position = getOrCreatePosition(
    account.business,
    account.class_,
    event.block.number
  );
  writeSnapshot(position, trigger, event);
}
