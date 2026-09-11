import { Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Transfer } from "../generated/Usdc/Usdc";
import { Account, UsdcTransfer } from "../generated/schema";
import { refreshAndSnapshot } from "./coverage";

/** tx hash ++ log index ++ side — a Transfer can touch two registered accounts. */
function transferId(event: ethereum.Event, side: i32): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32()).concatI32(side);
}

/**
 * USDC ERC-20 Transfer. Only fires for the ERC-20 interface — a native-value
 * send on Arc moves the same balance without this log (see coverage.ts), which
 * is exactly why `held` is read live via balanceOf rather than accumulated from
 * these logs alone. What this handler is for: a per-account flow history
 * (totalIn/totalOut, the UsdcTransfer list) and catching a balance move on the
 * account the instant it's indexed, not only when a BoltRegistry event happens
 * to touch the same account.
 */
export function handleUsdcTransfer(event: Transfer): void {
  const sender = Account.load(event.params.from);
  if (sender != null) {
    const row = new UsdcTransfer(transferId(event, 0));
    row.account = sender.id;
    row.counterparty = event.params.to;
    row.amount = event.params.value;
    row.incoming = false;
    row.blockNumber = event.block.number;
    row.timestamp = event.block.timestamp;
    row.txHash = event.transaction.hash;
    row.save();

    sender.totalOut = sender.totalOut.plus(event.params.value);
    sender.save();
    refreshAndSnapshot(sender, "UsdcTransfer", event);
  }

  const recipient = Account.load(event.params.to);
  if (recipient != null) {
    const row = new UsdcTransfer(transferId(event, 1));
    row.account = recipient.id;
    row.counterparty = event.params.from;
    row.amount = event.params.value;
    row.incoming = true;
    row.blockNumber = event.block.number;
    row.timestamp = event.block.timestamp;
    row.txHash = event.transaction.hash;
    row.save();

    recipient.totalIn = recipient.totalIn.plus(event.params.value);
    recipient.save();
    refreshAndSnapshot(recipient, "UsdcTransfer", event);
  }
}
