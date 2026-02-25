import { randomUUID } from "node:crypto";

import type { GlobalState } from "@domain/state";
import type { InventorySnapshot } from "@domain/inventory/balances";
import type { ExecutionStep } from "@domain/execution/types";
import type { Venue, OpType, AssetId } from "@domain/types";

import { createLogger } from "@shared/logger";

import type {
  Strategy,
  StrategyEvaluation,
  StrategyOpportunity,
  OperationPlan,
  EngineConfig,
  RRMode,
} from "./types";
import { determineRRMode } from "./types";

const log = createLogger("Rebalancer");

/**
 * Target allocation for inventory rebalancing.
 * Values represent percentage of total value that should be in each venue.
 */
interface VenueAllocation {
  evm: number;
  native: number;
  cex: number;
}

/**
 * Rebalancing thresholds.
 */
interface RebalanceThresholds {
  /** Minimum deviation from target to trigger rebalance (percentage points) */
  minDeviationPct: number;
  /** Maximum single rebalance size as % of total venue balance */
  maxRebalancePct: number;
  /** Minimum USD value to trigger rebalance */
  minRebalanceUsd: number;
}

const DEFAULT_ALLOCATIONS: Record<string, VenueAllocation> = {
  ZEPH: { evm: 30, native: 50, cex: 20 },
  ZSD: { evm: 60, native: 30, cex: 10 },
  ZRS: { evm: 40, native: 60, cex: 0 },
  ZYS: { evm: 50, native: 50, cex: 0 },
  USDT: { evm: 70, native: 0, cex: 30 },
};

const DEFAULT_THRESHOLDS: RebalanceThresholds = {
  minDeviationPct: 10,
  maxRebalancePct: 25,
  minRebalanceUsd: 100,
};

/**
 * Rebalancer Strategy - Maintains target allocation across venues.
 * 
 * This strategy monitors inventory distribution and triggers rebalancing
 * when allocations drift too far from targets.
 * 
 * Use cases:
 * - Move funds from CEX to EVM to replenish LP
 * - Move funds from native to EVM after bridge operations
 * - Maintain operational float across venues
 */
export class RebalancerStrategy implements Strategy {
  id = "rebalance";
  name = "Inventory Rebalancer";

  private allocations: Record<string, VenueAllocation>;
  private thresholds: RebalanceThresholds;

  constructor(
    allocations?: Record<string, VenueAllocation>,
    thresholds?: Partial<RebalanceThresholds>,
  ) {
    this.allocations = allocations ?? DEFAULT_ALLOCATIONS;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  evaluate(state: GlobalState, inventory: InventorySnapshot): StrategyEvaluation {
    const opportunities: StrategyOpportunity[] = [];
    const warnings: string[] = [];
    const metrics: Record<string, number> = {};

    const reserve = state.zephyr?.reserve;
    if (!reserve) {
      return { opportunities: [], metrics: {}, warnings: ["No reserve data available"] };
    }

    const rrMode = determineRRMode(reserve.reserveRatio);

    // Analyze each asset's distribution
    for (const [asset, targetAlloc] of Object.entries(this.allocations)) {
      const analysis = this.analyzeAssetDistribution(asset, targetAlloc, inventory, state);
      
      metrics[`${asset}_evmPct`] = analysis.actual.evm;
      metrics[`${asset}_nativePct`] = analysis.actual.native;
      metrics[`${asset}_cexPct`] = analysis.actual.cex;

      if (analysis.needsRebalance) {
        opportunities.push({
          id: `rebalance-${asset}-${randomUUID().slice(0, 8)}`,
          strategy: this.id,
          trigger: analysis.trigger,
          asset,
          direction: analysis.direction,
          expectedPnl: -analysis.estimatedCost, // Rebalancing has costs, not profits
          urgency: this.determineUrgency(analysis.deviationPct, rrMode),
          context: {
            rrMode,
            fromVenue: analysis.fromVenue,
            toVenue: analysis.toVenue,
            amount: analysis.amount,
            deviationPct: analysis.deviationPct,
          },
        });
      }
    }

    return {
      opportunities,
      metrics,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async buildPlan(
    opportunity: StrategyOpportunity,
    state: GlobalState,
    inventory: InventorySnapshot,
  ): Promise<OperationPlan | null> {
    const { fromVenue, toVenue, amount } = opportunity.context ?? {};
    const asset = opportunity.asset;

    if (!fromVenue || !toVenue || !amount || !asset) {
      log.warn(`Missing context for ${opportunity.id}`);
      return null;
    }

    // Build steps based on venue transition
    const steps = this.buildRebalanceSteps(
      asset,
      fromVenue as string,
      toVenue as string,
      amount as number,
      opportunity.id,
      state
    );

    if (steps.length === 0) {
      log.warn(`Could not build steps for ${fromVenue} -> ${toVenue}`);
      return null;
    }

    return {
      id: opportunity.id,
      strategy: this.id,
      opportunity,
      steps,
      estimatedCost: Math.abs(opportunity.expectedPnl),
      estimatedDuration: this.estimateDuration(fromVenue as string, toVenue as string),
      reserveRatio: state.zephyr?.reserve?.reserveRatio,
    };
  }

  /**
   * Build execution steps for rebalancing between venues.
   */
  private buildRebalanceSteps(
    asset: string,
    fromVenue: string,
    toVenue: string,
    amountDecimal: number,
    planId: string,
    state: GlobalState,
  ): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepIndex = 0;

    // Convert decimal amount to atomic units (12 decimals for Zephyr assets, 6 for USDT)
    const decimals = asset === "USDT" ? 6 : 12;
    const amountIn = BigInt(Math.floor(amountDecimal * Math.pow(10, decimals)));

    // Determine asset IDs for each venue
    const getAssetId = (venue: string): AssetId => {
      const prefix = venue === "evm" && asset !== "USDT" && asset !== "ETH" ? "W" : "";
      const suffix = venue === "evm" ? ".e" : venue === "native" ? ".n" : ".x";
      return `${prefix}${asset}${suffix}` as AssetId;
    };

    const fromAsset = getAssetId(fromVenue);
    const toAsset = getAssetId(toVenue);

    // Direct venue transitions
    if (fromVenue === "evm" && toVenue === "native") {
      // EVM -> Native: unwrap
      steps.push({
        planStepId: `${planId}-unwrap-${stepIndex++}`,
        op: "unwrap" as OpType,
        from: fromAsset,
        to: toAsset,
        amountIn,
        venue: "evm" as Venue,
      });
    } else if (fromVenue === "native" && toVenue === "evm") {
      // Native -> EVM: wrap
      steps.push({
        planStepId: `${planId}-wrap-${stepIndex++}`,
        op: "wrap" as OpType,
        from: fromAsset,
        to: toAsset,
        amountIn,
        venue: "native" as Venue,
      });
    } else if (fromVenue === "evm" && toVenue === "cex") {
      // EVM -> CEX: unwrap to native, then deposit to CEX
      const nativeAsset = getAssetId("native");
      steps.push({
        planStepId: `${planId}-unwrap-${stepIndex++}`,
        op: "unwrap" as OpType,
        from: fromAsset,
        to: nativeAsset,
        amountIn,
        venue: "evm" as Venue,
      });
      steps.push({
        planStepId: `${planId}-deposit-${stepIndex++}`,
        op: "deposit" as OpType,
        from: nativeAsset,
        to: toAsset,
        amountIn,
        venue: "cex" as Venue,
      });
    } else if (fromVenue === "native" && toVenue === "cex") {
      // Native -> CEX: deposit
      steps.push({
        planStepId: `${planId}-deposit-${stepIndex++}`,
        op: "deposit" as OpType,
        from: fromAsset,
        to: toAsset,
        amountIn,
        venue: "cex" as Venue,
      });
    } else if (fromVenue === "cex" && toVenue === "native") {
      // CEX -> Native: withdraw
      steps.push({
        planStepId: `${planId}-withdraw-${stepIndex++}`,
        op: "withdraw" as OpType,
        from: fromAsset,
        to: toAsset,
        amountIn,
        venue: "cex" as Venue,
      });
    } else if (fromVenue === "cex" && toVenue === "evm") {
      // CEX -> EVM: withdraw to native, then wrap
      const nativeAsset = getAssetId("native");
      const evmAsset = getAssetId("evm");
      steps.push({
        planStepId: `${planId}-withdraw-${stepIndex++}`,
        op: "withdraw" as OpType,
        from: fromAsset,
        to: nativeAsset,
        amountIn,
        venue: "cex" as Venue,
      });
      steps.push({
        planStepId: `${planId}-wrap-${stepIndex++}`,
        op: "wrap" as OpType,
        from: nativeAsset,
        to: evmAsset,
        amountIn,
        venue: "native" as Venue,
      });
    }

    // Same-venue swap (e.g., USDT.e -> WZEPH.e on EVM)
    if (steps.length === 0 && fromVenue === toVenue) {
      if (fromVenue === "evm") {
        steps.push({
          planStepId: `${planId}-swap-${stepIndex++}`,
          op: "swapEVM" as OpType,
          from: fromAsset,
          to: toAsset,
          amountIn,
          venue: "evm" as Venue,
        });
      } else {
        log.warn(`Same-venue rebalance not supported for ${fromVenue}`);
      }
    }

    return steps;
  }

  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean {
    // Rebalancing is generally safe to auto-execute in normal mode
    if (config.manualApproval) return false;

    const rrMode = plan.opportunity.context?.rrMode as RRMode | undefined;
    
    // Only auto-execute in normal mode
    if (rrMode !== "normal") return false;

    // Don't auto-execute if cost is too high
    if (plan.estimatedCost > 50) return false;

    return true;
  }

  // ============================================================
  // Private: Analysis
  // ============================================================

  private analyzeAssetDistribution(
    asset: string,
    target: VenueAllocation,
    inventory: InventorySnapshot,
    state: GlobalState,
  ): {
    needsRebalance: boolean;
    trigger: string;
    direction: string;
    actual: VenueAllocation;
    deviationPct: number;
    fromVenue: string;
    toVenue: string;
    amount: number;
    estimatedCost: number;
  } {
    // Get balances for this asset across venues
    const evmBalance = this.getVenueBalance(asset, "evm", inventory);
    const nativeBalance = this.getVenueBalance(asset, "native", inventory);
    const cexBalance = this.getVenueBalance(asset, "cex", inventory);
    const total = evmBalance + nativeBalance + cexBalance;

    if (total === 0) {
      return {
        needsRebalance: false,
        trigger: `No ${asset} balance`,
        direction: "none",
        actual: { evm: 0, native: 0, cex: 0 },
        deviationPct: 0,
        fromVenue: "",
        toVenue: "",
        amount: 0,
        estimatedCost: 0,
      };
    }

    const actual: VenueAllocation = {
      evm: (evmBalance / total) * 100,
      native: (nativeBalance / total) * 100,
      cex: (cexBalance / total) * 100,
    };

    // Find the most over-allocated and most under-allocated venues
    const deviations = [
      { venue: "evm", deviation: actual.evm - target.evm, balance: evmBalance },
      { venue: "native", deviation: actual.native - target.native, balance: nativeBalance },
      { venue: "cex", deviation: actual.cex - target.cex, balance: cexBalance },
    ];

    const mostOver = deviations.reduce((a, b) => a.deviation > b.deviation ? a : b);
    const mostUnder = deviations.reduce((a, b) => a.deviation < b.deviation ? a : b);

    const needsRebalance = mostOver.deviation >= this.thresholds.minDeviationPct;

    // Move from over-allocated to under-allocated
    const fromVenue = mostOver.venue;
    const toVenue = mostUnder.venue;

    // Calculate amount to move (positive deviation = how much over-allocated)
    const deviationPct = mostOver.deviation;
    const movePercent = Math.min(deviationPct, this.thresholds.maxRebalancePct);
    const amount = (movePercent / 100) * total;

    // Estimate cost (bridge fees, gas, etc.)
    const estimatedCost = this.estimateRebalanceCost(asset, fromVenue, toVenue, amount, state);

    return {
      needsRebalance,
      trigger: `${asset}: ${fromVenue} over-allocated by ${deviationPct.toFixed(1)}%`,
      direction: `${fromVenue}_to_${toVenue}`,
      actual,
      deviationPct,
      fromVenue,
      toVenue,
      amount,
      estimatedCost,
    };
  }

  private getVenueBalance(asset: string, venue: string, inventory: InventorySnapshot): number {
    const suffix = venue === "evm" ? ".e" : venue === "native" ? ".n" : ".x";
    const prefix = venue === "evm" && asset !== "USDT" && asset !== "ETH" ? "W" : "";
    const assetId = `${prefix}${asset}${suffix}` as AssetId;
    return inventory.balances[assetId] ?? 0;
  }

  private estimateRebalanceCost(
    asset: string,
    fromVenue: string,
    toVenue: string,
    amount: number,
    state: GlobalState,
  ): number {
    let cost = 0;

    // Bridge fees if crossing EVM <-> Native
    if ((fromVenue === "evm" && toVenue === "native") || 
        (fromVenue === "native" && toVenue === "evm")) {
      // 1% unwrap fee for EVM -> Native
      if (fromVenue === "evm") {
        cost += amount * 0.01;
      }
      // Gas for wrap/unwrap
      cost += 5; // Rough gas estimate in USD
    }

    // CEX fees
    if (fromVenue === "cex" || toVenue === "cex") {
      // Withdrawal fee
      cost += 2; // Rough estimate
    }

    return cost;
  }

  private estimateDuration(fromVenue: string, toVenue: string): number {
    // Bridge operations take ~20 min each way
    if ((fromVenue === "evm" && toVenue === "native") || 
        (fromVenue === "native" && toVenue === "evm")) {
      return 20 * 60 * 1000;
    }
    
    // CEX deposits/withdrawals
    if (fromVenue === "cex" || toVenue === "cex") {
      return 40 * 60 * 1000;
    }

    return 5 * 60 * 1000;
  }

  private determineUrgency(
    deviationPct: number,
    rrMode: RRMode,
  ): "low" | "medium" | "high" | "critical" {
    if (deviationPct > 40) return "high";
    if (deviationPct > 25) return "medium";
    return "low";
  }
}

