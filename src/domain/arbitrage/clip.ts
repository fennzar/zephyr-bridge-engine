import { createLogger } from "@shared/logger";
import { assetDecimals } from "@domain/assets/decimals";
import { decimalToBigInt, toDecimal as toDecimalRaw } from "@domain/core/conversion";
import { evaluatePaths } from "@domain/pathing";

const log = createLogger("Clip");
import type { PathEvaluation } from "@domain/pathing";
import type { ArbLegs, SemanticStep } from "./routing";
import type { GlobalState, EvmPool } from "@domain/state/types";
import type { AssetId } from "@domain/types";
import {
  buildQuoterAwareLegPreparationPlan,
  type QuoterAwareCandidate,
} from "@domain/pathing/arb";
import { quoteSwapOnchain } from "@domain/quoting/quoting.onchain.swap";
import type { OperationQuoteRequest } from "@domain/quoting/types";
import { calibrateClipRoute } from "./calibration.clip";
import type {
  ClipEstimate,
  ClipEstimateOptions,
  ClipExecutionVariant,
  ClipOption,
  ClipRouteOutcome,
  ClipScenario,
  ClipCalibrationResult,
} from "./clip.types";
import { isFiniteNumber } from "@shared/format";
import { normalizeSymbol, computeBpsDiff, cloneClipEstimate, cloneCandidate } from "./clip.helpers";
import {
  buildClipPriceMap,
  resolveAssetUsdPrice,
  resolveReferencePrice,
  findEvmPool,
  estimatePoolAssetCapacity,
} from "./clip.priceMap";
import { resolveNativeRateContext } from "./clip.nativeRate";
import {
  invertRouteOutcome,
  shouldInvertPoolPriceForDisplay,
  adjustPriceForDisplay,
  adjustExecutionPricesForDisplay,
  adjustClipSearchLogForDisplay,
} from "./clip.display";

export { buildClipPriceMap } from "./clip.priceMap";

const DEFAULT_CLIP_MIN_USD = 500;
const DEFAULT_CLIP_POOL_SHARE = 0.1;

function toDecimal(amount: bigint, asset: AssetId): number {
  return toDecimalRaw(amount, assetDecimals(asset));
}

export function estimateClipAmount(
  leg: ArbLegs,
  state: GlobalState,
  options?: ClipEstimateOptions,
): ClipEstimate | null {
  const openStep = leg.open[0];
  const openAsset = openStep?.from as AssetId | undefined;
  if (!openStep || !openAsset) return null;

  if (options?.amountOverride && options.amountOverride > 0n) {
    const amountDecimal = toDecimal(options.amountOverride, openAsset);
    const pool = findEvmPool(state, openStep.from as AssetId, openStep.to as AssetId);
    return {
      asset: openAsset,
      amount: options.amountOverride,
      amountDecimal,
      amountUsd: resolveAssetUsdPrice(openAsset, buildClipPriceMap(state), pool),
      pool,
    };
  }

  const priceMap = buildClipPriceMap(state);
  const pool = findEvmPool(state, openStep.from as AssetId, openStep.to as AssetId);
  const priceUsd = resolveAssetUsdPrice(openAsset, priceMap, pool);

  let poolAssetCap = estimatePoolAssetCapacity(pool, openAsset);
  let poolUsdCap: number | null = null;

  if (poolAssetCap != null && priceUsd != null) {
    poolUsdCap = poolAssetCap * priceUsd;
  }

  if (poolUsdCap == null && pool && isFiniteNumber(pool.tvlUsd)) {
    poolUsdCap = (pool.tvlUsd / 2) * DEFAULT_CLIP_POOL_SHARE;
  }

  if ((poolAssetCap == null || poolAssetCap <= 0) && poolUsdCap != null && priceUsd != null && priceUsd > 0) {
    poolAssetCap = poolUsdCap / priceUsd;
  }

  let clipAmountDecimal = poolAssetCap;

  if ((clipAmountDecimal == null || clipAmountDecimal <= 0) && priceUsd != null && priceUsd > 0) {
    clipAmountDecimal = DEFAULT_CLIP_MIN_USD / priceUsd;
    poolUsdCap = DEFAULT_CLIP_MIN_USD;
  }

  if (clipAmountDecimal == null || !Number.isFinite(clipAmountDecimal) || clipAmountDecimal <= 0) {
    return null;
  }

  const clipAmountUsd = priceUsd != null ? clipAmountDecimal * priceUsd : poolUsdCap;

  const decimals = assetDecimals(openAsset);
  let amount = decimalToBigInt(clipAmountDecimal, decimals);
  if (amount <= 0n) amount = 1n;

  return {
    asset: openAsset,
    amount,
    amountDecimal: clipAmountDecimal,
    amountUsd: clipAmountUsd != null && Number.isFinite(clipAmountUsd) ? clipAmountUsd : null,
    pool,
  };
}

export async function buildClipScenario(
  leg: ArbLegs,
  state: GlobalState,
  options?: ClipEstimateOptions,
): Promise<ClipScenario | null> {
  const priceMap = buildClipPriceMap(state);
  const clipBase = estimateClipAmount(leg, state, options);
  if (!clipBase) return null;

  const preparation = await buildQuoterAwareLegPreparationPlan(leg, state, {
    amountOverrides: { [clipBase.asset]: clipBase.amount },
    pathLimit: options?.pathLimit ?? 3,
  });

  const openCandidate = preparation.open[0]?.candidates[0] ?? null;
  const nativeCandidate = preparation.close.native?.[0]?.candidates?.[0] ?? null;
  const cexCandidate = preparation.close.cex?.[0]?.candidates?.[0] ?? null;

  const optionsList: ClipOption[] = [];

  if (openCandidate && nativeCandidate) {
    const option = await buildClipOption(
      "native",
      leg,
      clipBase,
      openCandidate,
      nativeCandidate,
      state,
      priceMap,
    );
    if (option) optionsList.push(option);
  }

  if (openCandidate && cexCandidate) {
    const option = await buildClipOption(
      "cex",
      leg,
      clipBase,
      openCandidate,
      cexCandidate,
      state,
      priceMap,
    );
    if (option) optionsList.push(option);
  }

return {
  pool: clipBase.pool ?? null,
  options: optionsList,
};
}

async function buildClipOption(
  flavor: "native" | "cex",
  leg: ArbLegs,
  clipBase: ClipEstimate,
  openCandidateBase: QuoterAwareCandidate,
  closeCandidateBase: QuoterAwareCandidate,
  state: GlobalState,
  priceMap: Partial<Record<AssetId, number>>,
): Promise<ClipOption | null> {
  const openStep = leg.open[0];
  if (!openStep) return null;

  const clip = cloneClipEstimate(clipBase);
  const openCandidate = cloneCandidate(openCandidateBase);
  const closeCandidate = cloneCandidate(closeCandidateBase);
  if (!openCandidate || !closeCandidate) return null;
  const closeStep = flavor === "native" ? leg.close.native?.[0] : leg.close.cex?.[0];
  if (!closeStep) return null;

  let calibration;
  try {
    calibration = await calibrateRoute(
      flavor,
      openStep,
      closeStep,
      openCandidate,
      closeCandidate,
      clip,
      state,
      priceMap,
    );
  } catch (error) {
    if (process.env.CLIP_DEBUG) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error(`calibrate failed for ${leg.asset} (${flavor}): ${reason}`);
    }
    return null;
  }

  clip.amount = calibration.amountRaw;
  clip.amountDecimal = calibration.amountDecimal;
  clip.amountUsd = calibration.amountUsd;

  const invertPoolPrices = shouldInvertPoolPriceForDisplay(openStep, clip.pool ?? null);
  const initialPrice = adjustPriceForDisplay(calibration.initialPoolPrice, invertPoolPrices);
  const targetPrice = adjustPriceForDisplay(calibration.targetPrice, invertPoolPrices);
  const adjustedOpenExecution = adjustExecutionPricesForDisplay(
    calibration.openExecution,
    invertPoolPrices,
    calibration.referencePrice,
  );
  const adjustedSearchLog = adjustClipSearchLogForDisplay(
    calibration.searchLog,
    invertPoolPrices,
    calibration.referencePrice,
  );

  return {
    flavor,
    clip,
    open: {
      candidate: openCandidate,
      execution: adjustedOpenExecution,
      searchLog: adjustedSearchLog,
    },
    close: {
      candidate: closeCandidate,
      execution: calibration.closeExecution,
    },
    summary: invertPoolPrices
      ? invertRouteOutcome(buildRouteOutcome(flavor, calibration.openExecution, calibration.closeExecution))
      : buildRouteOutcome(flavor, calibration.openExecution, calibration.closeExecution),
    initialPrice,
    referencePrice: calibration.referencePrice,
    targetPrice,
  };
}


async function calibrateRoute(
  flavor: "native" | "cex",
  openStep: SemanticStep,
  closeStep: SemanticStep,
  openCandidateBase: QuoterAwareCandidate,
  closeCandidateBase: QuoterAwareCandidate,
  clip: ClipEstimate,
  state: GlobalState,
  priceMap: Partial<Record<AssetId, number>>,
): Promise<ClipCalibrationResult> {
  const fromAsset = openStep.from as AssetId;
  const pool = clip.pool ?? findEvmPool(state, openStep.from as AssetId, openStep.to as AssetId);
  const initialAmountDecimal = Number.isFinite(clip.amountDecimal) && clip.amountDecimal > 0
    ? clip.amountDecimal
    : toDecimal(clip.amount, fromAsset);
  if (!Number.isFinite(initialAmountDecimal) || initialAmountDecimal <= 0) {
    throw new Error("Invalid initial clip amount");
  }

  const initialPoolPrice = pool?.price ?? null;
  const priceUsd = resolveAssetUsdPrice(fromAsset, priceMap, pool ?? null);
  const nativeContext = flavor === "native" ? resolveNativeRateContext(closeStep, state, priceMap) : null;
  const referencePrice =
    flavor === "cex"
      ? resolveReferencePrice(closeStep, priceMap)
      : nativeContext?.price ?? nativeContext?.usdSpot ?? resolveReferencePrice(closeStep, priceMap);
  if (referencePrice == null || !Number.isFinite(referencePrice)) {
    throw new Error("Missing reference price for calibration");
  }

  const result = await calibrateClipRoute(
    {
      flavor,
      openStep,
      closeStep,
      openCandidateBase,
      closeCandidateBase,
      clip,
      state,
      priceMap,
      pool,
      initialAmountDecimal,
      initialPoolPrice,
      referencePrice,
      priceUsd,
    },
    {
      assetDecimals,
      decimalToBigInt,
      toDecimal,
      cloneCandidate,
      simulateExecution,
      computeBpsDiff,
    },
  );

  clip.amount = result.amountRaw;
  clip.amountDecimal = result.amountDecimal;
  clip.amountUsd = result.amountUsd;

  return result;
}

function buildRouteOutcome(
  flavor: "native" | "cex",
  openExecution: ClipExecutionVariant | null,
  closeExecution: ClipExecutionVariant | null,
): ClipRouteOutcome {
  const notes: string[] = [];
  const openNet = openExecution?.evaluation?.score?.netUsdChangeUsd ?? null;
  const closeNet = closeExecution?.evaluation?.score?.netUsdChangeUsd ?? null;
  const netUsdChange =
    openNet != null && closeNet != null ? openNet + closeNet : null;
  if (openNet == null || closeNet == null) {
    notes.push("Missing net USD change for one or more legs");
  }
  const openCost = openExecution?.evaluation?.score?.totalCostUsd ?? null;
  const closeCost = closeExecution?.evaluation?.score?.totalCostUsd ?? null;
  const totalCostUsd =
    openCost != null && closeCost != null ? openCost + closeCost : null;
  return {
    flavor,
    openLeg: openExecution,
    closeLeg: closeExecution,
    netUsdChange,
    totalCostUsd,
    notes,
  };
}


async function simulateExecution(
  flavor: "open" | "native" | "cex",
  step: SemanticStep,
  amountIn: bigint,
  state: GlobalState,
  candidate: QuoterAwareCandidate | null,
  priceMap: Partial<Record<AssetId, number>>,
): Promise<ClipExecutionVariant | null> {
  if (!amountIn || amountIn <= 0n) return null;
  const result = await evaluatePaths(
    {
      from: step.from as AssetId,
      to: step.to as AssetId,
      amountIn,
      limit: 1,
    },
    state,
  );
  const evaluation = result.paths[0] ?? null;
  if (candidate && evaluation) {
    candidate.evaluation = evaluation;
  }
  const amountInDecimal = toDecimal(amountIn, step.from as AssetId);
  const amountOutDecimal = evaluation
    ? evaluation.assetDeltas.find((delta) => delta.asset === (step.to as AssetId))?.amountDecimal ?? null
    : null;

  const pool = findEvmPool(state, step.from as AssetId, step.to as AssetId);
  let baseSymbol: AssetId | null = pool?.base ?? null;
  let quoteSymbol: AssetId | null = pool?.quote ?? null;
  const poolBaseBefore = pool && isFiniteNumber(pool.totalBase) ? pool.totalBase : null;
  const poolQuoteBefore = pool && isFiniteNumber(pool.totalQuote) ? pool.totalQuote : null;
  const poolBefore = determinePoolPrice(pool, poolBaseBefore, poolQuoteBefore);
  const simAfterState = pool && evaluation ? derivePoolStateWithDeltas(pool, evaluation) : null;
  const poolAfter = simAfterState?.price ?? null;
  const poolBaseAfter = simAfterState?.baseTotal ?? null;
  const poolQuoteAfter = simAfterState?.quoteTotal ?? null;
  const nativeContext = flavor === "native" ? resolveNativeRateContext(step, state, priceMap) : null;
  if (flavor === "cex") {
    baseSymbol = step.from as AssetId;
    quoteSymbol = step.to as AssetId;
  } else if (!baseSymbol || !quoteSymbol) {
    baseSymbol = baseSymbol ?? (step.to as AssetId);
    quoteSymbol = quoteSymbol ?? (step.from as AssetId);
  }

  let onchainAmountOutDecimal: number | null = null;
  let onchainPoolPriceAfter: number | null = null;
  let onchainWarnings: string[] | undefined;
  let onchainPoolBaseAfter: number | null = null;
  let onchainPoolQuoteAfter: number | null = null;
  let onchainSqrtPriceAfter: bigint | null = null;
  let onchainBaseDelta: number | null = null;
  let onchainQuoteDelta: number | null = null;
  let predictedPriceAfter: number | null = null;
  let onchainPriceAfter: number | null = null;
  let priceDiffBps: number | null = null;
  let referencePriceBefore: number | null = null;
  let referenceLabel: string | undefined;
  let effectivePrice: number | null = null;
  let nativeRateMode: "mint" | "redeem" | undefined;
  let nativeRateBasis: "spot" | "moving_average" | "spot_equals_ma" | undefined;
  let nativeRateBasisLabel: string | undefined;
  let nativeRateSpot: number | null = null;
  let nativeRateMovingAverage: number | null = null;
  let nativeRateMintPrice: number | null = null;
  let nativeRateRedeemPrice: number | null = null;
  let nativeRateStableAsset: string | null = null;
  let nativeRateReferenceAsset: string | null = null;
  let nativeRatePairBase: string | null = null;
  let nativeRatePairQuote: string | null = null;
  let nativeReferenceUsdBase: string | null = null;
  let nativeReferenceUsdQuote: string | null = null;
  let nativeReferenceSpotUsd: number | null = null;
  let nativeReferenceMovingAverageUsd: number | null = null;

  if (step.op.includes("swapEVM")) {
    const request: OperationQuoteRequest = {
      op: "swapEVM",
      from: step.from as AssetId,
      to: step.to as AssetId,
      amountIn,
    };
    try {
      const quote = await quoteSwapOnchain(request, state);
      if (quote) {
        const decimals = assetDecimals(step.to as AssetId);
        onchainAmountOutDecimal = Number(quote.amountOut) / 10 ** decimals;
        onchainWarnings = quote.warnings;

        if (pool) {
          if (quote.poolBaseAfterRaw != null) {
            onchainPoolBaseAfter = toDecimal(quote.poolBaseAfterRaw, pool.base as AssetId);
          }
          if (quote.poolQuoteAfterRaw != null) {
            onchainPoolQuoteAfter = toDecimal(quote.poolQuoteAfterRaw, pool.quote as AssetId);
          }
          if (quote.amount0Delta != null) {
            onchainBaseDelta = toDecimal(quote.amount0Delta, pool.base as AssetId);
          }
          if (quote.amount1Delta != null) {
            onchainQuoteDelta = toDecimal(quote.amount1Delta, pool.quote as AssetId);
          }
          if (quote.poolBaseAfterRaw != null && quote.poolQuoteAfterRaw != null) {
            const baseAfterDecimal = toDecimal(quote.poolBaseAfterRaw, pool.base as AssetId);
            const quoteAfterDecimal = toDecimal(quote.poolQuoteAfterRaw, pool.quote as AssetId);
            if (Number.isFinite(baseAfterDecimal) && baseAfterDecimal > 0 && Number.isFinite(quoteAfterDecimal)) {
              onchainPoolPriceAfter = quoteAfterDecimal / baseAfterDecimal;
            }
          }
          if (quote.sqrtPriceX96After != null) {
            onchainSqrtPriceAfter = quote.sqrtPriceX96After;
          }
        }

        if (
          pool &&
          Number.isFinite(onchainAmountOutDecimal) &&
          (quote.poolBaseAfterRaw == null || quote.poolQuoteAfterRaw == null)
        ) {
          const onchainState = applySwapToPool(
            pool,
            step.from as AssetId,
            step.to as AssetId,
            toDecimal(amountIn, step.from as AssetId),
            onchainAmountOutDecimal ?? 0,
          );
          onchainPoolPriceAfter = onchainPoolPriceAfter ?? onchainState.price;
          onchainPoolBaseAfter = onchainPoolBaseAfter ?? onchainState.baseTotal;
          onchainPoolQuoteAfter = onchainPoolQuoteAfter ?? onchainState.quoteTotal;
        }
      }
    } catch (error) {
      onchainWarnings = [error instanceof Error ? error.message : "On-chain quote failed"];
    }
  }

  if (pool) {
    referencePriceBefore = poolBefore;
    predictedPriceAfter = poolAfter;
    onchainPriceAfter = onchainPoolPriceAfter ?? null;
    priceDiffBps =
      predictedPriceAfter != null && onchainPriceAfter != null
        ? computeBpsDiff(predictedPriceAfter, onchainPriceAfter)
        : null;
    referenceLabel = "Pool price";
    effectivePrice = onchainPriceAfter ?? predictedPriceAfter;
  } else if (flavor === "cex") {
    referencePriceBefore = resolveReferencePrice(step, priceMap);
    effectivePrice =
      amountInDecimal != null && amountInDecimal !== 0 && amountOutDecimal != null
        ? amountOutDecimal / amountInDecimal
        : null;
    predictedPriceAfter = effectivePrice;
    onchainPriceAfter = effectivePrice;
    priceDiffBps =
      referencePriceBefore != null && effectivePrice != null
        ? computeBpsDiff(referencePriceBefore, effectivePrice)
        : null;
    referenceLabel = "CEX reference";
  } else if (flavor === "native") {
    nativeRateMode = nativeContext?.mode;
    nativeRateBasis = nativeContext?.basis;
    nativeRateBasisLabel = nativeContext?.basisLabel;
    nativeRateSpot = nativeContext?.spot ?? null;
    nativeRateMovingAverage = nativeContext?.movingAverage ?? null;
    nativeRateMintPrice = nativeContext?.mintPrice ?? null;
    nativeRateRedeemPrice = nativeContext?.redeemPrice ?? null;
    nativeRateStableAsset = nativeContext?.stableAsset ?? null;
    nativeRateReferenceAsset = nativeContext?.referenceAsset ?? null;
    nativeRatePairBase = nativeContext?.pairBase ?? null;
    nativeRatePairQuote = nativeContext?.pairQuote ?? null;
    nativeReferenceUsdBase = nativeContext?.usdBase ?? null;
    nativeReferenceUsdQuote = nativeContext?.usdQuote ?? null;
    nativeReferenceSpotUsd = nativeContext?.usdSpot ?? null;
    nativeReferenceMovingAverageUsd = nativeContext?.usdMovingAverage ?? null;
    const nativeReferenceFallback = resolveReferencePrice(step, priceMap);
    referencePriceBefore = nativeContext?.price ?? nativeReferenceFallback;
    effectivePrice =
      amountInDecimal != null && amountInDecimal !== 0 && amountOutDecimal != null
        ? amountOutDecimal / amountInDecimal
        : null;
    predictedPriceAfter = effectivePrice;
    onchainPriceAfter = effectivePrice;
    priceDiffBps =
      referencePriceBefore != null && effectivePrice != null
        ? computeBpsDiff(referencePriceBefore, effectivePrice)
        : null;
    referenceLabel = nativeContext?.label ?? "Native rate";
  }

  return {
    flavor,
    evaluation,
    amountInDecimal,
    amountOutDecimal,
    poolPriceBefore: poolBefore,
    poolPriceAfter: poolAfter,
    onchainAmountOutDecimal,
    onchainPoolPriceAfter,
    onchainWarnings,
    fromAsset: step.from as AssetId,
    toAsset: step.to as AssetId,
    baseSymbol,
    quoteSymbol,
    poolBaseBefore,
    poolQuoteBefore,
    poolBaseAfter,
    poolQuoteAfter,
    onchainPoolBaseAfter,
    onchainPoolQuoteAfter,
    onchainSqrtPriceAfter,
    onchainBaseDelta,
    onchainQuoteDelta,
    referencePriceBefore,
    predictedPriceAfter,
    onchainPriceAfter,
    priceDiffBps,
    referenceLabel,
    effectivePrice,
    nativeRateMode,
    nativeRateBasis,
    nativeRateBasisLabel,
    nativeRateSpot,
    nativeRateMovingAverage,
    nativeRateMintPrice,
    nativeRateRedeemPrice,
    nativeRateStableAsset,
    nativeRateReferenceAsset,
    nativeRatePairBase,
    nativeRatePairQuote,
    nativeReferenceUsdBase,
    nativeReferenceUsdQuote,
    nativeReferenceSpotUsd,
    nativeReferenceMovingAverageUsd,
  };
}

function determinePoolPrice(pool: EvmPool | null, baseTotal: number | null, quoteTotal: number | null): number | null {
  if (!pool) {
    return baseTotal != null && quoteTotal != null && baseTotal > 0 ? quoteTotal / baseTotal : null;
  }
  if (isFiniteNumber(pool.price)) return pool.price;
  if (baseTotal != null && quoteTotal != null && baseTotal > 0) return quoteTotal / baseTotal;
  return null;
}

function derivePoolStateWithDeltas(pool: EvmPool, evaluation: PathEvaluation): { price: number | null; baseTotal: number | null; quoteTotal: number | null } | null {
  const base = isFiniteNumber(pool.totalBase) ? pool.totalBase : null;
  const quote = isFiniteNumber(pool.totalQuote) ? pool.totalQuote : null;
  if (base == null || quote == null) return null;

  const baseKey = normalizeSymbol(pool.base);
  const quoteKey = normalizeSymbol(pool.quote);
  const baseDelta = evaluation.assetDeltas.find((delta) => normalizeSymbol(delta.asset) === baseKey)?.amountDecimal ?? 0;
  const quoteDelta = evaluation.assetDeltas.find((delta) => normalizeSymbol(delta.asset) === quoteKey)?.amountDecimal ?? 0;

  const newBase = base - baseDelta;
  const newQuote = quote - quoteDelta;
  if (!Number.isFinite(newBase) || !Number.isFinite(newQuote) || newBase <= 0) {
    return { price: null, baseTotal: null, quoteTotal: null };
  }
  return {
    price: newQuote / newBase,
    baseTotal: newBase,
    quoteTotal: newQuote,
  };
}

function applySwapToPool(
  pool: EvmPool,
  fromAsset: AssetId,
  toAsset: AssetId,
  amountInDecimal: number,
  amountOutDecimal: number,
): { price: number | null; baseTotal: number | null; quoteTotal: number | null } {
  const baseKey = normalizeSymbol(pool.base);
  const quoteKey = normalizeSymbol(pool.quote);
  const baseTotal = isFiniteNumber(pool.totalBase) ? pool.totalBase : null;
  const quoteTotal = isFiniteNumber(pool.totalQuote) ? pool.totalQuote : null;
  if (baseTotal == null || quoteTotal == null) return { price: null, baseTotal: null, quoteTotal: null };

  let newBase = baseTotal;
  let newQuote = quoteTotal;

  const fromKey = normalizeSymbol(fromAsset);
  const toKey = normalizeSymbol(toAsset);

  if (fromKey === baseKey) newBase += amountInDecimal;
  if (fromKey === quoteKey) newQuote += amountInDecimal;
  if (toKey === baseKey) newBase -= amountOutDecimal;
  if (toKey === quoteKey) newQuote -= amountOutDecimal;

  if (!Number.isFinite(newBase) || !Number.isFinite(newQuote) || newBase <= 0) {
    return { price: null, baseTotal: null, quoteTotal: null };
  }
  return {
    price: newQuote / newBase,
    baseTotal: newBase,
    quoteTotal: newQuote,
  };
}
