import type { GlobalState } from "@domain/state";
import type { InventorySnapshot } from "@domain/inventory/balances";
import { ARB_DEFS } from "@domain/arbitrage/routing";
import { analyzeArbMarkets, type ArbMarketAnalysis } from "@domain/arbitrage/analysis";

import { createLogger } from "@shared/logger";

const log = createLogger("arbitrage");

import type {
  Strategy,
  StrategyEvaluation,
  StrategyOpportunity,
  OperationPlan,
  EngineConfig,
} from "./types";
import { determineRRMode, calculateSpotMaSpreadBps, type RRMode } from "./types";

import { analyzeLeg, determineUrgency } from "./arbitrage.analysis";
import { buildExecutionSteps, estimateDuration } from "./arbitrage.execution";
import { checkSpotMaSpread, shouldAutoExecuteForRRMode } from "./arbitrage.approval";

// Re-export extracted functions so external consumers can still import from this module
export { analyzeLeg, estimateFees, isNativeCloseAvailable, determineUrgency } from "./arbitrage.analysis";
export type { LegAnalysis } from "./arbitrage.analysis";
export {
  estimateSwapOutput,
  buildExecutionSteps as buildArbExecutionSteps,
  getStepPrice,
  lookupSwapContext,
  getVenueForOp,
  estimateDuration,
} from "./arbitrage.execution";
export { checkSpotMaSpread, shouldAutoExecuteForRRMode } from "./arbitrage.approval";

/**
 * Arbitrage strategy - detects price gaps between venues and builds arb plans.
 */
export class ArbitrageStrategy implements Strategy {
  id = "arb";
  name = "Arbitrage";

  evaluate(state: GlobalState, _inventory: InventorySnapshot): StrategyEvaluation {
    const opportunities: StrategyOpportunity[] = [];
    const warnings: string[] = [];

    const reserve = state.zephyr?.reserve;
    if (!reserve) {
      return { opportunities: [], metrics: {}, warnings: ["No reserve data available"] };
    }

    const rrMode = determineRRMode(reserve.reserveRatio);
    const zephSpotMaSpread = calculateSpotMaSpreadBps(
      reserve.rates.zeph.spot,
      reserve.rates.zeph.movingAverage ?? reserve.rates.zeph.spot
    );

    // Use the existing market analysis to detect opportunities
    const marketAnalysis = analyzeArbMarkets(state);
    const marketByAsset = new Map<string, ArbMarketAnalysis>(
      marketAnalysis.map((m) => [m.asset, m])
    );

    // Check each arb definition for opportunities
    for (const leg of ARB_DEFS) {
      const market = marketByAsset.get(leg.asset);
      const analysis = analyzeLeg(leg, state, rrMode, market);

      if (analysis.hasOpportunity) {
        opportunities.push({
          id: `${leg.asset}-${leg.direction}`,
          strategy: this.id,
          trigger: analysis.trigger,
          asset: leg.asset,
          direction: leg.direction,
          expectedPnl: analysis.estimatedPnl,
          urgency: determineUrgency(analysis.estimatedPnl, rrMode),
          context: {
            reserveRatio: reserve.reserveRatio,
            rrMode,
            gapBps: analysis.gapBps,
            dexPriceUsd: market?.pricing.dex.priceUsd,
            referencePriceUsd: market?.reference.priceUsd,
            nativeCloseAvailable: analysis.nativeCloseAvailable,
            cexCloseAvailable: analysis.cexCloseAvailable,
          },
        });
      }
    }

    // Add warnings based on RR mode
    if (rrMode === "defensive") {
      warnings.push(`RR in defensive mode (${(reserve.reserveRatio * 100).toFixed(0)}%) - some operations limited`);
    } else if (rrMode === "crisis") {
      warnings.push(`RR in crisis mode (${(reserve.reserveRatio * 100).toFixed(0)}%) - extreme caution advised`);
    }

    if (Math.abs(zephSpotMaSpread) > 500) {
      warnings.push(`Large spot/MA spread: ${zephSpotMaSpread}bps - check pricing before execution`);
    }

    // Add market gaps to metrics
    const gapMetrics: Record<string, number> = {};
    for (const market of marketAnalysis) {
      if (market.gapBps != null) {
        gapMetrics[`${market.asset}_gapBps`] = market.gapBps;
      }
    }

    return {
      opportunities,
      metrics: {
        totalLegsChecked: ARB_DEFS.length,
        opportunitiesFound: opportunities.length,
        reserveRatio: reserve.reserveRatio * 100,
        spotMaSpreadBps: zephSpotMaSpread,
        ...gapMetrics,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  // Default clip sizes per asset (in USD value)
  private static readonly DEFAULT_CLIP_USD: Record<string, number> = {
    ZEPH: 500,
    ZSD: 1000,
    ZRS: 250,
    ZYS: 500,
  };

  async buildPlan(
    opportunity: StrategyOpportunity,
    state: GlobalState,
    _inventory: InventorySnapshot
  ): Promise<OperationPlan | null> {
    // Find the matching arb leg
    const leg = ARB_DEFS.find(
      (l) => l.asset === opportunity.asset && l.direction === opportunity.direction
    );

    if (!leg) {
      log.warn(`Could not find leg for ${opportunity.asset}/${opportunity.direction}`);
      return null;
    }

    const reserve = state.zephyr?.reserve;
    const reserveRatio = reserve?.reserveRatio ?? 0;
    const spotMaSpreadBps = reserve
      ? calculateSpotMaSpreadBps(
          reserve.rates.zeph.spot,
          reserve.rates.zeph.movingAverage ?? reserve.rates.zeph.spot
        )
      : 0;

    // Determine which close path to use
    const nativeCloseAvailable = opportunity.context?.nativeCloseAvailable as boolean;

    // Prefer native close, fall back to CEX
    const closeFlavor: "native" | "cex" = nativeCloseAvailable ? "native" : "cex";
    const closeSteps = closeFlavor === "native"
      ? leg.close.native
      : leg.close.cex ?? leg.close.native;

    // Calculate clip size based on asset and prices
    const clipUsd = ArbitrageStrategy.DEFAULT_CLIP_USD[leg.asset] ?? 500;
    const clipAmount = this.calculateClipAmount(leg.asset, clipUsd, state);

    // Build execution steps from leg
    const steps = buildExecutionSteps(leg, closeSteps, opportunity.id, clipAmount, state);

    // Estimate duration based on steps
    const estimatedDurationMs = estimateDuration(steps);

    return {
      id: opportunity.id,
      strategy: this.id,
      opportunity,
      steps,
      estimatedCost: opportunity.expectedPnl < 0 ? Math.abs(opportunity.expectedPnl) : 10,
      estimatedDuration: estimatedDurationMs,
      reserveRatio,
      spotMaSpreadBps,
    };
  }

  /**
   * Calculate clip amount in atomic units based on USD value.
   */
  private calculateClipAmount(asset: string, usdValue: number, state: GlobalState): bigint {
    const reserve = state.zephyr?.reserve;
    if (!reserve) return 0n;

    // Get price for the asset
    let priceUsd: number;
    switch (asset) {
      case "ZEPH":
        priceUsd = reserve.zephPriceUsd;
        break;
      case "ZSD":
        priceUsd = 1.0; // Stablecoin
        break;
      case "ZRS":
        priceUsd = reserve.rates.zrs.spotUSD ?? reserve.rates.zrs.spot * reserve.zephPriceUsd;
        break;
      case "ZYS":
        priceUsd = reserve.rates.zys.spotUSD ?? reserve.rates.zys.spot;
        break;
      default:
        priceUsd = 1.0;
    }

    // Calculate amount (12 decimal places for Zephyr assets)
    const amount = (usdValue / priceUsd) * 1e12;
    return BigInt(Math.floor(amount));
  }

  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean {
    if (config.manualApproval) return false;

    const minProfit = config.minProfitUsd ?? 1.0;
    if (plan.opportunity.expectedPnl < minProfit) return false;

    // Check spot/MA spread - if too wide, require manual approval
    const spreadCheck = checkSpotMaSpread(plan);
    if (!spreadCheck.ok) {
      log.info(spreadCheck.reason);
      return false;
    }

    const rrMode = plan.opportunity.context?.rrMode as RRMode | undefined;
    const asset = plan.opportunity.asset;

    // Apply RR mode-aware behavior per asset
    return shouldAutoExecuteForRRMode(asset, rrMode, plan);
  }
}
