import { buildGlobalState } from "@domain/state";
import { loadInventorySnapshot } from "@domain/inventory/balances";
import { 
  type Strategy, 
  type StrategyEvaluation,
  ArbitrageStrategy,
} from "@domain/strategies";

const STRATEGY_MAP: Record<string, () => Strategy> = {
  arb: () => new ArbitrageStrategy(),
  // rebalance: () => new RebalancerStrategy(),
  // peg: () => new PegKeeperStrategy(),
  // lp: () => new LPManagerStrategy(),
};

export interface EvaluationResult {
  timestamp: string;
  strategies: Record<string, StrategyEvaluation>;
  state: {
    reserveRatio: number;
    reserveRatioMa: number;
    zephPrice: number;
    rrMode: string;
  } | null;
  errors: string[];
}

export async function evaluateAll(strategyIds: string[]): Promise<EvaluationResult> {
  const errors: string[] = [];
  const strategies: Record<string, StrategyEvaluation> = {};

  // Build state
  let globalState;
  try {
    globalState = await buildGlobalState();
  } catch (error) {
    errors.push(`Failed to build state: ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      timestamp: new Date().toISOString(),
      strategies: {},
      state: null,
      errors,
    };
  }

  // Load inventory
  let inventory;
  try {
    inventory = await loadInventorySnapshot();
  } catch (error) {
    errors.push(`Failed to load inventory: ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      timestamp: new Date().toISOString(),
      strategies: {},
      state: null,
      errors,
    };
  }

  // Evaluate each strategy
  for (const strategyId of strategyIds) {
    const factory = STRATEGY_MAP[strategyId];
    if (!factory) {
      errors.push(`Unknown strategy: ${strategyId}`);
      continue;
    }

    try {
      const strategy = factory();
      const evaluation = await strategy.evaluate(globalState, inventory);
      strategies[strategyId] = evaluation;
    } catch (error) {
      errors.push(`Strategy ${strategyId} failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Build state summary
  const reserve = globalState.zephyr?.reserve;
  const stateInfo = reserve
    ? {
        reserveRatio: reserve.reserveRatio * 100,
        reserveRatioMa: reserve.reserveRatioMovingAverage * 100,
        zephPrice: reserve.zephPriceUsd,
        rrMode: reserve.reserveRatio >= 4 ? "normal" : reserve.reserveRatio >= 2 ? "defensive" : "crisis",
      }
    : null;

  return {
    timestamp: new Date().toISOString(),
    strategies,
    state: stateInfo,
    errors,
  };
}

