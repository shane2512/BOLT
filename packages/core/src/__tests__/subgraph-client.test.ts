import { describe, expect, it, vi, afterEach } from "vitest";
import {
  querySubgraph,
  queryCoverageAtBlock,
  queryLatestCoverage,
  queryCoverageHistory,
  queryBusinessBySlug,
  queryUnlocks,
  queryAccountById,
  SubgraphQueryError
} from "../subgraph-client.js";
import { z } from "zod";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("querySubgraph", () => {
  it("parses a well-formed response through the given schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { n: "5" } })
      }))
    );
    const result = await querySubgraph(
      "https://example.invalid/graphql",
      "query { n }",
      {},
      z.object({ n: z.string() })
    );
    expect(result).toEqual({ n: "5" });
  });

  it("throws SubgraphQueryError on a GraphQL error envelope, not a silent partial result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ errors: [{ message: "field not found" }] })
      }))
    );
    await expect(
      querySubgraph("https://example.invalid/graphql", "query { bad }", {}, z.unknown())
    ).rejects.toThrow(SubgraphQueryError);
  });

  it("throws on a non-2xx HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    await expect(
      querySubgraph("https://example.invalid/graphql", "query { n }", {}, z.unknown())
    ).rejects.toThrow(SubgraphQueryError);
  });
});

describe("queryCoverageAtBlock", () => {
  it("parses BigInt-scalar fields as real bigints, never number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            coverageSnapshots: [
              {
                class: "CLIENT_MONEY",
                held: "8800000",
                owed: "8800000",
                ratioBps: "10000",
                shortfall: false,
                surplus: "0",
                trigger: "SplitExecuted",
                blockNumber: "60893705",
                timestamp: "1700000000"
              }
            ]
          }
        })
      }))
    );
    const rows = await queryCoverageAtBlock(
      "https://example.invalid/graphql",
      "0xbusiness",
      60893705n
    );
    const clientMoney = rows.find((r) => r.class === "CLIENT_MONEY");
    expect(typeof clientMoney?.held).toBe("bigint");
    expect(clientMoney?.held).toBe(8_800_000n);
  });

  it("queries each class independently, so one class's rows can never crowd another's out", async () => {
    // A single un-classed query ordered by block can return the same class
    // twice and miss another entirely once classes have uneven snapshot
    // density (caught live against real acme-marketplace data). Querying
    // per class in parallel is what prevents that; assert it does.
    const byClass: Record<string, { class: string; held: string; owed: string; ratioBps: string; shortfall: boolean; surplus: string; trigger: string; blockNumber: string; timestamp: string }> = {
      OPERATING: { class: "OPERATING", held: "796894", owed: "0", ratioBps: "10000", shortfall: false, surplus: "796894", trigger: "UsdcTransfer", blockNumber: "60905698", timestamp: "1" },
      CLIENT_MONEY: { class: "CLIENT_MONEY", held: "8800000", owed: "8800000", ratioBps: "10000", shortfall: false, surplus: "0", trigger: "ObligationAccrued", blockNumber: "60905707", timestamp: "2" },
      OBLIGATION_RESERVE: { class: "OBLIGATION_RESERVE", held: "400000", owed: "400000", ratioBps: "10000", shortfall: false, surplus: "0", trigger: "ObligationAccrued", blockNumber: "60905710", timestamp: "3" }
    };
    const seenClasses: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const variables = JSON.parse(init.body).variables;
        seenClasses.push(variables.class);
        return { ok: true, json: async () => ({ data: { coverageSnapshots: [byClass[variables.class]] } }) };
      })
    );
    const rows = await queryCoverageAtBlock("https://example.invalid/graphql", "0xbusiness", 60905710n);
    expect(seenClasses.sort()).toEqual(["CLIENT_MONEY", "OBLIGATION_RESERVE", "OPERATING"]);
    expect(rows.map((r) => r.class).sort()).toEqual(["CLIENT_MONEY", "OBLIGATION_RESERVE", "OPERATING"]);
    expect(rows.find((r) => r.class === "OPERATING")?.held).toBe(796_894n);
  });
});

describe("queryLatestCoverage", () => {
  it("has no block filter and queries each class independently for its own latest snapshot", async () => {
    const sentVariables: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const variables = JSON.parse(init.body).variables;
        sentVariables.push(variables);
        return {
          ok: true,
          json: async () => ({
            data: {
              coverageSnapshots: [
                {
                  class: variables.class,
                  held: "400000",
                  owed: "400000",
                  ratioBps: "10000",
                  shortfall: false,
                  surplus: "0",
                  trigger: "ObligationAccrued",
                  blockNumber: "60905710",
                  timestamp: "1788783058"
                }
              ]
            }
          })
        };
      })
    );
    const rows = await queryLatestCoverage("https://example.invalid/graphql", "0xbusiness");
    expect(sentVariables).toHaveLength(3);
    expect(sentVariables.every((v: any) => v.businessId === "0xbusiness" && !("block" in v))).toBe(true);
    expect(rows.map((r) => r.class).sort()).toEqual(["CLIENT_MONEY", "OBLIGATION_RESERVE", "OPERATING"]);
  });
});

describe("queryCoverageHistory", () => {
  it("parses a multi-point ordered history, not a single snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            coverageSnapshots: [
              {
                class: "OPERATING",
                held: "0",
                owed: "0",
                ratioBps: "10000",
                shortfall: false,
                surplus: "0",
                trigger: "AccountRegistered",
                blockNumber: "60902161",
                timestamp: "1788781230",
                txHash: "0xaaa"
              },
              {
                class: "OPERATING",
                held: "10000000",
                owed: "0",
                ratioBps: "10000",
                shortfall: false,
                surplus: "10000000",
                trigger: "UsdcTransfer",
                blockNumber: "60905675",
                timestamp: "1788783040",
                txHash: "0xbbb"
              }
            ]
          }
        })
      }))
    );
    const rows = await queryCoverageHistory("https://example.invalid/graphql", "0xbusiness");
    expect(rows).toHaveLength(2);
    expect(rows[0].blockNumber < rows[1].blockNumber).toBe(true);
    expect(rows[1].held).toBe(10_000_000n);
  });
});

describe("queryBusinessBySlug", () => {
  it("returns null when the slug isn't indexed, not an empty-shaped business", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { businesses: [] } }) }))
    );
    const business = await queryBusinessBySlug("https://example.invalid/graphql", "nonexistent");
    expect(business).toBeNull();
  });

  it("parses the business with its nested accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            businesses: [
              {
                id: "0xbusiness",
                slug: "acme-marketplace",
                admin: "0xadmin",
                registeredAtBlock: "60903103",
                registeredAtTimestamp: "1788781716",
                registeredTx: "0xtx",
                mandateVersion: "0",
                depositCount: "1",
                totalDeposited: "10000000",
                accounts: [
                  {
                    id: "0xaccount",
                    class: "CLIENT_MONEY",
                    label: "Client money",
                    policyHash: "0xhash",
                    held: "8800000",
                    heldAtBlock: "60905712",
                    owed: "8800000",
                    totalIn: "8800000",
                    totalOut: "0",
                    registeredAtBlock: "60903109",
                    registeredAtTimestamp: "1788781719",
                    registeredTx: "0xtx2"
                  }
                ]
              }
            ]
          }
        })
      }))
    );
    const business = await queryBusinessBySlug("https://example.invalid/graphql", "acme-marketplace");
    expect(business?.accounts).toHaveLength(1);
    expect(business?.accounts[0].held).toBe(8_800_000n);
    expect(business?.totalDeposited).toBe(10_000_000n);
  });
});

describe("queryUnlocks", () => {
  it("parses an empty unlock history correctly (Phase 6 hasn't run yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { unlocks: [] } }) }))
    );
    const unlocks = await queryUnlocks("https://example.invalid/graphql", "0xbusiness");
    expect(unlocks).toEqual([]);
  });
});

describe("queryAccountById", () => {
  it("returns null for an address with no registered BOLT account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { account: null } }) }))
    );
    const account = await queryAccountById("https://example.invalid/graphql", "0xnotanaccount");
    expect(account).toBeNull();
  });

  it("lowercases the address before querying (subgraph ids are lowercase)", async () => {
    let sentVariables: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        sentVariables = JSON.parse(init.body).variables;
        return {
          ok: true,
          json: async () => ({
            data: {
              account: {
                id: "0xe0d6fc2fdb556a26c173c6e5fa90d6b5283ff060",
                class: "OPERATING",
                label: "Operating",
                held: "796894",
                heldAtBlock: "60905718",
                owed: "0"
              }
            }
          })
        };
      })
    );
    const account = await queryAccountById(
      "https://example.invalid/graphql",
      "0xE0D6fc2FDb556a26C173C6E5FA90d6B5283fF060"
    );
    expect(sentVariables).toEqual({ id: "0xe0d6fc2fdb556a26c173c6e5fa90d6b5283ff060" });
    expect(account?.held).toBe(796_894n);
  });
});
