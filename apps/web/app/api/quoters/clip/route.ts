import { NextResponse } from "next/server";

import { buildGlobalState } from "@domain/state/state.builder";
import { ARB_DEFS, type ArbLegs } from "@domain/arbitrage/routing";
import { buildClipScenario } from "@domain/arbitrage/clip";
import type { ClipEstimate, ClipOption, ClipExecutionVariant } from "@domain/arbitrage/clip.types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assetParam = url.searchParams.get("asset") ?? "ZEPH";
  const normalizedAsset = normalizeAssetSymbol(assetParam);
  const directionParam = url.searchParams.get("direction") ?? "evm_discount";
  const amountParam = url.searchParams.get("amount");

  const leg = ARB_DEFS.find((entry) => entry.asset === normalizedAsset && entry.direction === directionParam);
  if (!leg) {
    return NextResponse.json({ error: "Unknown arb leg" }, { status: 400 });
  }

  let amountOverride: bigint | undefined;
  if (amountParam) {
    try {
      amountOverride = BigInt(amountParam);
    } catch {
      return NextResponse.json({ error: "Invalid amount override" }, { status: 400 });
    }
  }

  const state = await buildGlobalState();
  const scenario = await buildClipScenario(leg, state, { amountOverride });
  if (!scenario) {
    return NextResponse.json({ error: "Unable to estimate clip for provided leg" }, { status: 422 });
  }

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      asset: leg.asset,
      direction: leg.direction,
      pool: scenario.pool ? serializeValue(scenario.pool) : null,
      zephSpotUsd: state.zephyr?.reserve?.rates.zeph?.spot ?? null,
      options: scenario.options.map((option) => serializeOption(option)),
    },
    { status: 200 },
  );
}

function normalizeAssetSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("WZ") && upper.length > 2) {
    return upper.slice(1);
  }
  return upper;
}

function serializeClip(clip: ClipEstimate) {
  return {
    asset: clip.asset,
    amount: clip.amount.toString(),
    amountDecimal: clip.amountDecimal,
    amountUsd: clip.amountUsd,
  };
}

function serializeOption(option: ClipOption) {
  return {
    flavor: option.flavor,
    clip: serializeClip(option.clip),
    open: {
      candidate: serializeValue(option.open.candidate),
      execution: option.open.execution ? serializeExecution(option.open.execution) : null,
      searchLog: option.open.searchLog.map((entry) => ({
        iteration: entry.iteration,
        amountDecimal: entry.amountDecimal,
        openAmountOutDecimal: entry.openAmountOutDecimal,
        closeAmountOutDecimal: entry.closeAmountOutDecimal,
        poolPriceAfter: entry.poolPriceAfter,
        validatedPriceAfter: entry.validatedPriceAfter,
        counterPriceAfter: entry.counterPriceAfter,
        targetPrice: entry.targetPrice,
        targetDiffBps: entry.targetDiffBps,
        priceDiffBps: entry.priceDiffBps,
        priceGap: entry.priceGap ?? null,
      })),
    },
    close: {
      candidate: serializeValue(option.close.candidate),
      execution: option.close.execution ? serializeExecution(option.close.execution) : null,
    },
    summary: {
      netUsdChange: option.summary.netUsdChange,
      totalCostUsd: option.summary.totalCostUsd,
      notes: option.summary.notes,
    },
    initialPrice: option.initialPrice,
    referencePrice: option.referencePrice,
    targetPrice: option.targetPrice,
  };
}

function serializeExecution(execution: ClipExecutionVariant) {
  const payload: Record<string, unknown> = {
    flavor: execution.flavor,
    fromAsset: execution.fromAsset,
    toAsset: execution.toAsset,
  };

  assignIfPresent(payload, "amountInDecimal", execution.amountInDecimal);
  assignIfPresent(payload, "amountOutDecimal", execution.amountOutDecimal);
  assignIfPresent(payload, "poolPriceBefore", execution.poolPriceBefore);
  assignIfPresent(payload, "poolPriceAfter", execution.poolPriceAfter);
  assignIfPresent(payload, "poolBaseBefore", execution.poolBaseBefore);
  assignIfPresent(payload, "poolQuoteBefore", execution.poolQuoteBefore);
  assignIfPresent(payload, "poolBaseAfter", execution.poolBaseAfter);
  assignIfPresent(payload, "poolQuoteAfter", execution.poolQuoteAfter);
  assignIfPresent(payload, "onchainAmountOutDecimal", execution.onchainAmountOutDecimal);
  assignIfPresent(payload, "onchainPoolPriceAfter", execution.onchainPoolPriceAfter);
  assignIfPresent(payload, "onchainPoolBaseAfter", execution.onchainPoolBaseAfter);
  assignIfPresent(payload, "onchainPoolQuoteAfter", execution.onchainPoolQuoteAfter);
  if (execution.onchainSqrtPriceAfter != null) {
    payload.onchainSqrtPriceAfter = execution.onchainSqrtPriceAfter.toString();
  }
  assignIfPresent(payload, "onchainBaseDelta", execution.onchainBaseDelta);
  assignIfPresent(payload, "onchainQuoteDelta", execution.onchainQuoteDelta);
  if (execution.onchainWarnings && execution.onchainWarnings.length > 0) {
    payload.onchainWarnings = execution.onchainWarnings;
  }
  assignIfPresent(payload, "referencePriceBefore", execution.referencePriceBefore);
  assignIfPresent(payload, "predictedPriceAfter", execution.predictedPriceAfter);
  assignIfPresent(payload, "onchainPriceAfter", execution.onchainPriceAfter);
  assignIfPresent(payload, "priceDiffBps", execution.priceDiffBps);
  if (execution.referenceLabel) payload.referenceLabel = execution.referenceLabel;
  assignIfPresent(payload, "effectivePrice", execution.effectivePrice);
  if (execution.baseSymbol) payload.baseSymbol = execution.baseSymbol;
  if (execution.quoteSymbol) payload.quoteSymbol = execution.quoteSymbol;
  if (execution.nativeRateMode) payload.nativeRateMode = execution.nativeRateMode;
  if (execution.nativeRateBasis) payload.nativeRateBasis = execution.nativeRateBasis;
  if (execution.nativeRateBasisLabel) payload.nativeRateBasisLabel = execution.nativeRateBasisLabel;
  assignIfPresent(payload, "nativeRateSpot", execution.nativeRateSpot);
  assignIfPresent(payload, "nativeRateMovingAverage", execution.nativeRateMovingAverage);
  assignIfPresent(payload, "nativeRateMintPrice", execution.nativeRateMintPrice);
  assignIfPresent(payload, "nativeRateRedeemPrice", execution.nativeRateRedeemPrice);
  assignIfPresent(payload, "nativeRateStableAsset", execution.nativeRateStableAsset);
  assignIfPresent(payload, "nativeRateReferenceAsset", execution.nativeRateReferenceAsset);
  assignIfPresent(payload, "nativeRatePairBase", execution.nativeRatePairBase);
  assignIfPresent(payload, "nativeRatePairQuote", execution.nativeRatePairQuote);
  assignIfPresent(payload, "nativeReferenceUsdBase", execution.nativeReferenceUsdBase);
  assignIfPresent(payload, "nativeReferenceUsdQuote", execution.nativeReferenceUsdQuote);
  assignIfPresent(payload, "nativeReferenceSpotUsd", execution.nativeReferenceSpotUsd);
  assignIfPresent(payload, "nativeReferenceMovingAverageUsd", execution.nativeReferenceMovingAverageUsd);

  const evaluation = serializeValue(execution.evaluation);
  if (evaluation != null) payload.evaluation = evaluation;

  return payload;
}

function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === undefined) return;
  target[key] = value;
}

function serializeValue<T>(value: T): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => serializeValue(entry));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = serializeValue(entry);
    }
    return result;
  }
  return value;
}
