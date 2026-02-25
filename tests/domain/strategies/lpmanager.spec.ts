import { describe, it, expect } from "vitest";
import { LPManagerStrategy } from "@domain/strategies/lpmanager";
import { buildTestConfig } from "../../support/factories";
import type { OperationPlan, StrategyOpportunity } from "@domain/strategies/types";

const strategy = new LPManagerStrategy();
const config = buildTestConfig();

function buildLPPlan(action: string, feesEarned: number): OperationPlan {
  const opportunity: StrategyOpportunity = {
    id: "test", strategy: "lp", trigger: "test",
    asset: "ZSD", direction: action,
    expectedPnl: feesEarned - 5, urgency: "low",
    context: { action, feesEarned },
  };
  return {
    id: "test", strategy: "lp", opportunity,
    steps: [], estimatedCost: 5, estimatedDuration: 120000,
  };
}

describe("LPManagerStrategy.shouldAutoExecute()", () => {
  it("auto-executes collect_fees when fees > $10", () => {
    const plan = buildLPPlan("collect_fees", 15);
    expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
  });

  it("blocks collect_fees when fees <= $10", () => {
    const plan = buildLPPlan("collect_fees", 8);
    expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
  });

  it("blocks reposition (manual only)", () => {
    const plan = buildLPPlan("reposition", 100);
    expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
  });

  it("blocks add_liquidity (manual only)", () => {
    const plan = buildLPPlan("add_liquidity", 100);
    expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
  });

  it("blocks when manualApproval is true", () => {
    const plan = buildLPPlan("collect_fees", 50);
    expect(strategy.shouldAutoExecute(plan, buildTestConfig({ manualApproval: true }))).toBe(false);
  });
});
