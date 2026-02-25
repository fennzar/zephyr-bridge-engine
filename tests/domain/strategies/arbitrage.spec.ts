import { describe, it, expect } from "vitest";
import { estimateSwapOutput } from "@domain/strategies/arbitrage";
import { ArbitrageStrategy } from "@domain/strategies/arbitrage";
import { createNormalModeState, createStateForRRMode, createMockInventorySnapshot } from "../../support/factories";

describe("estimateSwapOutput", () => {
  it("returns 0 for zero amountIn", () => {
    expect(estimateSwapOutput(0n, 1.0, 3000, 50)).toBe(0n);
  });

  it("returns 0 for zero price", () => {
    expect(estimateSwapOutput(1000000000000n, 0, 3000, 50)).toBe(0n);
  });

  it("returns 0 for negative amountIn", () => {
    expect(estimateSwapOutput(-100n, 1.0, 3000, 50)).toBe(0n);
  });

  it("applies 1:1 price with fees and slippage", () => {
    const amountIn = 1_000_000_000_000n; // 1.0 (12 decimals)
    // price = 1.0, fee = 3000 (0.3%), slippage = 50 bps (0.5%)
    const result = estimateSwapOutput(amountIn, 1.0, 3000, 50);
    // gross = 1_000_000_000_000
    // fee = 1_000_000_000_000 * 3000 / 1_000_000 = 3_000_000_000
    // slip = 1_000_000_000_000 * 50 / 10_000 = 5_000_000_000
    // net = 1_000_000_000_000 - 3_000_000_000 - 5_000_000_000 = 992_000_000_000
    expect(result).toBe(992_000_000_000n);
  });

  it("applies price ratio correctly", () => {
    const amountIn = 1_000_000_000_000n;
    // price = 0.5, fee = 0, slippage = 0
    const result = estimateSwapOutput(amountIn, 0.5, 0, 0);
    expect(result).toBe(500_000_000_000n);
  });

  it("handles high price multiplier", () => {
    const amountIn = 1_000_000_000_000n;
    // price = 2.0, fee = 0, slippage = 0
    const result = estimateSwapOutput(amountIn, 2.0, 0, 0);
    expect(result).toBe(2_000_000_000_000n);
  });

  it("never returns negative", () => {
    const amountIn = 100n; // very small
    // huge fee + slippage would push result negative
    const result = estimateSwapOutput(amountIn, 0.001, 500000, 5000);
    expect(result).toBeGreaterThanOrEqual(0n);
  });
});

describe("ArbitrageStrategy.evaluate()", () => {
  const strategy = new ArbitrageStrategy();
  const emptyInventory = createMockInventorySnapshot();

  it("GOLDEN: detects ZEPH evm_premium when pool price exceeds CEX", () => {
    const state = createNormalModeState({
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e",
            base: "WZEPH.e",
            quote: "WZSD.e",
            feeBps: 3000,
            baseDecimals: 12,
            quoteDecimals: 12,
            price: 0.85,  // premium: DEX $0.85 vs CEX $0.75
            priceInverse: 1 / 0.85,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
    });
    const result = strategy.evaluate(state, emptyInventory);
    const zephOpps = result.opportunities.filter((o) => o.asset === "ZEPH");
    expect(zephOpps.length).toBeGreaterThanOrEqual(1);
    const premiumOpp = zephOpps.find((o) => o.direction === "evm_premium");
    expect(premiumOpp).toBeDefined();
    expect(premiumOpp!.expectedPnl).toBeGreaterThan(0);
  });

  it("detects ZEPH evm_discount when pool price below CEX", () => {
    const state = createNormalModeState({
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e",
            base: "WZEPH.e",
            quote: "WZSD.e",
            feeBps: 3000,
            baseDecimals: 12,
            quoteDecimals: 12,
            price: 0.60,  // discount: DEX $0.60 vs CEX $0.75
            priceInverse: 1 / 0.60,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
    });
    const result = strategy.evaluate(state, emptyInventory);
    const discountOpp = result.opportunities.find(
      (o) => o.asset === "ZEPH" && o.direction === "evm_discount"
    );
    expect(discountOpp).toBeDefined();
  });

  it("returns no ZEPH opportunities when prices aligned", () => {
    // Default createNormalModeState has WZEPH.e at 0.75 matching CEX mid 0.75
    const state = createNormalModeState();
    const result = strategy.evaluate(state, emptyInventory);
    const zephOpps = result.opportunities.filter((o) => o.asset === "ZEPH");
    expect(zephOpps.length).toBe(0);
  });

  it("returns no opportunities without reserve data", () => {
    const state = createNormalModeState();
    state.zephyr = undefined as any;
    const result = strategy.evaluate(state, emptyInventory);
    expect(result.opportunities).toHaveLength(0);
    expect(result.warnings).toContain("No reserve data available");
  });

  it("warns on defensive RR mode", () => {
    const state = createStateForRRMode("defensive");
    const result = strategy.evaluate(state, emptyInventory);
    expect(result.warnings?.some((w) => w.includes("defensive"))).toBe(true);
  });

  it("warns on crisis RR mode", () => {
    const state = createStateForRRMode("crisis");
    const result = strategy.evaluate(state, emptyInventory);
    expect(result.warnings?.some((w) => w.includes("crisis"))).toBe(true);
  });

  it("includes gap metrics per asset", () => {
    const state = createNormalModeState();
    const result = strategy.evaluate(state, emptyInventory);
    expect(result.metrics.totalLegsChecked).toBe(8);
    expect(result.metrics).toHaveProperty("reserveRatio");
  });
});

describe("ArbitrageStrategy.buildPlan()", () => {
  const strategy = new ArbitrageStrategy();
  const emptyInventory = createMockInventorySnapshot();

  it("GOLDEN: ZEPH evm_premium plan includes swapEVM step", async () => {
    const state = createNormalModeState({
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e",
            base: "WZEPH.e",
            quote: "WZSD.e",
            feeBps: 3000,
            baseDecimals: 12,
            quoteDecimals: 12,
            price: 0.85,
            priceInverse: 1 / 0.85,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
    });
    // Get opportunity from evaluate
    const eval_ = strategy.evaluate(state, emptyInventory);
    const opp = eval_.opportunities.find(
      (o) => o.asset === "ZEPH" && o.direction === "evm_premium"
    );
    expect(opp).toBeDefined();

    const plan = await strategy.buildPlan(opp!, state, emptyInventory);
    expect(plan).not.toBeNull();
    expect(plan!.steps.length).toBeGreaterThan(0);
    const swapStep = plan!.steps.find((s) => s.op === "swapEVM");
    expect(swapStep).toBeDefined();
    expect(swapStep!.from).toBe("WZEPH.e");
    expect(swapStep!.to).toBe("WZSD.e");
  });

  it("returns null for unknown leg", async () => {
    const state = createNormalModeState();
    const opportunity = {
      id: "test", strategy: "arb", trigger: "test",
      asset: "UNKNOWN", direction: "evm_premium",
      expectedPnl: 50, urgency: "medium" as const,
    };
    const plan = await strategy.buildPlan(opportunity, state, emptyInventory);
    expect(plan).toBeNull();
  });

  it("plan has positive duration", async () => {
    const state = createNormalModeState({
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e",
            base: "WZEPH.e",
            quote: "WZSD.e",
            feeBps: 3000,
            baseDecimals: 12,
            quoteDecimals: 12,
            price: 0.85,
            priceInverse: 1 / 0.85,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
    });
    const eval_ = strategy.evaluate(state, emptyInventory);
    const opp = eval_.opportunities.find(
      (o) => o.asset === "ZEPH" && o.direction === "evm_premium"
    );
    const plan = await strategy.buildPlan(opp!, state, emptyInventory);
    expect(plan!.estimatedDuration).toBeGreaterThan(0);
  });

  it("ZEPH clip is based on $500 / zephPriceUsd", async () => {
    const state = createNormalModeState({
      evm: {
        pools: {
          "WZEPH.e::WZSD.e": {
            key: "WZEPH.e::WZSD.e",
            base: "WZEPH.e",
            quote: "WZSD.e",
            feeBps: 3000,
            baseDecimals: 12,
            quoteDecimals: 12,
            price: 0.85,
            priceInverse: 1 / 0.85,
            address: "0xaaa2222222222222222222222222222222222222",
          },
        },
      },
    });
    const eval_ = strategy.evaluate(state, emptyInventory);
    const opp = eval_.opportunities.find(
      (o) => o.asset === "ZEPH" && o.direction === "evm_premium"
    );
    const plan = await strategy.buildPlan(opp!, state, emptyInventory);
    // $500 / $0.75 = 666.67 ZEPH = 666_666_666_666n atomic (12 decimals)
    const firstStep = plan!.steps[0];
    expect(firstStep.amountIn).toBe(BigInt(Math.floor((500 / 0.75) * 1e12)));
  });
});
