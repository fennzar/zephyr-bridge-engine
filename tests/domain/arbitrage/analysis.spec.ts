import { describe, it, expect } from "vitest";
import { readPoolPriceFromState, buildPricingFromState, analyzeArbMarkets } from "@domain/arbitrage/analysis";
import { createMockGlobalState, createNormalModeState, createMockEvmPool } from "../../support/factories";

describe("readPoolPriceFromState", () => {
  it("returns price for direct match", () => {
    const pools = {
      "USDT.e::WZSD.e": createMockEvmPool({
        base: "WZSD.e", quote: "USDT.e", price: 1.002, priceInverse: 1 / 1.002,
      }),
    };
    // readPoolPriceFromState sorts ["WZSD.e", "USDT.e"] → "USDT.e::WZSD.e"
    expect(readPoolPriceFromState(pools, "WZSD.e", "USDT.e")).toBe(1.002);
  });

  it("returns priceInverse for inverted match", () => {
    const pools = {
      "USDT.e::WZSD.e": createMockEvmPool({
        base: "WZSD.e", quote: "USDT.e", price: 1.002, priceInverse: 0.998,
      }),
    };
    // Searching for USDT.e as base → pool has USDT.e as quote → inverted
    expect(readPoolPriceFromState(pools, "USDT.e", "WZSD.e")).toBe(0.998);
  });

  it("returns null for missing pool", () => {
    expect(readPoolPriceFromState({}, "WZSD.e", "USDT.e")).toBeNull();
  });
});

describe("buildPricingFromState", () => {
  it("returns empty for null state", () => {
    expect(buildPricingFromState(null)).toEqual({});
  });

  it("returns pricing bundles for all 4 assets", () => {
    const state = createNormalModeState();
    const pricing = buildPricingFromState(state);
    expect(Object.keys(pricing).sort()).toEqual(["ZEPH", "ZRS", "ZSD", "ZYS"]);
  });

  it("ZSD dex pricing comes from WZSD/USDT pool", () => {
    const state = createNormalModeState();
    const pricing = buildPricingFromState(state);
    expect(pricing.ZSD.dex.priceUsd).toBe(1.0);
  });

  it("ZEPH includes CEX pricing when market available", () => {
    const state = createNormalModeState();
    const pricing = buildPricingFromState(state);
    expect(pricing.ZEPH.cex).not.toBeNull();
    expect(pricing.ZEPH.cex!.priceUsd).toBe(0.75); // mid of 0.745/0.755
  });
});

describe("analyzeArbMarkets", () => {
  it("returns 4 entries with correct structure", () => {
    const state = createNormalModeState();
    const results = analyzeArbMarkets(state);
    expect(results).toHaveLength(4);
    const assets = results.map((r) => r.asset).sort();
    expect(assets).toEqual(["ZEPH", "ZRS", "ZSD", "ZYS"]);
    for (const r of results) {
      expect(r).toHaveProperty("wrappedSymbol");
      expect(r).toHaveProperty("triggerBps");
      expect(r).toHaveProperty("direction");
      expect(r).toHaveProperty("gapBps");
      expect(r).toHaveProperty("meetsTrigger");
    }
  });
});
