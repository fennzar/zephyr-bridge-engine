import { describe, it, expect } from "vitest";
import { ArbitrageStrategy } from "@domain/strategies/arbitrage";
import { createStateForRRMode, createMockInventorySnapshot, createMockCexMarket, createMockCexState } from "../../support/factories";

const strategy = new ArbitrageStrategy();
const inventory = createMockInventorySnapshot();

// Helper: create state with ZEPH premium (pool 0.85 vs CEX 0.75)
function stateWithZephPremium(mode: "normal" | "defensive" | "crisis", hasCex = true) {
  return createStateForRRMode(mode, {
    evm: {
      pools: {
        "WZEPH.e::WZSD.e": {
          key: "WZEPH.e::WZSD.e", base: "WZEPH.e", quote: "WZSD.e",
          feeBps: 3000, baseDecimals: 12, quoteDecimals: 12,
          price: 0.85, priceInverse: 1 / 0.85,
          address: "0xaaa2222222222222222222222222222222222222",
        },
      },
    },
    cex: hasCex ? createMockCexState({ markets: { ZEPH_USDT: createMockCexMarket() } }) : undefined,
  });
}

describe("ArbitrageStrategy RR policy gates", () => {
  it("ZEPH discount available in normal mode (zsd.mintable=true)", () => {
    const state = createStateForRRMode("normal", {
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e", base: "WZEPH.e", quote: "WZSD.e",
            feeBps: 3000, baseDecimals: 12, quoteDecimals: 12,
            price: 0.55, priceInverse: 1 / 0.55,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
      cex: createMockCexState({ markets: { ZEPH_USDT: createMockCexMarket() } }),
    });
    const result = strategy.evaluate(state, inventory);
    const opp = result.opportunities.find((o) => o.asset === "ZEPH" && o.direction === "evm_discount");
    expect(opp).toBeDefined();
    expect(opp!.context?.nativeCloseAvailable).toBe(true);
  });

  it("ZEPH discount uses CEX fallback when zsd.mintable=false", () => {
    const state = stateWithZephPremium("defensive", true);
    // In defensive mode, zsd.mintable=false but CEX is available
    // Need a discount state instead of premium - set low pool price
    const discountState = createStateForRRMode("defensive", {
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e", base: "WZEPH.e", quote: "WZSD.e",
            feeBps: 3000, baseDecimals: 12, quoteDecimals: 12,
            price: 0.55, priceInverse: 1 / 0.55,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
      cex: createMockCexState({ markets: { ZEPH_USDT: createMockCexMarket() } }),
    });
    const result = strategy.evaluate(discountState, inventory);
    const opp = result.opportunities.find((o) => o.asset === "ZEPH" && o.direction === "evm_discount");
    expect(opp).toBeDefined();
    expect(opp!.context?.cexCloseAvailable).toBe(true);
  });

  it("ZSD is always available regardless of policy", () => {
    const state = createStateForRRMode("defensive", {
      evm: {
        pools: {
          "USDT.e::WZSD.e": {
            key: "USDT.e::WZSD.e", base: "WZSD.e", quote: "USDT.e",
            feeBps: 100, baseDecimals: 12, quoteDecimals: 6,
            price: 1.05, priceInverse: 1 / 1.05,
            address: "0xaaa1111111111111111111111111111111111111",
          },
        },
      },
    });
    const result = strategy.evaluate(state, inventory);
    const opp = result.opportunities.find((o) => o.asset === "ZSD");
    expect(opp).toBeDefined();
  });

  it("ZYS is always available regardless of policy", () => {
    const state = createStateForRRMode("defensive", {
      evm: {
        pools: {
          "WZSD.e::WZYS.e": {
            key: "WZSD.e::WZYS.e", base: "WZYS.e", quote: "WZSD.e",
            feeBps: 500, baseDecimals: 12, quoteDecimals: 12,
            price: 1.5, priceInverse: 1 / 1.5,
            address: "0xaaa4444444444444444444444444444444444444",
          },
        },
      },
    });
    const result = strategy.evaluate(state, inventory);
    const opp = result.opportunities.find((o) => o.asset === "ZYS");
    expect(opp).toBeDefined();
  });

  it("ZRS blocked in defensive mode (no close path)", () => {
    const state = createStateForRRMode("defensive", {
      evm: {
        pools: {
          "WZEPH.e::WZRS.e": {
            key: "WZEPH.e::WZRS.e", base: "WZRS.e", quote: "WZEPH.e",
            feeBps: 3000, baseDecimals: 12, quoteDecimals: 12,
            price: 3.5, priceInverse: 1 / 3.5,
            address: "0xaaa3333333333333333333333333333333333333",
          },
        },
      },
    });
    const result = strategy.evaluate(state, inventory);
    const zrsOpp = result.opportunities.find((o) => o.asset === "ZRS");
    // In defensive mode, zrs.redeemable=false AND zrs.mintable=false, no CEX for ZRS
    expect(zrsOpp).toBeUndefined();
  });
});
