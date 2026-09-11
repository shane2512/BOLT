/**
 * FR-9.1 — the simulator's attacks must really aim at the visitor's address.
 *
 * The failure this guards against is not a crash. It is someone "tidying up" the
 * simulator so it quietly sends to the permitted payee, or adding a destination
 * check so nothing dangerous is ever asked — either of which turns a live proof
 * into theatre while every button still lights up green. If an attack that says
 * it targets `destination` stops carrying `destination`, this test fails.
 */
import { describe, expect, it } from "vitest";
import { SIMULATOR_ATTACKS, findAttack, type AttackContext } from "./simulator.js";

const ctx: AttackContext = {
  from: "0x42e895aD56D76c230BAF106F7d2BA52aA00Dc2F0",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  permittedPayee: "0x5C4107308B15447B6274971639D3EEd2b7974a66",
  destination: "0x99e3b93861B2F931bcA75008459b3c040ea3274B"
};

const bare = (a: string): string => a.slice(2).toLowerCase();

describe("simulator attack suite", () => {
  it("puts the visitor's address into every attack that claims to use it", () => {
    for (const attack of SIMULATOR_ATTACKS.filter((a) => a.usesDestination)) {
      const tx = attack.build(ctx);
      const carries =
        tx.data.toLowerCase().includes(bare(ctx.destination)) ||
        tx.to.toLowerCase() === ctx.destination.toLowerCase();
      expect(carries, `${attack.id} does not target the visitor's address`).toBe(true);
    }
  });

  it("keeps the permitted-transfer control pointed at the permitted payee", () => {
    const control = findAttack("permitted-transfer");
    expect(control?.expect).toBe("ALLOW");
    const tx = control!.build(ctx);
    expect(tx.data.toLowerCase()).toContain(bare(ctx.permittedPayee));
    expect(tx.data.toLowerCase()).not.toContain(bare(ctx.destination));
    expect(tx.value).toBe("0x0");
  });

  it("keeps exactly one shape that is supposed to succeed", () => {
    expect(SIMULATOR_ATTACKS.filter((a) => a.expect === "ALLOW")).toHaveLength(1);
  });

  it("still carries the native-value attack, which only Arc makes possible", () => {
    // On Arc, USDC is the gas token: a bare value send moves the same balance
    // without ever touching the token contract. Deleting this attack would leave
    // the biggest hole in the suite untested.
    const native = findAttack("native-value-send");
    const tx = native!.build(ctx);
    expect(tx.to.toLowerCase()).toBe(ctx.destination.toLowerCase());
    expect(BigInt(tx.value)).toBeGreaterThan(0n);
    expect(tx.data).toBe("0x");
  });
});
