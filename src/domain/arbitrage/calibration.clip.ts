import { createLogger } from "@shared/logger";
import { calibrateSwapVsCex, type TwoVenueIteration } from "./calibration.twoVenue";
import { clampCalibrationPrice } from "./calibration.utils";
import { runCalibrationLoop } from "./calibration.iterative";
import { quoteCexTrade } from "@domain/quoting/quoting.cex";
import { quoteSwapOnchain } from "@domain/quoting/quoting.onchain.swap";

const log = createLogger("Clip:Calibration");
import type { OnchainSwapQuote } from "@domain/quoting/quoting.onchain.swap";
import type { OperationQuoteRequest, OperationQuoteResponse } from "@domain/quoting/types";
import type { AssetId } from "@domain/types";
import type { SemanticStep } from "./routing";
import type { GlobalState, EvmPool } from "@domain/state/types";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import { toFiniteNumber } from "@shared/format";
import type {
  ClipEstimate,
  ClipExecutionVariant,
  ClipSearchIteration,
  ClipCalibrationResult,
} from "./clip.types";

export interface CalibrateClipRouteParams {
  flavor: "native" | "cex";
  openStep: SemanticStep;
  closeStep: SemanticStep;
  openCandidateBase: QuoterAwareCandidate;
  closeCandidateBase: QuoterAwareCandidate;
  clip: ClipEstimate;
  state: GlobalState;
  priceMap: Partial<Record<AssetId, number>>;
  pool: EvmPool | null;
  initialAmountDecimal: number;
  initialPoolPrice: number | null;
  referencePrice: number;
  priceUsd: number | null;
}

export interface ClipCalibrationHelpers {
  assetDecimals: (asset: AssetId) => number;
  decimalToBigInt: (amount: number, decimals: number) => bigint;
  toDecimal: (amount: bigint, asset: AssetId) => number;
  cloneCandidate: (candidate: QuoterAwareCandidate | null) => QuoterAwareCandidate | null;
  simulateExecution: (
    flavor: "open" | "native" | "cex",
    step: SemanticStep,
    amountIn: bigint,
    state: GlobalState,
    candidate: QuoterAwareCandidate | null,
    priceMap: Partial<Record<AssetId, number>>,
  ) => Promise<ClipExecutionVariant | null>;
  computeBpsDiff: (reference: number, comparison: number) => number | null;
}

interface IterationSample {
  amountDecimal: number;
  amountRaw: bigint;
  openExecution: ClipExecutionVariant;
  closeExecution: ClipExecutionVariant | null;
  openAmountOutDecimal: number | null;
  closeAmountOutDecimal: number | null;
  poolPriceAfter: number | null;
  validatedPriceAfter: number | null;
  counterPriceAfter: number | null;
  diff: number | null;
}

export async function calibrateClipRoute(
  params: CalibrateClipRouteParams,
  helpers: ClipCalibrationHelpers,
): Promise<ClipCalibrationResult> {
  const {
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
  } = params;

  const searchLog: ClipSearchIteration[] = [];

  if (flavor === "cex") {
    return calibrateCexRoute({
      openStep,
      closeStep,
      openCandidateBase,
      closeCandidateBase,
      clip,
      state,
      priceMap,
      priceUsd,
      initialAmountDecimal,
      initialPoolPrice,
      referencePrice,
    }, helpers, searchLog);
  }

  return calibrateNativeRoute({
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
  }, helpers, searchLog);
}

interface CalibrateNativeRouteParams {
  openStep: SemanticStep;
  closeStep: SemanticStep;
  openCandidateBase: QuoterAwareCandidate;
  closeCandidateBase: QuoterAwareCandidate;
  clip: ClipEstimate;
  state: GlobalState;
  priceMap: Partial<Record<AssetId, number>>;
  pool: EvmPool | null;
  initialAmountDecimal: number;
  initialPoolPrice: number | null;
  referencePrice: number;
  priceUsd: number | null;
}

async function calibrateNativeRoute(
  params: CalibrateNativeRouteParams,
  helpers: ClipCalibrationHelpers,
  searchLog: ClipSearchIteration[],
): Promise<ClipCalibrationResult> {
  const {
    openStep,
    closeStep,
    openCandidateBase,
    closeCandidateBase,
    clip,
    state,
    priceMap,
    initialAmountDecimal,
    initialPoolPrice,
    referencePrice,
    priceUsd,
  } = params;

  const {
    assetDecimals,
    decimalToBigInt,
    toDecimal,
    cloneCandidate,
    simulateExecution,
    computeBpsDiff,
  } = helpers;

  const openFromDecimals = assetDecimals(openStep.from as AssetId);
  const closeFromDecimals = assetDecimals(closeStep.from as AssetId);
  const initialPrice = initialPoolPrice ?? referencePrice ?? null;
  const wantsIncrease = initialPrice == null ? true : referencePrice >= initialPrice;
  const marginBps = 5;
  const toleranceAbs = Math.abs(referencePrice || initialPrice || 1) * marginBps / 10_000;
  const minDecimal = Math.max(initialAmountDecimal * 1e-6, 1e-12);

  const computeCalibratedTarget = (sample: IterationSample | null): number | null => {
    if (!sample) return null;
    const poolPrice = sample.validatedPriceAfter ?? sample.poolPriceAfter;
    const counterPrice = sample.counterPriceAfter;
    if (poolPrice != null && counterPrice != null) {
      return (poolPrice + counterPrice) / 2;
    }
    return poolPrice ?? counterPrice ?? null;
  };

  const recordSample = (sample: IterationSample) => {
    const iteration = searchLog.length;
    const calibratedTarget = computeCalibratedTarget(sample);
    const validated = sample.validatedPriceAfter ?? sample.poolPriceAfter;
    const targetDiffBps = referencePrice != null && validated != null
      ? computeBpsDiff(referencePrice, validated)
      : null;
    const priceDiffBps = referencePrice != null && sample.poolPriceAfter != null
      ? computeBpsDiff(referencePrice, sample.poolPriceAfter)
      : null;
    searchLog.push({
      iteration,
      amountDecimal: sample.amountDecimal,
      openAmountOutDecimal: sample.openAmountOutDecimal,
      closeAmountOutDecimal: sample.closeAmountOutDecimal,
      poolPriceAfter: sample.poolPriceAfter,
      validatedPriceAfter: validated,
      counterPriceAfter: referencePrice,
      targetPrice: calibratedTarget,
      targetDiffBps,
      priceDiffBps,
      priceGap: sample.diff,
    });
  };

  const preferNativeSample = (a: IterationSample | null, b: IterationSample | null): IterationSample | null => {
    if (!a) return b;
    if (!b) return a;
    const aDiff = a.diff;
    const bDiff = b.diff;
    const aSafe = aDiff != null && aDiff <= 0;
    const bSafe = bDiff != null && bDiff <= 0;

    if (aSafe && !bSafe) return a;
    if (bSafe && !aSafe) return b;

    if (aSafe && bSafe) {
      if (aDiff != null && bDiff != null && aDiff !== bDiff) {
        return aDiff > bDiff ? a : b;
      }
      if (a.amountDecimal !== b.amountDecimal) {
        return a.amountDecimal > b.amountDecimal ? a : b;
      }
      return Math.abs(aDiff ?? Number.POSITIVE_INFINITY) <= Math.abs(bDiff ?? Number.POSITIVE_INFINITY) ? a : b;
    }

    if (aDiff == null) return b;
    if (bDiff == null) return a;
    return Math.abs(aDiff) <= Math.abs(bDiff) ? a : b;
  };

  const evaluateAmount = async (amountDecimal: number): Promise<IterationSample | null> => {
    if (!Number.isFinite(amountDecimal) || amountDecimal <= 0) return null;
    const amountRaw = decimalToBigInt(amountDecimal, openFromDecimals);
    if (amountRaw <= 0n) return null;

    const openRequest: OperationQuoteRequest = {
      op: "swapEVM",
      from: openStep.from as AssetId,
      to: openStep.to as AssetId,
      amountIn: amountRaw,
    };

    let openQuote: OnchainSwapQuote | null = null;
    try {
      openQuote = await quoteSwapOnchain(openRequest, state);
    } catch (error) {
      if (process.env.CLIP_DEBUG) {
        const reason = error instanceof Error ? error.message : String(error);
        log.error(`swap quote failed for ${openStep.from as string}->${openStep.to as string}: ${reason}`);
      }
    }

    const openAmountOutFromQuote = openQuote
      ? toFiniteNumber(toDecimal(openQuote.amountOut, openStep.to as AssetId))
      : null;
    const quotedPoolPriceAfter = resolvePoolPriceAfter(openQuote);

    const openCandidate = cloneCandidate(openCandidateBase);
    const closeCandidate = cloneCandidate(closeCandidateBase);
    if (!openCandidate || !closeCandidate) return null;

    openCandidate.amountIn = amountRaw;
    const openExecution = await simulateExecution("open", openStep, amountRaw, state, openCandidate, priceMap);
    if (!openExecution) return null;

    let closeExecution: ClipExecutionVariant | null = null;
    const closeInputDecimal =
      openExecution.onchainAmountOutDecimal
      ?? openAmountOutFromQuote
      ?? openExecution.amountOutDecimal
      ?? null;
    if (closeInputDecimal != null && closeInputDecimal > 0) {
      let closeAmountRaw = decimalToBigInt(closeInputDecimal, closeFromDecimals);
      if (closeAmountRaw <= 0n) closeAmountRaw = 1n;
      closeCandidate.amountIn = closeAmountRaw;
      closeExecution = await simulateExecution("native", closeStep, closeAmountRaw, state, closeCandidate, priceMap);
    }

    const effectivePrice =
      toFiniteNumber(openExecution.onchainPriceAfter)
      ?? toFiniteNumber(openExecution.effectivePrice)
      ?? null;
    const poolPriceAfter = quotedPoolPriceAfter ?? effectivePrice ?? toFiniteNumber(openExecution.predictedPriceAfter);
    const validatedPriceAfter = poolPriceAfter ?? effectivePrice ?? null;

    let diff: number | null = null;
    if (poolPriceAfter != null && referencePrice != null) {
      diff = wantsIncrease ? poolPriceAfter - referencePrice : referencePrice - poolPriceAfter;
    } else if (effectivePrice != null && referencePrice != null) {
      diff = wantsIncrease ? effectivePrice - referencePrice : referencePrice - effectivePrice;
    }

    const openAmountOutDecimalValue =
      openAmountOutFromQuote
      ?? toFiniteNumber(openExecution.onchainAmountOutDecimal)
      ?? toFiniteNumber(openExecution.amountOutDecimal);
    const closeAmountOutDecimalValue =
      toFiniteNumber(closeExecution?.onchainAmountOutDecimal)
      ?? toFiniteNumber(closeExecution?.amountOutDecimal);

    return {
      amountDecimal,
      amountRaw,
      openExecution,
      closeExecution,
      openAmountOutDecimal: openAmountOutDecimalValue,
      closeAmountOutDecimal: closeAmountOutDecimalValue,
      poolPriceAfter: poolPriceAfter ?? null,
      validatedPriceAfter,
      counterPriceAfter: referencePrice,
      diff,
    };
  };

  pushInitialLogEntry(searchLog, {
    poolPrice: initialPoolPrice,
    counterPrice: referencePrice,
    referencePrice,
    computeBpsDiff,
  });

  const buildResult = (sample: IterationSample) => {
    const amountUsd = priceUsd != null ? sample.amountDecimal * priceUsd : null;
    const rawTargetPrice = computeCalibratedTarget(sample);
    const targetPrice = clampCalibrationPrice(rawTargetPrice, initialPoolPrice, referencePrice);
    clip.amount = sample.amountRaw;
    clip.amountDecimal = sample.amountDecimal;
    clip.amountUsd = amountUsd;
    return {
      openExecution: sample.openExecution,
      closeExecution: sample.closeExecution,
      amountDecimal: sample.amountDecimal,
      amountRaw: sample.amountRaw,
      amountUsd,
      searchLog,
      initialPoolPrice,
      referencePrice,
      targetPrice,
    };
  };

  const initialSample = await evaluateAmount(initialAmountDecimal > 0 ? initialAmountDecimal : minDecimal);
  if (!initialSample) {
    throw new Error("Unable to evaluate initial clip amount");
  }
  recordSample(initialSample);

  if (initialSample.diff == null || Math.abs(initialSample.diff) <= toleranceAbs) {
    return buildResult(initialSample);
  }

  const maxIterations = 64;
  const expandLimit = 64;

  const result = await runCalibrationLoop<IterationSample>({
    initialSample,
    evaluate: evaluateAmount,
    toleranceAbs,
    minDecimal,
    maxIterations,
    expandLimit,
    recordSample,
    preferSample: preferNativeSample,
  });

  const candidateOrder = [
    result.bestSample,
    result.lowSample,
    result.finalSample,
    result.highSample,
    initialSample,
  ].filter((sample): sample is IterationSample => Boolean(sample));

  const safeCandidate = candidateOrder.reduce<IterationSample | null>((best, candidate) => {
    if (candidate.diff == null || candidate.diff > 0) return best;
    if (!best) return candidate;
    const bestDiff = best.diff ?? Number.NEGATIVE_INFINITY;
    const candidateDiff = candidate.diff ?? Number.NEGATIVE_INFINITY;
    if (candidateDiff === bestDiff) {
      return candidate.amountDecimal > best.amountDecimal ? candidate : best;
    }
    return candidateDiff > bestDiff ? candidate : best;
  }, null);

  if (safeCandidate) {
    return buildResult(safeCandidate);
  }

  const fallbackCandidate = candidateOrder.reduce<IterationSample | null>(
    (best, sample) => preferNativeSample(best, sample),
    null,
  ) ?? initialSample;

  if (fallbackCandidate.diff != null && fallbackCandidate.diff > 0) {
    const minimalSample = await evaluateAmount(minDecimal);
    if (minimalSample) {
      recordSample(minimalSample);
      if (minimalSample.diff == null || minimalSample.diff <= 0) {
        return buildResult(minimalSample);
      }
    }
  }

  return buildResult(fallbackCandidate);
}

interface CalibrateCexRouteParams {
  openStep: SemanticStep;
  closeStep: SemanticStep;
  openCandidateBase: QuoterAwareCandidate;
  closeCandidateBase: QuoterAwareCandidate;
  clip: ClipEstimate;
  state: GlobalState;
  priceMap: Partial<Record<AssetId, number>>;
  priceUsd: number | null;
  initialAmountDecimal: number;
  initialPoolPrice: number | null;
  referencePrice: number;
}

async function calibrateCexRoute(
  params: CalibrateCexRouteParams,
  helpers: ClipCalibrationHelpers,
  searchLog: ClipSearchIteration[],
): Promise<ClipCalibrationResult> {
  const {
    openStep,
    closeStep,
    openCandidateBase,
    closeCandidateBase,
    clip,
    state,
    priceMap,
    priceUsd,
    initialAmountDecimal,
    initialPoolPrice,
    referencePrice,
  } = params;

  const {
    assetDecimals,
    decimalToBigInt,
    cloneCandidate,
    simulateExecution,
    computeBpsDiff,
  } = helpers;

  const calibration = await calibrateSwapVsCex({
    state,
    openStep,
    closeStep,
    initialAmountDecimal,
    initialPoolPrice,
    referencePrice,
  });

  const finalIteration =
    calibration.iterations[calibration.iterations.length - 1] ?? calibration.iterations[0];

  clip.amount = calibration.amountRaw;
  clip.amountDecimal = calibration.amountDecimal;
  clip.amountUsd = priceUsd != null ? calibration.amountDecimal * priceUsd : null;

  const openCandidate = cloneCandidate(openCandidateBase);
  if (openCandidate) {
    openCandidate.amountIn = calibration.amountRaw;
  }

  const openExecution = await simulateExecution(
    "open",
    openStep,
    calibration.amountRaw,
    state,
    openCandidate,
    priceMap,
  );
  if (!openExecution) {
    throw new Error("Failed to build open execution for calibrated clip");
  }

  const closeCandidate = cloneCandidate(closeCandidateBase);
  if (!closeCandidate) {
    throw new Error("Failed to clone close candidate for calibrated clip");
  }

  const closeInputDecimal =
    finalIteration?.openAmountOutDecimal
    ?? calibration.openAmountOutDecimal
    ?? openExecution.onchainAmountOutDecimal
    ?? openExecution.amountOutDecimal
    ?? null;

  let closeExecution: ClipExecutionVariant | null = null;
  if (closeInputDecimal != null && Number.isFinite(closeInputDecimal) && closeInputDecimal > 0) {
    const closeDecimals = assetDecimals(closeStep.from as AssetId);
    const closeAmountRaw = decimalToBigInt(closeInputDecimal, closeDecimals);
    closeCandidate.amountIn = closeAmountRaw;

    const closeQuoteRequest: OperationQuoteRequest = {
      op: "tradeCEX",
      from: closeStep.from as AssetId,
      to: closeStep.to as AssetId,
      amountIn: closeAmountRaw,
    };

    const closeQuote = finalIteration?.closeQuote ?? quoteCexTrade(closeQuoteRequest, state);
    if (!closeQuote) {
      throw new Error("Failed to retrieve CEX quote for calibrated clip");
    }

    closeExecution = buildCexExecutionVariant(closeStep, closeAmountRaw, closeQuote, helpers);
  }

  if (!closeExecution) {
    throw new Error("Failed to build CEX close execution for calibrated clip");
  }

  const reference = finalIteration?.closePrice ?? referencePrice ?? null;
  const targetPrice = calibration.alignedPrice ?? reference;
  const clampedTargetPrice = clampCalibrationPrice(targetPrice, initialPoolPrice, referencePrice);

  pushInitialLogEntry(searchLog, {
    poolPrice: initialPoolPrice,
    counterPrice: reference,
    referencePrice: reference,
    computeBpsDiff,
  });

  for (const iteration of calibration.iterations) {
    const iterationIndex = searchLog.length;
    searchLog.push(mapIterationToClip(iteration, helpers, iterationIndex));
  }

  const amountUsd = priceUsd != null ? calibration.amountDecimal * priceUsd : null;

  return {
    openExecution,
    closeExecution,
    amountDecimal: calibration.amountDecimal,
    amountRaw: calibration.amountRaw,
    amountUsd,
    searchLog,
    initialPoolPrice,
    referencePrice: reference,
    targetPrice: clampedTargetPrice,
  };
}

function mapIterationToClip(
  iteration: TwoVenueIteration,
  helpers: ClipCalibrationHelpers,
  iterationIndex: number,
): ClipSearchIteration {
  const { computeBpsDiff } = helpers;
  const targetDiffBps = iteration.targetPrice != null && iteration.poolPrice != null
    ? computeBpsDiff(iteration.targetPrice, iteration.poolPrice)
    : iteration.targetDiffBps ?? null;
  const priceDiffBps = iteration.closePrice != null && iteration.poolPrice != null
    ? computeBpsDiff(iteration.closePrice, iteration.poolPrice)
    : iteration.priceDiffBps ?? null;
  return {
    iteration: iterationIndex,
    amountDecimal: iteration.amountDecimal,
    openAmountOutDecimal: toFiniteNumber(iteration.openAmountOutDecimal),
    closeAmountOutDecimal: toFiniteNumber(iteration.closeAmountOutDecimal),
    poolPriceAfter: toFiniteNumber(iteration.poolPrice),
    validatedPriceAfter: toFiniteNumber(iteration.poolPrice),
    counterPriceAfter: toFiniteNumber(iteration.closePrice),
    targetPrice: toFiniteNumber(iteration.targetPrice),
    targetDiffBps,
    priceDiffBps,
    priceGap: iteration.priceGap ?? undefined,
  };
}

function buildCexExecutionVariant(
  step: SemanticStep,
  amountIn: bigint,
  quote: OperationQuoteResponse,
  helpers: ClipCalibrationHelpers,
): ClipExecutionVariant {
  const { toDecimal } = helpers;
  const fromAsset = step.from as AssetId;
  const toAsset = step.to as AssetId;
  const amountInDecimal = toDecimal(amountIn, fromAsset);
  const amountOutDecimal = quote.amountOut != null ? toDecimal(quote.amountOut, toAsset) : null;
  const impact = quote.cexImpact;
  const referencePriceBefore = parseMaybeNumber(impact?.priceBefore);
  const priceAfter = parseMaybeNumber(impact?.priceAfter ?? impact?.averageFillPrice);
  const priceDiffBps = impact?.priceImpactBps ?? null;
  const effectivePrice = parseMaybeNumber(impact?.averageFillPrice ?? impact?.priceAfter ?? impact?.priceBefore);

  return {
    flavor: "cex",
    evaluation: null,
    amountInDecimal,
    amountOutDecimal,
    poolPriceBefore: null,
    poolPriceAfter: null,
    onchainAmountOutDecimal: amountOutDecimal,
    onchainPoolPriceAfter: priceAfter,
    onchainWarnings: quote.warnings ?? undefined,
    fromAsset,
    toAsset,
    baseSymbol: fromAsset,
    quoteSymbol: toAsset,
    poolBaseBefore: null,
    poolQuoteBefore: null,
    poolBaseAfter: null,
    poolQuoteAfter: null,
    onchainPoolBaseAfter: null,
    onchainPoolQuoteAfter: null,
    onchainSqrtPriceAfter: null,
    onchainBaseDelta: null,
    onchainQuoteDelta: null,
    referencePriceBefore,
    predictedPriceAfter: priceAfter,
    onchainPriceAfter: priceAfter,
    priceDiffBps,
    referenceLabel: impact?.market ? `CEX ${impact.market}` : "CEX price",
    effectivePrice,
  };
}

function parseMaybeNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pushInitialLogEntry(
  searchLog: ClipSearchIteration[],
  params: {
    poolPrice: number | null;
    counterPrice: number | null;
    referencePrice: number | null;
    computeBpsDiff: (reference: number, comparison: number) => number | null;
  },
): void {
  const { poolPrice, counterPrice, referencePrice, computeBpsDiff } = params;
  const iteration = searchLog.length;
  const targetPrice =
    poolPrice != null && counterPrice != null
      ? (poolPrice + counterPrice) / 2
      : poolPrice ?? counterPrice ?? null;
  const targetDiffBps =
    referencePrice != null && poolPrice != null ? computeBpsDiff(referencePrice, poolPrice) : null;
  const priceDiffBps =
    counterPrice != null && poolPrice != null ? computeBpsDiff(counterPrice, poolPrice) : null;
  const priceGap =
    poolPrice != null && counterPrice != null ? poolPrice - counterPrice : null;

  searchLog.push({
    iteration,
    amountDecimal: 0,
    openAmountOutDecimal: 0,
    closeAmountOutDecimal: 0,
    poolPriceAfter: poolPrice,
    validatedPriceAfter: poolPrice,
    counterPriceAfter: counterPrice,
    targetPrice,
    targetDiffBps,
    priceDiffBps,
    priceGap,
  });
}

function resolvePoolPriceAfter(quote: OnchainSwapQuote | null): number | null {
  if (!quote) return null;
  return (
    toFiniteNumber(quote.poolImpact?.priceAfter)
    ?? toFiniteNumber(quote.poolImpact?.priceAfterRaw)
    ?? toFiniteNumber(quote.poolPriceAfter)
    ?? toFiniteNumber(quote.poolPriceAfterRaw)
    ?? toFiniteNumber(quote.poolPriceAfterSqrt)
  );
}
