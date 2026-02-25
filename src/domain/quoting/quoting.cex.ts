import type { AssetId } from "@domain/types";
import type { GlobalState, CexMarketDepthLevel } from "@domain/state/types";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import { assetDecimals } from "@domain/assets/decimals";

import type { CexTradeImpact, OperationQuoteRequest, OperationQuoteResponse } from "./types";

const BPS_SCALE = 10_000;
const EPSILON = 1e-9;

function formatImpactNumber(value: number | null | undefined, digits = 8): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.[0-9]*[1-9])0+$/, "$1");
}

export function quoteCexTrade(
  request: OperationQuoteRequest,
  state: GlobalState,
  providedContext?: CexOperationContext | null,
): OperationQuoteResponse | null {
  if (request.op !== "tradeCEX") return null;

  const runtime = OP_RUNTIME.tradeCEX as OperationRuntime<CexOperationContext> | undefined;
  const runtimeEnabled = runtime?.enabled(request.from, request.to, state) ?? false;
  const context =
    providedContext && providedContext.direction === "tradeCEX"
      ? providedContext
      : runtime?.buildContext(request.from, request.to, state) ?? null;

  if (!context || context.direction !== "tradeCEX") {
    return buildUnavailableResponse(request, "CEX runtime currently unavailable");
  }

  const cexState = context.cex;
  if (!cexState) {
    return buildUnavailableResponse(request, "CEX state unavailable");
  }

  const market = context.market;
  if (!market.depth) {
    return buildUnavailableResponse(request, "Order book depth unavailable");
  }

  const fromDecimals = decimalsFor(request.from);
  const toDecimals = decimalsFor(request.to);
  const feeBps = Math.max(0, Math.min(BPS_SCALE, Math.floor(cexState.fees.takerBps ?? DEFAULT_TAKER_FEE_BPS)));
  const feeFactor = 1 - feeBps / BPS_SCALE;

  const amountInFloat = request.amountIn != null ? unitsToNumber(request.amountIn, fromDecimals) : null;
  const amountOutTargetFloat = request.amountOut != null ? unitsToNumber(request.amountOut, toDecimals) : null;

  if ((amountInFloat == null || amountInFloat <= 0) && (amountOutTargetFloat == null || amountOutTargetFloat <= 0)) {
    return buildUnavailableResponse(request, "amountIn or amountOut must be provided");
  }

  const result =
    context.tradeSide === "baseToQuote"
      ? simulateBaseToQuote(amountInFloat, amountOutTargetFloat, market.depth.bids)
      : simulateQuoteToBase(amountInFloat, amountOutTargetFloat, market.depth.asks);

  const warnings: string[] = [...result.warnings];

  const grossOutFloat = result.output;
  const netOutFloat = result.satisfied ? grossOutFloat * feeFactor : 0;
  const feeFloat = grossOutFloat - netOutFloat;

  const netOut = numberToUnits(netOutFloat, toDecimals);
  const grossOut = result.satisfied ? numberToUnits(grossOutFloat, toDecimals) : 0n;
  const feePaid = result.satisfied ? numberToUnits(Math.max(0, feeFloat), toDecimals) : 0n;
  const amountInUsed = result.satisfied ? numberToUnits(result.inputUsed, fromDecimals) : 0n;

  if (!result.satisfied) {
    warnings.push("Insufficient order-book depth for requested amount");
  }

  const normalizedRequest: OperationQuoteRequest = {
    ...request,
    amountIn: request.amountIn ?? (amountInUsed > 0n ? amountInUsed : undefined),
    amountOut: request.amountOut ?? (result.satisfied ? netOut : undefined),
  };

  const reasons: string[] = [];
  if (!runtimeEnabled) reasons.push("Runtime policy currently disables this trade");
  if (context.stale) reasons.push("Market data is stale");
  if (!result.satisfied) reasons.push("Insufficient order-book depth");

  const allowed = reasons.length === 0 && netOut > 0n;

  const priceBefore = result.topPriceBefore;
  const priceAfter = result.topPriceAfter;
  const averageFillPrice = (() => {
    if (context.tradeSide === "baseToQuote") {
      return result.baseUsed && result.baseUsed > EPSILON ? (result.quoteOut ?? 0) / result.baseUsed : null;
    }
    return result.output > EPSILON ? result.inputUsed / result.output : null;
  })();
  const priceImpactBps = priceBefore != null && averageFillPrice != null && priceBefore > 0
    ? ((averageFillPrice / priceBefore) - 1) * BPS_SCALE
    : null;

  const grossNotional = context.tradeSide === "baseToQuote"
    ? grossOutFloat
    : result.inputUsed;
  const netNotional = context.tradeSide === "baseToQuote" ? netOutFloat : null;
  const feeNotional = context.tradeSide === "baseToQuote" ? feeFloat : null;

  const tradeSide: "buy" | "sell" = context.tradeSide === "baseToQuote" ? "sell" : "buy";

  const cexImpact: CexTradeImpact = {
    market: context.marketSymbol,
    side: tradeSide,
    priceBefore: formatImpactNumber(priceBefore, 8),
    priceAfter: formatImpactNumber(priceAfter, 8),
    priceImpactBps,
    averageFillPrice: formatImpactNumber(averageFillPrice, 8),
    grossNotional: formatImpactNumber(grossNotional, 8),
    netNotional: formatImpactNumber(netNotional, 8),
    feeNotional: formatImpactNumber(feeNotional, 8),
    depthLevelsUsed: result.levelsUsed,
    warnings: warnings.length > 0 ? warnings.slice() : undefined,
  };

  if (cexImpact.warnings) {
    const unique = Array.from(new Set(cexImpact.warnings));
    cexImpact.warnings = unique;
    warnings.length = 0;
    warnings.push(...unique);
  }

  return {
    request: normalizedRequest,
    grossAmountOut: grossOut,
    amountOut: netOut,
    feePaid,
    feeAsset: "to",
    warnings: warnings.length > 0 ? warnings : undefined,
    policy: {
      cex: {
        allowed,
        reasons: reasons.length > 0 ? reasons : undefined,
      },
    },
    cexImpact,
  };
}

const DEFAULT_TAKER_FEE_BPS = 20;

function decimalsFor(asset: AssetId): number {
  return assetDecimals(asset);
}

function unitsToNumber(amount: bigint, decimals: number): number {
  if (amount === 0n) return 0;
  const scale = Math.pow(10, decimals);
  return Number(amount) / scale;
}

function numberToUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const scale = Math.pow(10, decimals);
  return BigInt(Math.round(value * scale));
}

type SimulationResult = {
  inputUsed: number;
  output: number;
  satisfied: boolean;
  warnings: string[];
  baseUsed?: number;
  quoteOut?: number;
  quoteSpent?: number;
  baseReceived?: number;
  topPriceBefore: number | null;
  topPriceAfter: number | null;
  levelsUsed: number;
};

function simulateBaseToQuote(
  amountBase: number | null,
  targetQuote: number | null,
  bids: CexMarketDepthLevel[],
): SimulationResult {
  const sorted = [...bids].sort((a, b) => b.price - a.price);
  const levels = sorted.filter((level) => level.price > 0 && level.amount > 0);
  const topPriceBefore = levels.length > 0 ? levels[0].price : null;
  let remainingBase = amountBase ?? 0;
  let remainingQuote = targetQuote ?? 0;
  let baseUsed = 0;
  let quoteOut = 0;
  const warnings: string[] = [];
  let levelsUsed = 0;
  let topPriceAfter = topPriceBefore;

  if (levels.length === 0) {
    warnings.push("Order book empty");
    return {
      inputUsed: 0,
      output: 0,
      satisfied: false,
      warnings,
      topPriceBefore,
      topPriceAfter: null,
      levelsUsed: 0,
    };
  }

  if (amountBase != null && amountBase > 0) {
    let need = amountBase;
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      const fill = Math.min(need, level.amount);
      if (fill <= EPSILON) continue;
      levelsUsed += 1;
      baseUsed += fill;
      quoteOut += fill * level.price;
      need -= fill;
      const remaining = level.amount - fill;
      if (remaining > EPSILON) {
        topPriceAfter = level.price;
        need = 0;
        break;
      } else if (need <= EPSILON) {
        const nextLevel = levels.slice(i + 1).find((entry) => entry.price > 0 && entry.amount > EPSILON);
        topPriceAfter = nextLevel?.price ?? null;
        need = 0;
        break;
      }
    }
    remainingBase = Math.max(0, need);
  } else if (targetQuote != null && targetQuote > 0) {
    let need = targetQuote;
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      if (level.amount <= 0) continue;
      const levelQuote = level.amount * level.price;
      if (levelQuote >= need - EPSILON) {
        const baseRequired = need / level.price;
        if (baseRequired > EPSILON) levelsUsed += 1;
        baseUsed += baseRequired;
        quoteOut += need;
        need = 0;
        const remainingBase = level.amount - baseRequired;
        topPriceAfter = remainingBase > EPSILON ? level.price : levels.slice(i + 1).find((entry) => entry.price > 0 && entry.amount > EPSILON)?.price ?? null;
        break;
      } else {
        levelsUsed += 1;
        baseUsed += level.amount;
        quoteOut += levelQuote;
        need -= levelQuote;
      }
    }
    remainingQuote = Math.max(0, need);
  } else {
    warnings.push("amountIn or amountOut must be positive");
    return {
      inputUsed: 0,
      output: 0,
      satisfied: false,
      warnings,
      baseUsed: 0,
      quoteOut: 0,
      topPriceBefore,
      topPriceAfter: topPriceBefore,
      levelsUsed: 0,
    };
  }

  const satisfied =
    (amountBase != null && remainingBase <= EPSILON) ||
    (targetQuote != null && remainingQuote <= EPSILON);

  return {
    inputUsed: baseUsed,
    output: quoteOut,
    satisfied,
    warnings,
      baseUsed,
      quoteOut,
      topPriceBefore,
      topPriceAfter: topPriceAfter ?? null,
      levelsUsed,
  };
}

function simulateQuoteToBase(
  amountQuote: number | null,
  targetBase: number | null,
  asks: CexMarketDepthLevel[],
): SimulationResult {
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  const levels = sorted.filter((level) => level.price > 0 && level.amount > 0);
  const topPriceBefore = levels.length > 0 ? levels[0].price : null;
  let remainingQuote = amountQuote ?? 0;
  let remainingBaseTarget = targetBase ?? 0;
  let quoteSpent = 0;
  let baseReceived = 0;
  const warnings: string[] = [];
  let levelsUsed = 0;
  let topPriceAfter = topPriceBefore;

  if (levels.length === 0) {
    warnings.push("Order book empty");
    return {
      inputUsed: 0,
      output: 0,
      satisfied: false,
      warnings,
      quoteSpent: 0,
      baseReceived: 0,
      topPriceBefore,
      topPriceAfter: null,
      levelsUsed: 0,
    };
  }

  if (amountQuote != null && amountQuote > 0) {
    let need = amountQuote;
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      if (level.amount <= 0) continue;
      const levelCost = level.amount * level.price;
      if (levelCost >= need - EPSILON) {
        const baseAcquired = need / level.price;
        if (baseAcquired > EPSILON) levelsUsed += 1;
        baseReceived += baseAcquired;
        quoteSpent += need;
        need = 0;
        const remainingAmount = level.amount - baseAcquired;
        topPriceAfter = remainingAmount > EPSILON ? level.price : levels.slice(i + 1).find((entry) => entry.price > 0 && entry.amount > EPSILON)?.price ?? null;
        break;
      } else {
        levelsUsed += 1;
        baseReceived += level.amount;
        quoteSpent += levelCost;
        need -= levelCost;
      }
    }
    remainingQuote = Math.max(0, need);
  } else if (targetBase != null && targetBase > 0) {
    let need = targetBase;
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      if (level.amount <= 0) continue;
      if (level.amount >= need - EPSILON) {
        levelsUsed += 1;
        quoteSpent += need * level.price;
        baseReceived += need;
        need = 0;
        const remainingAmount = level.amount - need;
        topPriceAfter = remainingAmount > EPSILON ? level.price : levels.slice(i + 1).find((entry) => entry.price > 0 && entry.amount > EPSILON)?.price ?? null;
        break;
      } else {
        levelsUsed += 1;
        baseReceived += level.amount;
        quoteSpent += level.amount * level.price;
        need -= level.amount;
      }
    }
    remainingBaseTarget = Math.max(0, need);
  } else {
    warnings.push("amountIn or amountOut must be positive");
    return {
      inputUsed: 0,
      output: 0,
      satisfied: false,
      warnings,
      quoteSpent: 0,
      baseReceived: 0,
      topPriceBefore,
      topPriceAfter: topPriceBefore,
      levelsUsed: 0,
    };
  }

  const satisfied =
    (amountQuote != null && remainingQuote <= EPSILON) ||
    (targetBase != null && remainingBaseTarget <= EPSILON);

  return {
    inputUsed: quoteSpent,
    output: baseReceived,
    satisfied,
    warnings,
    quoteSpent,
    baseReceived,
    topPriceBefore,
    topPriceAfter: topPriceAfter ?? null,
    levelsUsed,
  };
}

function buildUnavailableResponse(request: OperationQuoteRequest, reason: string): OperationQuoteResponse {
  return {
    request: { ...request },
    amountOut: 0n,
    grossAmountOut: 0n,
    warnings: [reason],
    policy: {
      cex: {
        allowed: false,
        reasons: [reason],
      },
    },
  };
}
