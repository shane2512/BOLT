/**
 * B13 — the public landing page.
 *
 * The policy conditions and the refusal below are copied verbatim from real
 * evidence files (docs/evidence/phase0-policy.json,
 * phase9-simulator-wrong-destination.json) — a real live policy and a real
 * recorded refusal from a real locked account on Arc testnet, not invented
 * examples. Invariant 6: nothing here may be mocked.
 */
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ClayWell } from "@/components/ui/ClayWell";
import { ClaySlab } from "@/components/ui/ClaySlab";
import { Button } from "@/components/ui/Button";
import { RawRefusalSpecimen } from "@/components/ui/RawRefusalSpecimen";
import { ScrollSpyPillBar } from "@/components/ui/ScrollSpyPillBar";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { queryBusinesses } from "@bolt/core";

// docs/evidence/phase0-policy.json, rule "USDC transfer to permitted payee (send)".
const POLICY_CONDITIONS = [
  { source: "ethereum_transaction", field: "to", op: "in", value: "0x3600…0000 (the USDC contract)" },
  { source: "ethereum_transaction", field: "chain_id", op: "in", value: "5042002" },
  { source: "ethereum_transaction", field: "value", op: "eq", value: "0" },
  { source: "ethereum_calldata", field: "function_name", op: "eq", value: "transfer" },
  { source: "ethereum_calldata", field: "transfer._to", op: "in", value: "0x634186…D5407" }
];

// docs/evidence/phase9-simulator-wrong-destination.json, `rawError.error`,
// exactly as Privy returned it.
const REAL_REFUSAL = {
  error: "RPC request denied due to policy violation",
  code: "policy_violation"
};

export default async function LandingPage() {
  const subgraphUrl = process.env.SUBGRAPH_URL;
  let firstSlug: string | null = null;
  if (subgraphUrl) {
    try {
      const businesses = await queryBusinesses(subgraphUrl);
      firstSlug = businesses[0]?.slug ?? null;
    } catch {
      firstSlug = null;
    }
  }

  const desktop = (
    <DesktopShell>
      <section className="grid grid-cols-2 gap-16 items-start">
        <div className="flex flex-col gap-6">
          <h1 className="text-[48px] leading-[54px] font-semibold text-[#0A0A0A] tracking-[-0.015em]">
            Customer money in an account the business is physically unable to spend from.
          </h1>
          <p className="text-[18px] leading-[28px] text-[#5A5A5A] max-w-[520px]">
            The block is a policy evaluated inside a secure enclave before any signing key is
            assembled — a disallowed payment never produces a signature. A public page lets anyone
            verify the money is there without trusting the business or BOLT.
          </p>
          <div className="flex gap-3 pt-2">
            {firstSlug && (
              <Link href={`/${firstSlug}`}>
                <Button variant="primary" fullWidth={false} className="px-8">
                  See a live business&apos;s page
                </Button>
              </Link>
            )}
            <Link href="/simulator">
              <Button variant={firstSlug ? "secondary" : "primary"} fullWidth={false} className="px-8">
                Try to break it
              </Button>
            </Link>
          </div>
        </div>
        <ClaySlab hero className="p-6 flex flex-col gap-4">
          <h2 className="text-[18px] font-semibold text-[#0A0A0A]">Coverage through time</h2>
          <p className="text-[14px] text-[#5A5A5A] leading-relaxed">
            A proof of reserves gives you three points across ninety days. An index gives you every
            block a balance moved.
          </p>
          <Link href="/auditor">
            <Button variant="secondary">Open the auditor view</Button>
          </Link>
        </ClaySlab>
      </section>

      <section className="grid grid-cols-2 gap-10 pt-16 mt-16 border-t border-[#DCDCDC]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[22px] font-semibold text-[#0A0A0A]">The rule that does the work</h2>
            <p className="text-[14px] text-[#5A5A5A] leading-relaxed">
              A token transfer&apos;s on-chain destination is the token contract, not the person
              being paid — so the rule reads inside the transaction data.
            </p>
          </div>
          <ClayWell variant="standard" className="p-4 border border-[#DCDCDC]">
            {POLICY_CONDITIONS.map((c) => (
              <div key={c.field} className="py-2 border-b border-[#DCDCDC] last:border-0">
                <div className="font-mono text-[11px] text-[#7C7C7C]">
                  {c.source}.<span className="text-[#0A0A0A]">{c.field}</span>
                </div>
                <div className="font-mono mt-0.5 text-[12px] break-all text-[#0A0A0A]">
                  <span className="text-[#7C7C7C]">{c.op}</span> {c.value}
                </div>
              </div>
            ))}
          </ClayWell>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[22px] font-semibold text-[#0A0A0A]">The refusal</h2>
            <p className="text-[14px] text-[#5A5A5A] leading-relaxed">
              This is what happens when the business itself tries to pay the wrong address. Not our
              error page — the enclave&apos;s own words.
            </p>
          </div>
          <RawRefusalSpecimen error={REAL_REFUSAL} />
          <Link href="/simulator">
            <Button variant="secondary" fullWidth={false} className="self-start px-6">
              Do it yourself
            </Button>
          </Link>
        </div>
      </section>

      <div className="pt-16 mt-16 border-t border-[#DCDCDC] max-w-[760px]">
        <p className="text-[24px] leading-[32px] font-semibold text-[#0A0A0A]">
          We didn&apos;t prove the money is safe. We removed the ability to move it, and put the
          proof on a page anyone can check.
        </p>
        <p className="text-[13px] text-[#7C7C7C] mt-4">
          Arc testnet. BOLT provides technical enforcement and public verifiability — it does not
          make anyone compliant with any regulation, and does not claim to.
        </p>
        <div className="mt-5 flex flex-wrap gap-5">
          <Link href="/ask" className="text-[14px] font-medium text-[#0A0A0A] underline">
            Ask the monitor
          </Link>
          <Link href="/claim" className="text-[14px] font-medium text-[#0A0A0A] underline">
            I&apos;m owed money
          </Link>
          <Link href="/operator" className="text-[14px] font-medium text-[#0A0A0A] underline">
            Operator sign in
          </Link>
        </div>
      </div>
    </DesktopShell>
  );

  return (
    <AppFrame desktop={desktop}>
      <div className="flex-1 flex flex-col gap-6 p-4 pb-24">
        <section id="overview" className="flex flex-col gap-5 pt-2">
          <h1 className="text-[28px] leading-[34px] font-semibold text-[#0A0A0A] tracking-[-0.01em]">
            Customer money in an account the business is physically unable to spend from.
          </h1>
          <p className="text-[16px] leading-[24px] font-normal text-[#5A5A5A]">
            The block is a policy evaluated inside a secure enclave before any signing key is
            assembled — a disallowed payment never produces a signature. A public page lets anyone
            verify the money is there without trusting the business or BOLT.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            {firstSlug && (
              <Link href={`/${firstSlug}`} className="w-full">
                <Button variant="primary">See a live business&apos;s page</Button>
              </Link>
            )}
            <Link href="/simulator" className="w-full">
              <Button variant={firstSlug ? "secondary" : "primary"}>Try to break it</Button>
            </Link>
          </div>
        </section>

        <section id="evidence" className="flex flex-col gap-6 pt-4 border-t border-[#DCDCDC]">
          <div className="flex flex-col gap-1">
            <h2 className="text-[20px] font-semibold text-[#0A0A0A]">The rule that does the work</h2>
            <p className="text-[14px] text-[#5A5A5A]">
              A token transfer&apos;s on-chain destination is the token contract, not the person
              being paid — so the rule reads inside the transaction data.
            </p>
          </div>

          <ClayWell variant="standard" className="p-4 border border-[#DCDCDC]">
            {POLICY_CONDITIONS.map((c) => (
              <div key={c.field} className="py-2 border-b border-[#DCDCDC] last:border-0">
                <div className="font-mono text-[11px] text-[#7C7C7C]">
                  {c.source}.<span className="text-[#0A0A0A]">{c.field}</span>
                </div>
                <div className="font-mono mt-0.5 text-[12px] break-all text-[#0A0A0A]">
                  <span className="text-[#7C7C7C]">{c.op}</span> {c.value}
                </div>
              </div>
            ))}
          </ClayWell>

          <div className="flex flex-col gap-1 pt-2">
            <h2 className="text-[20px] font-semibold text-[#0A0A0A]">The refusal</h2>
            <p className="text-[14px] text-[#5A5A5A]">
              This is what happens when the business itself tries to pay the wrong address. Not our
              error page — the enclave&apos;s own words.
            </p>
          </div>

          <RawRefusalSpecimen error={REAL_REFUSAL} />

          <div className="mt-1">
            <Link href="/simulator" className="w-full block">
              <Button variant="secondary">Do it yourself</Button>
            </Link>
          </div>
        </section>

        <section id="coverage" className="flex flex-col gap-4 pt-4 border-t border-[#DCDCDC]">
          <h2 className="text-[20px] font-semibold text-[#0A0A0A]">Coverage through time</h2>
          <p className="text-[14px] text-[#5A5A5A]">
            A proof of reserves gives you three points across ninety days. An index gives you every
            block a balance moved.
          </p>
          <ClaySlab hero className="p-5">
            <Link href="/auditor" className="w-full block">
              <Button variant="secondary">Open the auditor view</Button>
            </Link>
          </ClaySlab>
        </section>

        <div className="pt-4">
          <p className="text-[20px] leading-[26px] font-semibold text-[#0A0A0A]">
            We didn&apos;t prove the money is safe. We removed the ability to move it, and put the
            proof on a page anyone can check.
          </p>
          <p className="text-[13px] text-[#7C7C7C] mt-4">
            Arc testnet. BOLT provides technical enforcement and public verifiability — it does not
            make anyone compliant with any regulation, and does not claim to.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/ask" className="text-[14px] font-medium text-[#0A0A0A] underline">
              Ask the monitor
            </Link>
            <Link href="/claim" className="text-[14px] font-medium text-[#0A0A0A] underline">
              I&apos;m owed money
            </Link>
            <Link href="/operator" className="text-[14px] font-medium text-[#0A0A0A] underline">
              Operator sign in
            </Link>
          </div>
        </div>
      </div>

      <ScrollSpyPillBar
        anchors={[
          { id: "overview", label: "Overview" },
          { id: "evidence", label: "Evidence" },
          { id: "coverage", label: "Coverage" }
        ]}
      />
    </AppFrame>
  );
}
