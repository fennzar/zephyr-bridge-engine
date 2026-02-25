import { NextResponse } from "next/server";
import { buildGlobalState } from "@domain/state";
import { loadInventorySnapshot } from "@domain/inventory/balances";
import type { Strategy } from "@domain/strategies";
import {
  ArbitrageStrategy,
  PegKeeperStrategy,
  LPManagerStrategy,
  RebalancerStrategy,
} from "@domain/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/engine/evaluate
 * One-shot evaluation of current opportunities
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const strategies = (url.searchParams.get("strategies") ?? "arb").split(",");

    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    // Build state
    let globalState;
    try {
      globalState = await buildGlobalState();
    } catch (error) {
      return NextResponse.json({
        error: "Failed to build state",
        details: error instanceof Error ? error.message : "Unknown error",
      }, { status: 500 });
    }

    // Load inventory
    let inventory: Awaited<ReturnType<typeof loadInventorySnapshot>>;
    try {
      inventory = await loadInventorySnapshot();
    } catch (error) {
      errors.push(`Inventory load failed: ${error instanceof Error ? error.message : "Unknown"}`);
      // Return a minimal valid inventory snapshot
      inventory = {
        balances: {},
        totals: {},
        options: { includeEvm: false, includePaperMexc: false, includePaperZephyr: false },
      };
    }

    // Strategy registry
    const STRATEGY_REGISTRY: Record<string, () => Strategy> = {
      arb: () => new ArbitrageStrategy(),
      peg: () => new PegKeeperStrategy(),
      lp: () => new LPManagerStrategy(),
      rebalancer: () => new RebalancerStrategy(),
    };

    // Support "all" keyword
    const strategyIds = strategies.includes("all")
      ? Object.keys(STRATEGY_REGISTRY)
      : strategies;

    // Evaluate strategies
    for (const strategyId of strategyIds) {
      try {
        const factory = STRATEGY_REGISTRY[strategyId];
        if (!factory) {
          errors.push(`Unknown strategy: ${strategyId}`);
          continue;
        }
        const strategy = factory();
        results[strategyId] = await strategy.evaluate(globalState, inventory);
      } catch (error) {
        errors.push(`${strategyId}: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    // State summary
    const reserve = globalState.zephyr?.reserve;
    const stateInfo = reserve
      ? {
          reserveRatio: reserve.reserveRatio * 100,
          reserveRatioMa: reserve.reserveRatioMovingAverage * 100,
          zephPrice: reserve.zephPriceUsd,
          rrMode: reserve.reserveRatio >= 4 ? "normal" : reserve.reserveRatio >= 2 ? "defensive" : "crisis",
        }
      : null;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      state: stateInfo,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}

