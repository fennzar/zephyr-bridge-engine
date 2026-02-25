import type { GlobalState } from "@domain/state";
import type { InventorySnapshot } from "@domain/inventory/balances";
import type { ExecutionStep } from "@domain/execution/types";
import type { ExecutionMode } from "@domain/execution/types";

/**
 * Engine configuration passed to strategies.
 */
export interface EngineConfig {
  mode: ExecutionMode;
  manualApproval: boolean;
  strategies: string[];
  loopIntervalMs: number;
  minProfitUsd?: number;
  maxOperationsPerCycle?: number;
}

/**
 * Represents a detected opportunity that a strategy found.
 */
export interface StrategyOpportunity {
  /** Unique identifier for this opportunity */
  id: string;
  /** Which strategy detected this */
  strategy: string;
  /** Human-readable description of why this opportunity exists */
  trigger: string;
  /** Asset involved (ZEPH, ZSD, ZRS, ZYS) */
  asset?: string;
  /** Direction if applicable (evm_discount, evm_premium) */
  direction?: string;
  /** Expected P&L in USD (positive for profit, negative for cost) */
  expectedPnl: number;
  /** How urgent is this opportunity */
  urgency: "low" | "medium" | "high" | "critical";
  /** When this opportunity expires (if time-sensitive) */
  expiresAt?: Date;
  /** Additional context for the opportunity */
  context?: Record<string, unknown>;
}

/**
 * Result of evaluating a strategy against current market state.
 */
export interface StrategyEvaluation {
  /** List of opportunities found */
  opportunities: StrategyOpportunity[];
  /** Strategy-specific metrics for monitoring */
  metrics: Record<string, number>;
  /** Any warnings or notes */
  warnings?: string[];
}

/**
 * An executable plan built from an opportunity.
 */
export interface OperationPlan {
  /** Unique identifier for this plan */
  id: string;
  /** Which strategy created this */
  strategy: string;
  /** The opportunity this plan addresses */
  opportunity: StrategyOpportunity;
  /** Steps to execute */
  steps: ExecutionStep[];
  /** Estimated cost in USD (fees, gas, slippage) */
  estimatedCost: number;
  /** Estimated duration in milliseconds */
  estimatedDuration: number;
  /** RR at time of planning (for reference) */
  reserveRatio?: number;
  /** Spot/MA spread at time of planning */
  spotMaSpreadBps?: number;
}

/**
 * Strategy interface that all strategies must implement.
 */
export interface Strategy {
  /** Unique identifier for this strategy */
  id: string;
  /** Human-readable name */
  name: string;

  /**
   * Evaluate current market state for opportunities.
   */
  evaluate(state: GlobalState, inventory: InventorySnapshot): StrategyEvaluation | Promise<StrategyEvaluation>;

  /**
   * Build an executable plan for an opportunity.
   * Returns null if the plan cannot be built.
   */
  buildPlan(
    opportunity: StrategyOpportunity,
    state: GlobalState,
    inventory: InventorySnapshot
  ): Promise<OperationPlan | null>;

  /**
   * Determine if this plan should auto-execute without approval.
   */
  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean;
}

/**
 * RR-based strategy mode for adaptive behavior.
 */
export type RRMode = 
  | "normal"      // RR > 400%: Full operations available
  | "defensive"   // RR 200-400%: Limited minting, be careful
  | "crisis";     // RR < 200%: Extreme caution

/**
 * Determine the RR mode based on current reserve ratio.
 */
export function determineRRMode(reserveRatio: number): RRMode {
  if (reserveRatio >= 4) return "normal";
  if (reserveRatio >= 2) return "defensive";
  return "crisis";
}

/**
 * Calculate spot/MA spread in basis points.
 * Positive = spot > MA (price rose), Negative = spot < MA (price dropped)
 */
export function calculateSpotMaSpreadBps(spot: number, ma: number): number {
  if (ma === 0) return 0;
  return Math.round(((spot - ma) / ma) * 10000);
}

