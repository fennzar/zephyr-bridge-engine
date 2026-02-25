import { describe, it, expect } from "vitest";
import { mapBalanceSnapshot, computeAssetTotals } from "@domain/inventory/balances";
import type { BalanceSnapshot } from "@domain/inventory/types";

function makeSnapshot(overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    config: { mexcPaper: true, zephyrPaper: true },
    evm: { status: "ok", nativeSymbol: "ETH", native: 0, tokens: {}, ...overrides.evm },
    paper: overrides.paper ?? null,
    ...overrides,
  } as BalanceSnapshot;
}

describe("mapBalanceSnapshot", () => {
  const opts = { includeEvm: true, includePaperMexc: true, includePaperZephyr: true };

  it("maps EVM tokens to AssetIds", () => {
    const snapshot = makeSnapshot({ evm: { status: "ok", nativeSymbol: "ETH", native: 0, tokens: { WZSD: 100, WZEPH: 50 } } });
    const { balances } = mapBalanceSnapshot(snapshot, opts);
    expect(balances["WZSD.e"]).toBe(100);
    expect(balances["WZEPH.e"]).toBe(50);
  });

  it("maps EVM native ETH", () => {
    const snapshot = makeSnapshot({ evm: { status: "ok", nativeSymbol: "ETH", native: 1.5, tokens: {} } });
    const { balances } = mapBalanceSnapshot(snapshot, opts);
    expect(balances["ETH.e"]).toBe(1.5);
  });

  it("maps paper Zephyr balances", () => {
    const snapshot = makeSnapshot({ paper: { updatedAt: null, zephyr: { ZSD: 200, ZEPH: 100 } } });
    const { balances } = mapBalanceSnapshot(snapshot, opts);
    expect(balances["ZSD.n"]).toBe(200);
    expect(balances["ZEPH.n"]).toBe(100);
  });

  it("maps paper MEXC balances", () => {
    const snapshot = makeSnapshot({ paper: { updatedAt: null, mexc: { USDT: 500, ZEPH: 30 } } });
    const { balances } = mapBalanceSnapshot(snapshot, opts);
    expect(balances["USDT.x"]).toBe(500);
    expect(balances["ZEPH.x"]).toBe(30);
  });

  it("skips NaN values", () => {
    const snapshot = makeSnapshot({ evm: { status: "ok", nativeSymbol: "ETH", native: NaN, tokens: { WZSD: NaN } } });
    const { balances } = mapBalanceSnapshot(snapshot, opts);
    expect(balances["ETH.e"]).toBeUndefined();
    expect(balances["WZSD.e"]).toBeUndefined();
  });
});

describe("computeAssetTotals", () => {
  it("sums across venues by base asset", () => {
    const balances = { "WZEPH.e": 100, "ZEPH.n": 200, "ZEPH.x": 50 };
    const totals = computeAssetTotals(balances);
    expect(totals.ZEPH).toBe(350);
  });
});
