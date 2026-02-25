import { describe, it, expect } from "vitest";
import { RebalancerStrategy } from "@domain/strategies/rebalancer";
import { createNormalModeState, createMockInventorySnapshot, buildTestConfig } from "../../support/factories";
import type { AssetId } from "@domain/types";

const strategy = new RebalancerStrategy();
const config = buildTestConfig();

describe("RebalancerStrategy.evaluate()", () => {
  it("no rebalance with zero balances", () => {
    const state = createNormalModeState();
    const inventory = createMockInventorySnapshot();
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });

  it("no rebalance without reserve data", () => {
    const state = createNormalModeState();
    state.zephyr = undefined as any;
    const inventory = createMockInventorySnapshot();
    const result = strategy.evaluate(state, inventory);
    expect(result.opportunities).toHaveLength(0);
  });

  it("detects EVM over-allocation (80% vs target 30%)", () => {
    const state = createNormalModeState();
    const inventory = createMockInventorySnapshot({
      "WZEPH.e": 800,
      "ZEPH.n": 100,
      "ZEPH.x": 100,
    } as Record<AssetId, number>);
    const result = strategy.evaluate(state, inventory);
    const zephOpp = result.opportunities.find((o) => o.asset === "ZEPH");
    expect(zephOpp).toBeDefined();
  });

  it("ignores <10% deviation", () => {
    const state = createNormalModeState();
    // 35% EVM vs 30% target = 5% deviation < 10% threshold
    const inventory = createMockInventorySnapshot({
      "WZEPH.e": 35,
      "ZEPH.n": 45,
      "ZEPH.x": 20,
    } as Record<AssetId, number>);
    const result = strategy.evaluate(state, inventory);
    const zephOpp = result.opportunities.find((o) => o.asset === "ZEPH");
    expect(zephOpp).toBeUndefined();
  });
});

describe("RebalancerStrategy.shouldAutoExecute()", () => {
  it("auto-executes in normal mode with low cost", () => {
    const plan = {
      id: "test", strategy: "rebalancer",
      opportunity: {
        id: "test", strategy: "rebalancer", trigger: "test",
        asset: "ZEPH", direction: "evm_to_native",
        expectedPnl: -5, urgency: "low" as const,
        context: { rrMode: "normal" },
      },
      steps: [], estimatedCost: 5, estimatedDuration: 60000,
    };
    expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
  });

  it("blocks in non-normal mode", () => {
    const plan = {
      id: "test", strategy: "rebalancer",
      opportunity: {
        id: "test", strategy: "rebalancer", trigger: "test",
        asset: "ZEPH", direction: "evm_to_native",
        expectedPnl: -5, urgency: "low" as const,
        context: { rrMode: "defensive" },
      },
      steps: [], estimatedCost: 5, estimatedDuration: 60000,
    };
    expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
  });
});
