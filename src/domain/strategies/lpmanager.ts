import { randomUUID } from "node:crypto";

import type { GlobalState } from "@domain/state";
import type { InventorySnapshot } from "@domain/inventory/balances";
import type { ExecutionStep, SwapContext } from "@domain/execution/types";
import type { Venue, OpType, AssetId } from "@domain/types";
import type { EvmPool } from "@domain/state/types";
import { prisma, PoolProtocol } from "@infra";

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

const log = createLogger("LPManager");

/**
 * LP position information.
 */
interface LPPosition {
  poolId: string;
  token0: string;
  token1: string;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
  feesEarned0: number;
  feesEarned1: number;
  valueUsd: number;
  positionTokenId?: string;
}

/**
 * LP range configuration based on RR mode.
 */
interface LPRangeConfig {
  /** Tighter range for normal conditions */
  normalRange: { lower: number; upper: number };
  /** Wider range for defensive mode */
  defensiveRange: { lower: number; upper: number };
  /** Very wide range for crisis mode */
  crisisRange: { lower: number; upper: number };
}

const DEFAULT_ZSD_RANGES: LPRangeConfig = {
  normalRange: { lower: 0.98, upper: 1.02 }, // ±2%
  defensiveRange: { lower: 0.90, upper: 1.05 }, // -10% to +5%
  crisisRange: { lower: 0.50, upper: 1.10 }, // -50% to +10%
};

const DEFAULT_ZEPH_RANGES: LPRangeConfig = {
  normalRange: { lower: 0.80, upper: 1.20 }, // ±20% from current price
  defensiveRange: { lower: 0.70, upper: 1.30 }, // ±30%
  crisisRange: { lower: 0.50, upper: 1.50 }, // ±50%
};

/**
 * LP Manager Strategy - Manages Uniswap V4 LP positions.
 * 
 * Responsibilities:
 * - Monitor LP positions for range status
 * - Detect when positions go out of range
 * - Recommend range adjustments based on RR mode
 * - Track fees earned and compound when appropriate
 * - Flag positions that need manual rebalancing
 * 
 * Future capabilities (with hooks):
 * - Dynamic fee adjustment based on RR
 * - Automated range repositioning
 */
export class LPManagerStrategy implements Strategy {
  id = "lp";
  name = "LP Position Manager";

  private zsdRanges: LPRangeConfig;
  private zephRanges: LPRangeConfig;

  constructor(
    zsdRanges?: Partial<LPRangeConfig>,
    zephRanges?: Partial<LPRangeConfig>,
  ) {
    this.zsdRanges = { ...DEFAULT_ZSD_RANGES, ...zsdRanges };
    this.zephRanges = { ...DEFAULT_ZEPH_RANGES, ...zephRanges };
  }

  async evaluate(state: GlobalState, inventory: InventorySnapshot): Promise<StrategyEvaluation> {
    const opportunities: StrategyOpportunity[] = [];
    const warnings: string[] = [];
    const metrics: Record<string, number> = {};

    const reserve = state.zephyr?.reserve;
    if (!reserve) {
      return { opportunities: [], metrics: {}, warnings: ["No reserve data available"] };
    }

    const rrMode = determineRRMode(reserve.reserveRatio);

    // Load LP positions from database
    const positions = await this.loadPositions(state);
    
    metrics.totalPositions = positions.length;
    metrics.inRangePositions = positions.filter(p => p.inRange).length;
    metrics.totalValueUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);
    metrics.totalFeesUsd = positions.reduce(
      (sum, p) => sum + p.feesEarned0 + p.feesEarned1, 
      0
    );

    // Check each position
    for (const position of positions) {
      const analysis = this.analyzePosition(position, state, rrMode);

      if (analysis.needsAction) {
        opportunities.push({
          id: `lp-${analysis.action}-${position.poolId.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
          strategy: this.id,
          trigger: analysis.trigger,
          asset: this.getPoolAsset(position),
          direction: analysis.action,
          expectedPnl: analysis.expectedPnl,
          urgency: analysis.urgency,
          context: {
            rrMode,
            poolId: position.poolId,
            action: analysis.action,
            currentRange: { lower: position.tickLower, upper: position.tickUpper },
            recommendedRange: analysis.recommendedRange,
            feesEarned: position.feesEarned0 + position.feesEarned1,
            positionTokenId: position.positionTokenId,
            liquidity: position.liquidity.toString(),
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
          },
        });
      }
    }

    // Add warnings for concerning conditions
    const outOfRange = positions.filter(p => !p.inRange);
    if (outOfRange.length > 0) {
      warnings.push(`${outOfRange.length} positions out of range`);
    }

    if (rrMode !== "normal") {
      warnings.push(`Consider adjusting LP ranges for ${rrMode} mode`);
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
    const { action, poolId, recommendedRange, currentRange, feesEarned,
      positionTokenId, liquidity, tickLower, tickUpper } = opportunity.context ?? {};

    if (!action || !poolId) {
      log.warn(`Missing context for ${opportunity.id}`);
      return null;
    }

    // Reconstruct minimal LPPosition for buildLPSteps metadata
    const position: LPPosition | undefined = positionTokenId != null ? {
      poolId: poolId as string,
      token0: "", token1: "",
      liquidity: BigInt(liquidity as string ?? "0"),
      tickLower: tickLower as number ?? 0,
      tickUpper: tickUpper as number ?? 0,
      inRange: true,
      feesEarned0: 0, feesEarned1: 0,
      valueUsd: 0,
      positionTokenId: positionTokenId as string,
    } : undefined;

    // Look up pool data for swapContext
    const pool = this.findPool(poolId as string, state);

    // Build LP management steps based on action
    const steps = this.buildLPSteps(
      action as string,
      poolId as string,
      opportunity.id,
      currentRange as { lower: number; upper: number } | undefined,
      recommendedRange as { lower: number; upper: number } | undefined,
      pool,
      position,
    );

    if (steps.length === 0) {
      log.warn(`Could not build steps for action: ${action}`);
      return null;
    }

    const reserve = state.zephyr?.reserve;

    return {
      id: opportunity.id,
      strategy: this.id,
      opportunity,
      steps,
      estimatedCost: this.estimateCost(action as string),
      estimatedDuration: this.estimateDuration(action as string),
      reserveRatio: reserve?.reserveRatio,
    };
  }

  /**
   * Build execution steps for LP operations.
   */
  private buildLPSteps(
    action: string,
    poolId: string,
    planId: string,
    currentRange?: { lower: number; upper: number },
    recommendedRange?: { lower: number; upper: number },
    pool?: EvmPool | null,
    position?: LPPosition,
  ): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepIndex = 0;

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const swapContext: SwapContext | undefined = pool?.address
      ? {
          poolAddress: pool.address,
          token0: pool.base,
          token1: pool.quote,
          fee: pool.feeBps, // Already in V4 fee units (e.g. 3000 = 0.30%)
          tickSpacing: pool.tickSpacing ?? 60,
          hooks: ZERO_ADDRESS,
        }
      : undefined;

    switch (action) {
      case "collect_fees":
        // Single step to collect fees
        steps.push({
          planStepId: `${planId}-collect-${stepIndex++}`,
          op: "lpCollect" as OpType,
          from: poolId as AssetId, // Pool ID as source
          to: poolId as AssetId,   // Same pool (fees go to wallet)
          amountIn: 0n,            // Collect all available fees
          venue: "evm" as Venue,
          swapContext,
          lpMetadata: {
            positionId: position?.positionTokenId,
            tickLower: position?.tickLower,
            tickUpper: position?.tickUpper,
          },
        });
        break;

      case "reposition":
      case "adjust_range":
        // Step 1: Remove all liquidity from current position
        steps.push({
          planStepId: `${planId}-burn-${stepIndex++}`,
          op: "lpBurn" as OpType,
          from: poolId as AssetId,
          to: poolId as AssetId,
          amountIn: 0n,
          venue: "evm" as Venue,
          swapContext,
          lpMetadata: {
            positionId: position?.positionTokenId,
            tickLower: position?.tickLower,
            tickUpper: position?.tickUpper,
            liquidityAmount: position?.liquidity,
          },
        });

        // Step 2: Add liquidity in new range
        steps.push({
          planStepId: `${planId}-mint-${stepIndex++}`,
          op: "lpMint" as OpType,
          from: poolId as AssetId,
          to: poolId as AssetId,
          amountIn: 0n, // Will use tokens received from burn
          venue: "evm" as Venue,
          swapContext,
          lpMetadata: recommendedRange ? {
            tickLower: Math.floor(Math.log(recommendedRange.lower) / Math.log(1.0001)),
            tickUpper: Math.floor(Math.log(recommendedRange.upper) / Math.log(1.0001)),
            slippageBps: 50, // 0.5%
          } : undefined,
        });
        break;

      case "add_liquidity":
        steps.push({
          planStepId: `${planId}-mint-${stepIndex++}`,
          op: "lpMint" as OpType,
          from: poolId as AssetId,
          to: poolId as AssetId,
          amountIn: 0n, // Amount determined by available inventory
          venue: "evm" as Venue,
          swapContext,
        });
        break;

      case "remove_liquidity":
        steps.push({
          planStepId: `${planId}-burn-${stepIndex++}`,
          op: "lpBurn" as OpType,
          from: poolId as AssetId,
          to: poolId as AssetId,
          amountIn: 0n, // Remove all
          venue: "evm" as Venue,
          swapContext,
          lpMetadata: {
            positionId: position?.positionTokenId,
            tickLower: position?.tickLower,
            tickUpper: position?.tickUpper,
            liquidityAmount: position?.liquidity,
          },
        });
        break;
    }

    return steps;
  }

  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean {
    if (config.manualApproval) return false;

    const action = plan.opportunity.context?.action as string | undefined;
    
    // Only auto-execute fee collection
    if (action === "collect_fees") {
      const feesEarned = (plan.opportunity.context?.feesEarned as number) ?? 0;
      return feesEarned > 10; // Only if fees > $10
    }

    // All other LP actions require manual approval
    return false;
  }

  // ============================================================
  // Private: Position Analysis
  // ============================================================

  private async loadPositions(state: GlobalState): Promise<LPPosition[]> {
    // Get owner address from environment
    const owner = process.env.EVM_WALLET_ADDRESS?.toLowerCase();
    if (!owner) {
      log.warn("No EVM_WALLET_ADDRESS configured");
      return [];
    }

    // Get current chain ID from environment or default to Sepolia
    const chainId = parseInt(process.env.CHAIN_ID ?? "11155111", 10);

    try {
      // Query positions from database
      const dbPositions = await prisma.position.findMany({
        where: {
          chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          owner: owner.toLowerCase(),
        },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
              states: {
                orderBy: { blockNumber: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      // Also check LPPosition table for app-level tracking
      const lpPositions = await prisma.lPPosition.findMany({
        where: {
          chainId,
          owner: owner.toLowerCase(),
          status: "active",
        },
      });

      // Convert to LPPosition interface
      const positions: LPPosition[] = [];

      for (const pos of dbPositions) {
        if (!pos.pool) continue;

        const latestState = pos.pool.states[0];
        const currentTick = latestState?.tick ?? 0;

        // Check if position is in range
        const inRange = currentTick >= pos.tickLower && currentTick < pos.tickUpper;

        // Get token symbols
        const token0Symbol = pos.pool.token0?.symbol ?? "Unknown";
        const token1Symbol = pos.pool.token1?.symbol ?? "Unknown";

        // Calculate value (rough estimate based on amounts)
        // In production, use proper price calculation
        const amount0 = pos.amount0 ? Number(pos.amount0) : 0;
        const amount1 = pos.amount1 ? Number(pos.amount1) : 0;
        const valueUsd = this.estimatePositionValue(
          token0Symbol,
          token1Symbol,
          amount0,
          amount1,
          state
        );

        // Extract tokenId from Position metadata JSON (set by the EVM watcher)
        const metadata = pos.metadata as Record<string, unknown> | null;
        const positionTokenId = metadata?.tokenId != null ? String(metadata.tokenId) : undefined;

        positions.push({
          poolId: pos.pool.address,
          token0: token0Symbol,
          token1: token1Symbol,
          liquidity: pos.liquidity ? BigInt(pos.liquidity.toFixed(0)) : 0n,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          inRange,
          feesEarned0: pos.fees0 ? Number(pos.fees0) : 0,
          feesEarned1: pos.fees1 ? Number(pos.fees1) : 0,
          valueUsd,
          positionTokenId,
        });
      }

      // Merge with app-level LP positions if they have additional data
      for (const lp of lpPositions) {
        const existing = positions.find((p) => p.poolId === lp.poolId);
        if (existing) {
          // Update with app-level data
          existing.feesEarned0 = lp.fees0Unclaimed
            ? Number(lp.fees0Unclaimed)
            : existing.feesEarned0;
          existing.feesEarned1 = lp.fees1Unclaimed
            ? Number(lp.fees1Unclaimed)
            : existing.feesEarned1;
        }
      }

      return positions;
    } catch (error) {
      log.error("Failed to load positions:", error);
      return [];
    }
  }

  /**
   * Estimate USD value of a position based on token amounts.
   */
  private estimatePositionValue(
    token0: string,
    token1: string,
    amount0: number,
    amount1: number,
    state: GlobalState
  ): number {
    let value = 0;

    // Get prices from state
    const reserve = state.zephyr?.reserve;

    // Helper to get token price
    const getPrice = (symbol: string): number => {
      if (symbol.includes("USDT") || symbol.includes("USDC")) return 1;
      if (symbol.includes("ZSD") || symbol.includes("WZSD")) return 1;
      if (symbol.includes("ZEPH") || symbol.includes("WZEPH")) {
        return reserve?.zephPriceUsd ?? 0;
      }
      if (symbol.includes("ZRS") || symbol.includes("WZRS")) {
        return reserve?.rates.zrs.spotUSD ?? 0;
      }
      if (symbol.includes("ZYS") || symbol.includes("WZYS")) {
        return reserve?.rates.zys.spotUSD ?? 1;
      }
      return 0;
    };

    value += amount0 * getPrice(token0);
    value += amount1 * getPrice(token1);

    return value;
  }

  private analyzePosition(
    position: LPPosition,
    state: GlobalState,
    rrMode: RRMode,
  ): {
    needsAction: boolean;
    action: string;
    trigger: string;
    urgency: "low" | "medium" | "high" | "critical";
    expectedPnl: number;
    recommendedRange?: { lower: number; upper: number };
  } {
    // Check if position is out of range
    if (!position.inRange) {
      return {
        needsAction: true,
        action: "reposition",
        trigger: `${position.token0}/${position.token1} position out of range`,
        urgency: "high",
        expectedPnl: 0, // Repositioning doesn't have direct PnL
        recommendedRange: this.getRecommendedRange(position, rrMode, state),
      };
    }

    // Check if fees are worth collecting
    const totalFees = position.feesEarned0 + position.feesEarned1;
    if (totalFees > 50) { // $50 threshold
      return {
        needsAction: true,
        action: "collect_fees",
        trigger: `$${totalFees.toFixed(2)} fees available to collect`,
        urgency: "low",
        expectedPnl: totalFees - 5, // Minus gas
      };
    }

    // Check if range should be adjusted for current RR mode
    const recommendedRange = this.getRecommendedRange(position, rrMode, state);
    const rangeNeedsAdjustment = this.shouldAdjustRange(position, recommendedRange);
    
    if (rangeNeedsAdjustment) {
      return {
        needsAction: true,
        action: "adjust_range",
        trigger: `Range adjustment recommended for ${rrMode} mode`,
        urgency: "medium",
        expectedPnl: 0,
        recommendedRange,
      };
    }

    return {
      needsAction: false,
      action: "none",
      trigger: "Position healthy",
      urgency: "low",
      expectedPnl: 0,
    };
  }

  private getPoolAsset(position: LPPosition): string {
    // Determine primary asset from pool tokens
    if (position.token0.includes("ZSD") || position.token1.includes("ZSD")) {
      return "ZSD";
    }
    if (position.token0.includes("ZEPH") || position.token1.includes("ZEPH")) {
      return "ZEPH";
    }
    if (position.token0.includes("ZRS") || position.token1.includes("ZRS")) {
      return "ZRS";
    }
    if (position.token0.includes("ZYS") || position.token1.includes("ZYS")) {
      return "ZYS";
    }
    return "Unknown";
  }

  private getRecommendedRange(
    position: LPPosition,
    rrMode: RRMode,
    state?: GlobalState,
  ): { lower: number; upper: number } {
    const asset = this.getPoolAsset(position);
    const config = asset === "ZSD" ? this.zsdRanges : this.zephRanges;

    let range: { lower: number; upper: number };
    switch (rrMode) {
      case "defensive":
        range = config.defensiveRange;
        break;
      case "crisis":
        range = config.crisisRange;
        break;
      default:
        range = config.normalRange;
    }

    // For non-ZSD pools, multiplier ranges are relative to current mid-price
    if (asset !== "ZSD") {
      const midTick = (position.tickLower + position.tickUpper) / 2;
      const currentPrice = Math.pow(1.0001, midTick);
      return { lower: currentPrice * range.lower, upper: currentPrice * range.upper };
    }

    return range;
  }

  private shouldAdjustRange(
    position: LPPosition,
    recommended: { lower: number; upper: number },
  ): boolean {
    // Convert ticks to prices: price = 1.0001^tick
    const currentLower = Math.pow(1.0001, position.tickLower);
    const currentUpper = Math.pow(1.0001, position.tickUpper);

    const RANGE_DRIFT_THRESHOLD = 0.10; // 10% drift triggers reposition

    // For ZSD (absolute prices near $1.00), compare directly
    // For ZEPH (relative offsets), compare proportionally
    const lowerDrift = recommended.lower !== 0
      ? Math.abs(currentLower - recommended.lower) / Math.abs(recommended.lower)
      : Math.abs(currentLower - recommended.lower);
    const upperDrift = recommended.upper !== 0
      ? Math.abs(currentUpper - recommended.upper) / Math.abs(recommended.upper)
      : Math.abs(currentUpper - recommended.upper);

    return lowerDrift > RANGE_DRIFT_THRESHOLD || upperDrift > RANGE_DRIFT_THRESHOLD;
  }

  private findPool(poolId: string, state: GlobalState): EvmPool | null {
    const pools = state.evm?.pools ?? {};
    // Try direct address match
    for (const pool of Object.values(pools)) {
      if (pool.address === poolId) return pool;
    }
    // Try key match
    if (pools[poolId]) return pools[poolId];
    return null;
  }

  private estimateCost(action: string): number {
    switch (action) {
      case "collect_fees":
        return 5; // Just gas
      case "reposition":
        return 20; // Remove + add liquidity
      case "add_liquidity":
        return 10;
      case "remove_liquidity":
        return 10;
      default:
        return 5;
    }
  }

  private estimateDuration(action: string): number {
    // All LP actions are on-chain, should be fast
    return 2 * 60 * 1000; // 2 minutes
  }
}

