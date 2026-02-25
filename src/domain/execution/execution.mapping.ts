import type { AssetId, OpType, Venue } from "@domain/types";
import type { ArbPlanStep, ArbPlanStage } from "@domain/arbitrage/types.plan";

import type {
  ExecutionStep,
  ExecutionStepResult,
  ExecutionSummary,
  VenueExecutors,
} from "./types";

/**
 * Convert an ArbPlanStep into an ExecutionStep.
 * Returns null if the plan step has no actionable path.
 */
export function planStepToExecutionStep(
  planStep: ArbPlanStep,
  _stage: ArbPlanStage,
): ExecutionStep | null {
  // Extract the operation from the plan step
  const path = planStep.path;
  if (!path || path.hops.length === 0) return null;

  // Use the first hop as the primary operation
  const hop = path.hops[0];
  if (!hop) return null;

  return {
    planStepId: planStep.id,
    op: hop.op,
    from: hop.from,
    to: hop.to,
    amountIn: planStep.amountIn ?? hop.amountIn ?? 0n,
    venue: getVenueForOp(hop.op),
    expectedAmountOut: hop.amountOut ?? undefined,
  };
}

/**
 * Get the venue responsible for a given operation type.
 */
export function getVenueForOp(op: OpType): Venue {
  switch (op) {
    case "swapEVM":
    case "wrap":
    case "unwrap":
      return "evm";
    case "nativeMint":
    case "nativeRedeem":
      return "native";
    case "tradeCEX":
    case "deposit":
    case "withdraw":
      return "cex";
    default:
      return "evm";
  }
}

/**
 * Determine the trading symbol (e.g., "ZEPHUSDT") for a CEX trade.
 */
export function getTradeSymbol(from: AssetId, to: AssetId): string {
  if (from === "ZEPH.x" && to === "USDT.x") return "ZEPHUSDT";
  if (from === "USDT.x" && to === "ZEPH.x") return "ZEPHUSDT";
  throw new Error(`Unknown trading pair: ${from} -> ${to}`);
}

/**
 * Determine the trade side (BUY or SELL) for a CEX trade.
 */
export function getTradeSide(from: AssetId, to: AssetId): "BUY" | "SELL" {
  if (from === "USDT.x" && to === "ZEPH.x") return "BUY";
  if (from === "ZEPH.x" && to === "USDT.x") return "SELL";
  throw new Error(`Unknown trading direction: ${from} -> ${to}`);
}

/**
 * Get the withdrawal destination address based on the target asset suffix.
 */
export async function getWithdrawDestination(to: AssetId, executors: VenueExecutors): Promise<string> {
  if (to.endsWith(".n")) {
    return executors.zephyr.getAddress();
  }
  if (to.endsWith(".e")) {
    return executors.evm.address;
  }
  throw new Error(`Unknown withdrawal destination type: ${to}`);
}

/**
 * Build an execution summary from step results.
 */
export function buildSummary(results: ExecutionStepResult[]): ExecutionSummary {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let totalDurationMs = 0;
  let totalGasUsed = 0n;
  const netChanges: Partial<Record<AssetId, bigint>> = {};

  for (const result of results) {
    totalDurationMs += result.durationMs;

    switch (result.status) {
      case "success":
        succeeded++;
        break;
      case "failed":
        failed++;
        break;
      case "skipped":
        skipped++;
        break;
    }

    if (result.gasUsed) {
      totalGasUsed += result.gasUsed;
    }

    // Track net asset changes
    if (result.status === "success") {
      const fromAsset = result.step.from;
      const toAsset = result.step.to;
      const amountIn = result.step.amountIn;
      const amountOut = result.amountOut ?? 0n;

      netChanges[fromAsset] = (netChanges[fromAsset] ?? 0n) - amountIn;
      netChanges[toAsset] = (netChanges[toAsset] ?? 0n) + amountOut;
    }
  }

  return {
    succeeded,
    failed,
    skipped,
    totalDurationMs,
    totalGasUsed: totalGasUsed > 0n ? totalGasUsed : undefined,
    netAssetChanges: Object.keys(netChanges).length > 0 ? netChanges : undefined,
  };
}
