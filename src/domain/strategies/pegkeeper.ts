import { randomUUID } from "node:crypto";

import type { GlobalState } from "@domain/state";
import type { InventorySnapshot } from "@domain/inventory/balances";
import type { ExecutionStep, SwapContext } from "@domain/execution/types";
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
import { determineRRMode, calculateSpotMaSpreadBps } from "./types";

const log = createLogger("PegKeeper");

/**
 * Peg deviation thresholds in basis points.
 */
interface PegThresholds {
  /** Minimum deviation to trigger tidy-up (bps) */
  minDeviationBps: number;
  /** Maximum deviation before urgent action (bps) */
  urgentDeviationBps: number;
  /** Critical deviation (bps) */
  criticalDeviationBps: number;
}

const DEFAULT_THRESHOLDS: PegThresholds = {
  minDeviationBps: 30, // 0.3%
  urgentDeviationBps: 100, // 1%
  criticalDeviationBps: 300, // 3%
};

/**
 * Peg Keeper Strategy - Maintains ZSD peg to USDT.
 * 
 * This strategy monitors the WZSD/USDT pool and takes action when
 * the price deviates from $1.00 peg.
 * 
 * Actions:
 * - When ZSD > $1: Sell ZSD (wrap native ZSD, swap for USDT)
 * - When ZSD < $1: Buy ZSD (swap USDT for ZSD, potentially unwrap to native)
 * 
 * RR-aware behavior:
 * - In defensive mode: Widen acceptable range, accumulate ZSD at discount
 * - In crisis mode: Only buy ZSD at significant discount
 */
export class PegKeeperStrategy implements Strategy {
  id = "peg";
  name = "ZSD Peg Keeper";

  private thresholds: PegThresholds;

  constructor(thresholds?: Partial<PegThresholds>) {
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

    // Get WZSD/USDT pool price
    const zsdPriceUsd = this.getZsdPriceFromEvm(state);
    
    if (zsdPriceUsd === null) {
      return { 
        opportunities: [], 
        metrics: {}, 
        warnings: ["Cannot determine ZSD price from EVM pools"] 
      };
    }

    // Calculate deviation from $1.00 peg
    const deviationBps = Math.round((zsdPriceUsd - 1.0) * 10000);
    const absDeviation = Math.abs(deviationBps);

    metrics.zsdPriceUsd = zsdPriceUsd;
    metrics.deviationBps = deviationBps;
    metrics.reserveRatio = reserve.reserveRatio * 100;

    // Adjust thresholds based on RR mode
    const adjustedThresholds = this.getAdjustedThresholds(rrMode);

    // Check if deviation exceeds threshold
    if (absDeviation >= adjustedThresholds.minDeviationBps) {
      const direction = deviationBps > 0 ? "zsd_premium" : "zsd_discount";
      const urgency = this.determineUrgency(absDeviation, adjustedThresholds);

      // Calculate expected profit from restoring peg
      const clipSizeUsd = this.determineClipSize(absDeviation, rrMode);
      const expectedPnl = this.estimatePegProfit(deviationBps, clipSizeUsd, state);

      opportunities.push({
        id: `peg-${direction}-${randomUUID().slice(0, 8)}`,
        strategy: this.id,
        trigger: `ZSD ${direction === "zsd_premium" ? "above" : "below"} peg: $${zsdPriceUsd.toFixed(4)} (${deviationBps > 0 ? "+" : ""}${deviationBps}bps)`,
        asset: "ZSD",
        direction,
        expectedPnl,
        urgency,
        context: {
          rrMode,
          zsdPriceUsd,
          deviationBps,
          clipSizeUsd,
          reserveRatio: reserve.reserveRatio,
        },
      });
    }

    // Add warnings for concerning conditions
    if (rrMode === "defensive") {
      warnings.push(`RR in defensive mode - widened peg tolerance`);
    }
    if (rrMode === "crisis") {
      warnings.push(`RR in crisis mode - only buying ZSD at significant discount`);
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
    const { direction, clipSizeUsd } = opportunity.context ?? {};

    if (!direction || !clipSizeUsd) {
      log.warn(`Missing context for ${opportunity.id}`);
      return null;
    }

    // Build peg restoration steps based on direction
    const steps = this.buildPegSteps(
      direction as string,
      clipSizeUsd as number,
      opportunity.id,
      inventory,
      state
    );

    if (steps.length === 0) {
      log.warn(`Could not build steps for ${direction}`);
      return null;
    }

    const reserve = state.zephyr?.reserve;

    return {
      id: opportunity.id,
      strategy: this.id,
      opportunity,
      steps,
      estimatedCost: 5, // Rough gas/fee estimate
      estimatedDuration: this.estimateDuration(direction as string, steps),
      reserveRatio: reserve?.reserveRatio,
      spotMaSpreadBps: reserve
        ? calculateSpotMaSpreadBps(
            reserve.rates.zeph.spot,
            reserve.rates.zeph.movingAverage ?? reserve.rates.zeph.spot,
          )
        : undefined,
    };
  }

  /**
   * Build execution steps for peg restoration.
   */
  private buildPegSteps(
    direction: string,
    clipSizeUsd: number,
    planId: string,
    inventory: InventorySnapshot,
    state: GlobalState
  ): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepIndex = 0;

    if (direction === "zsd_premium") {
      // ZSD > $1: Sell ZSD for USDT
      // WZSD uses 12 decimals
      const zsdAmount = BigInt(Math.floor(clipSizeUsd * 1e12));

      // Check if we have native ZSD to wrap first
      const nativeZsdBalance = inventory.balances["ZSD.n"] ?? 0;
      const evmZsdBalance = inventory.balances["WZSD.e"] ?? 0;

      // If we have native ZSD, wrap it first
      if (nativeZsdBalance > evmZsdBalance && nativeZsdBalance > clipSizeUsd) {
        steps.push({
          planStepId: `${planId}-wrap-${stepIndex++}`,
          op: "wrap" as OpType,
          from: "ZSD.n" as AssetId,
          to: "WZSD.e" as AssetId,
          amountIn: zsdAmount,
          venue: "native" as Venue,
        });
      }

      // Swap WZSD -> USDT (input is WZSD.e = 12 decimals)
      steps.push({
        planStepId: `${planId}-swap-${stepIndex++}`,
        op: "swapEVM" as OpType,
        from: "WZSD.e" as AssetId,
        to: "USDT.e" as AssetId,
        amountIn: zsdAmount,
        venue: "evm" as Venue,
        swapContext: this.getSwapContext("WZSD.e" as AssetId, "USDT.e" as AssetId, state),
      });

    } else if (direction === "zsd_discount") {
      // ZSD < $1: Buy ZSD with USDT
      // USDT uses 6 decimals
      const usdtAmount = BigInt(Math.floor(clipSizeUsd * 1e6));

      // Swap USDT -> WZSD
      steps.push({
        planStepId: `${planId}-swap-${stepIndex++}`,
        op: "swapEVM" as OpType,
        from: "USDT.e" as AssetId,
        to: "WZSD.e" as AssetId,
        amountIn: usdtAmount,
        venue: "evm" as Venue,
        swapContext: this.getSwapContext("USDT.e" as AssetId, "WZSD.e" as AssetId, state),
      });
    }

    return steps;
  }

  /**
   * Look up swap context from GlobalState EVM pools.
   * Returns pool address and fee for paper mode; live mode would need contract addresses.
   */
  private getSwapContext(from: AssetId, to: AssetId, state: GlobalState): SwapContext | undefined {
    const pools = state.evm?.pools ?? {};
    for (const [, pool] of Object.entries(pools)) {
      if ((pool.base === from && pool.quote === to) || (pool.base === to && pool.quote === from)) {
        if (!pool.address) continue;
        return {
          poolAddress: pool.address,
          token0: pool.base,   // AssetId for now; live mode needs contract addresses
          token1: pool.quote,  // AssetId for now
          fee: pool.feeBps * 100, // feeBps -> Uniswap fee units
          tickSpacing: pool.tickSpacing ?? 60,
          hooks: "0x0000000000000000000000000000000000000000",
        };
      }
    }
    return undefined;
  }

  private estimateDuration(direction: string, steps?: ExecutionStep[]): number {
    // Base duration for EVM swaps
    let duration = 60 * 1000; // 1 minute

    // Add time for wrap/unwrap if present
    if (steps) {
      for (const step of steps) {
        if (step.op === "wrap" || step.op === "unwrap") {
          duration += 20 * 60 * 1000; // 20 minutes for bridge
        }
      }
    }

    return duration;
  }

  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean {
    if (config.manualApproval) return false;

    const rrMode = plan.opportunity.context?.rrMode as RRMode | undefined;
    const direction = plan.opportunity.direction;
    const absDeviation = Math.abs((plan.opportunity.context?.deviationBps as number) ?? 0);

    // In crisis mode, only auto-execute buys at significant discount
    if (rrMode === "crisis") {
      if (direction !== "zsd_discount") return false;
      if (absDeviation < 500) return false; // Need 5%+ discount
    }

    // In defensive mode, be more conservative
    if (rrMode === "defensive") {
      if (absDeviation < 100) return false;
    }

    // Don't auto-execute if expected loss
    if (plan.opportunity.expectedPnl < 0) return false;

    return true;
  }

  // ============================================================
  // Private: Helpers
  // ============================================================

  private getZsdPriceFromEvm(state: GlobalState): number | null {
    const pools = state.evm?.pools ?? {};
    
    // Look for WZSD/USDT pool
    for (const [key, pool] of Object.entries(pools)) {
      if (key.includes("WZSD") && key.includes("USDT")) {
        if (pool.base === "WZSD.e" && pool.quote === "USDT.e") {
          return pool.price ?? null;
        }
        if (pool.base === "USDT.e" && pool.quote === "WZSD.e") {
          return pool.price ? 1 / pool.price : null;
        }
      }
    }

    return null;
  }

  private getAdjustedThresholds(rrMode: RRMode): PegThresholds {
    switch (rrMode) {
      case "defensive":
        // Widen thresholds in defensive mode
        return {
          minDeviationBps: 100, // 1%
          urgentDeviationBps: 200, // 2%
          criticalDeviationBps: 500, // 5%
        };
      case "crisis":
        // Much wider thresholds in crisis
        return {
          minDeviationBps: 300, // 3%
          urgentDeviationBps: 500, // 5%
          criticalDeviationBps: 1000, // 10%
        };
      default:
        return this.thresholds;
    }
  }

  private determineUrgency(
    absDeviationBps: number,
    thresholds: PegThresholds,
  ): "low" | "medium" | "high" | "critical" {
    if (absDeviationBps >= thresholds.criticalDeviationBps) return "critical";
    if (absDeviationBps >= thresholds.urgentDeviationBps) return "high";
    if (absDeviationBps >= thresholds.minDeviationBps * 2) return "medium";
    return "low";
  }

  private determineClipSize(absDeviationBps: number, rrMode: RRMode): number {
    // Larger clips for larger deviations
    const baseClip = 500;
    
    if (absDeviationBps >= 200) return baseClip * 4; // $2000
    if (absDeviationBps >= 100) return baseClip * 2; // $1000
    return baseClip; // $500
  }

  private estimatePegProfit(
    deviationBps: number,
    clipSizeUsd: number,
    state: GlobalState,
  ): number {
    // Rough profit estimate: deviation * clip - fees
    const grossProfit = (Math.abs(deviationBps) / 10000) * clipSizeUsd;
    
    // Fees: ~0.03% swap + gas
    const fees = clipSizeUsd * 0.0003 + 2;
    
    return grossProfit - fees;
  }
}

