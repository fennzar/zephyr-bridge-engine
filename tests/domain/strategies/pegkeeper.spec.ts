import { describe, it, expect } from "vitest";
import { PegKeeperStrategy } from "@domain/strategies/pegkeeper";
import { createNormalModeState, createStateForRRMode, createMockInventorySnapshot, buildTestConfig } from "../../support/factories";

const strategy = new PegKeeperStrategy();
const inventory = createMockInventorySnapshot();
const config = buildTestConfig();

// Helper: set ZSD pool price. The pegkeeper looks for pool key containing "WZSD" and "USDT"
function stateWithZsdPrice(price: number, mode: "normal" | "defensive" | "crisis" = "normal") {
  return createStateForRRMode(mode, {
    evm: {
      pools: {
        "USDT.e::WZSD.e": {
          key: "USDT.e::WZSD.e", base: "WZSD.e", quote: "USDT.e",
          feeBps: 100, baseDecimals: 12, quoteDecimals: 6,
          price, priceInverse: 1 / price,
          address: "0xaaa1111111111111111111111111111111111111",
        },
      },
    },
  });
}

describe("PegKeeperStrategy.evaluate()", () => {
  it("detects premium when pool > 30bps above peg", () => {
    const state = stateWithZsdPrice(1.004); // +40bps
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].direction).toBe("zsd_premium");
  });

  it("detects discount when pool > 30bps below peg", () => {
    const state = stateWithZsdPrice(0.996); // -40bps
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].direction).toBe("zsd_discount");
  });

  it("no trigger within threshold", () => {
    const state = stateWithZsdPrice(1.002); // +20bps < 30bps
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });

  it("defensive mode widens threshold to 100bps", () => {
    const state = stateWithZsdPrice(1.004, "defensive"); // +40bps < 100bps
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });

  it("no opportunity without WZSD/USDT pool", () => {
    const state = createNormalModeState({ evm: { pools: {} } });
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });

  it("no opportunity without reserve data", () => {
    const state = stateWithZsdPrice(1.01);
    state.zephyr = undefined as any;
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });
});

describe("PegKeeperStrategy.shouldAutoExecute()", () => {
  it("auto-executes in normal mode when profitable", () => {
    const plan = {
      id: "test", strategy: "peg",
      opportunity: {
        id: "test", strategy: "peg", trigger: "test",
        asset: "ZSD", direction: "zsd_premium",
        expectedPnl: 5, urgency: "low" as const,
        context: { rrMode: "normal", deviationBps: 50 },
      },
      steps: [], estimatedCost: 2, estimatedDuration: 60000,
    };
    expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
  });

  it("blocks negative pnl", () => {
    const plan = {
      id: "test", strategy: "peg",
      opportunity: {
        id: "test", strategy: "peg", trigger: "test",
        asset: "ZSD", direction: "zsd_premium",
        expectedPnl: -2, urgency: "low" as const,
        context: { rrMode: "normal", deviationBps: 25 },
      },
      steps: [], estimatedCost: 2, estimatedDuration: 60000,
    };
    expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
  });
});
