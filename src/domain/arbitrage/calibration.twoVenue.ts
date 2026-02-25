import { assetDecimals } from "@domain/assets/decimals";
import { decimalToBigInt, toDecimal as toDecimalRaw } from "@domain/core/conversion";
import { quoteSwapOnchain } from "@domain/quoting/quoting.onchain.swap";
import type { OnchainSwapQuote } from "@domain/quoting/quoting.onchain.swap";
import { quoteCexTrade } from "@domain/quoting/quoting.cex";
import type {
  CexTradeImpact,
  OperationQuoteRequest,
  OperationQuoteResponse,
} from "@domain/quoting/types";
import type { SemanticStep } from "./routing";
import type { GlobalState } from "@domain/state/types";
import type { AssetId } from "@domain/types";
import { clampCalibrationPrice } from "./calibration.utils";

const DEFAULT_TOLERANCE_BPS = 10;
const MAX_ITERATIONS = 32;
const MAX_EXPANSIONS = 32;
const EXPANSION_UP_FACTOR = 1.25;
const EXPANSION_DOWN_FACTOR = 1 / EXPANSION_UP_FACTOR;

export interface TwoVenueIteration {
  iteration: number;
  amountDecimal: number;
  amountRaw: bigint;
  openAmountOutDecimal: number | null;
  closeAmountOutDecimal: number | null;
  poolPrice: number | null;
  closePrice: number | null;
  targetPrice: number | null;
  priceDiffBps: number | null;
  targetDiffBps: number | null;
  priceGap: number | null;
  openQuote: OnchainSwapQuote | null;
  closeQuote: OperationQuoteResponse | null;
}

export interface TwoVenueCalibrationResult {
  amountDecimal: number;
  amountRaw: bigint;
  openAmountOutDecimal: number | null;
  iterations: TwoVenueIteration[];
  finalPoolPrice: number | null;
  finalClosePrice: number | null;
  alignedPrice: number | null;
}

export interface TwoVenueCalibrationParams {
  state: GlobalState;
  openStep: SemanticStep;
  closeStep: SemanticStep;
  initialAmountDecimal: number;
  toleranceBps?: number;
  maxIterations?: number;
  initialPoolPrice?: number | null;
  referencePrice?: number | null;
}

export async function calibrateSwapVsCex({
  state,
  openStep,
  closeStep,
  initialAmountDecimal,
  toleranceBps = DEFAULT_TOLERANCE_BPS,
  maxIterations = MAX_ITERATIONS,
  initialPoolPrice = null,
  referencePrice = null,
}: TwoVenueCalibrationParams): Promise<TwoVenueCalibrationResult> {
  if (!openStep.op.includes("swapEVM")) {
    throw new Error("Two-venue calibrator currently supports swapEVM open legs only");
  }
  if (!closeStep.op.includes("tradeCEX")) {
    throw new Error("Two-venue calibrator currently supports tradeCEX close legs only");
  }

  const openFrom = openStep.from as AssetId;
  const openTo = openStep.to as AssetId;
  const closeFrom = closeStep.from as AssetId;
  const closeTo = closeStep.to as AssetId;

  const openDecimals = assetDecimals(openFrom);
  const closeDecimals = assetDecimals(closeFrom);

  const iterations: TwoVenueIteration[] = [];
  let best: TwoVenueIteration | null = null;
  let lowSample: TwoVenueIteration | null = null;
  let highSample: TwoVenueIteration | null = null;
  let lowDecimal: number | null = null;
  let highDecimal: number | null = null;

  const minDecimal = Math.max(initialAmountDecimal * 1e-6, 1e-9);

  const evaluate = async (amountDecimal: number): Promise<TwoVenueIteration> => {
    const amountRaw = decimalToBigInt(amountDecimal, openDecimals);
    if (amountRaw <= 0n) {
      return buildIteration(
        iterations.length,
        amountDecimal,
        amountRaw,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      );
    }

    const openRequest: OperationQuoteRequest = {
      op: "swapEVM",
      from: openFrom,
      to: openTo,
      amountIn: amountRaw,
    };

    const openQuote = await quoteSwapOnchain(openRequest, state);
    if (!openQuote) {
      throw new Error("Open leg quoter returned null");
    }

    const openAmountOutDecimal = toDecimal(openQuote.amountOut, openTo);
    const closeAmountRaw =
      openAmountOutDecimal != null && Number.isFinite(openAmountOutDecimal) && openAmountOutDecimal > 0
        ? decimalToBigInt(openAmountOutDecimal, closeDecimals)
        : 0n;

    const closeRequest: OperationQuoteRequest = {
      op: "tradeCEX",
      from: closeFrom,
      to: closeTo,
      amountIn: closeAmountRaw > 0n ? closeAmountRaw : undefined,
      amountOut: undefined,
    };

    const closeQuote = closeAmountRaw > 0n ? quoteCexTrade(closeRequest, state) : null;

    const closeImpact: CexTradeImpact | undefined = closeQuote?.cexImpact ?? undefined;
    const poolPrice = parseNumber(openQuote.poolImpact?.priceAfter ?? openQuote.poolImpact?.priceAfterRaw);
    const closePrice = parseNumber(closeImpact?.averageFillPrice ?? closeImpact?.priceAfter ?? closeImpact?.priceBefore);
    const targetPrice = closePrice;
    const priceDiffBps = computeBpsDiff(closePrice, poolPrice);
    const targetDiffBps = computeBpsDiff(targetPrice, poolPrice);
    const priceGap = poolPrice != null && closePrice != null ? poolPrice - closePrice : null;
    const closeNetDecimal =
      closeQuote?.amountOut != null ? toDecimal(closeQuote.amountOut, closeTo) : null;

    return buildIteration(
      iterations.length,
      amountDecimal,
      amountRaw,
      openAmountOutDecimal,
      closeNetDecimal,
      poolPrice,
      closePrice,
      targetPrice,
      priceDiffBps,
      targetDiffBps,
      priceGap,
      openQuote,
      closeQuote,
    );
  };

  const initialSample = await evaluate(initialAmountDecimal);
  iterations.push(initialSample);
  best = pickBetter(best, initialSample);

  const anchors = {
    initialPoolPrice,
    referencePrice,
  };

  if (withinTolerance(initialSample.priceDiffBps, toleranceBps)) {
    return buildResult(iterations, initialSample, anchors);
  }

  if (initialSample.priceGap == null) {
    throw new Error("Unable to compute price gap for initial sample");
  }

  if (initialSample.priceGap < 0) {
    lowSample = initialSample;
    lowDecimal = initialSample.amountDecimal;
  } else if (initialSample.priceGap > 0) {
    highSample = initialSample;
    highDecimal = initialSample.amountDecimal;
  }

  // Expansion to find bracket
  if (!highSample) {
    let candidateDecimal = initialSample.amountDecimal * EXPANSION_UP_FACTOR;
    for (let i = 0; i < MAX_EXPANSIONS; i += 1) {
      if (!Number.isFinite(candidateDecimal) || candidateDecimal <= 0) break;
      const sample = await evaluate(candidateDecimal);
      iterations.push(sample);
      best = pickBetter(best, sample);
      if (withinTolerance(sample.priceDiffBps, toleranceBps)) {
        return buildResult(iterations, sample, anchors);
      }
      if (sample.priceGap != null && sample.priceGap >= 0) {
        highSample = sample;
        highDecimal = candidateDecimal;
        break;
      }
      const next = candidateDecimal * EXPANSION_UP_FACTOR;
      if (!Number.isFinite(next) || next === candidateDecimal) break;
      candidateDecimal = next;
    }
  }

  if (!lowSample) {
    let candidateDecimal = initialSample.amountDecimal * EXPANSION_DOWN_FACTOR;
    for (let i = 0; i < MAX_EXPANSIONS; i += 1) {
      if (!Number.isFinite(candidateDecimal) || candidateDecimal <= 0) break;
      if (candidateDecimal < minDecimal) {
        candidateDecimal = minDecimal;
      }
      const sample = await evaluate(candidateDecimal);
      iterations.push(sample);
      best = pickBetter(best, sample);
      if (withinTolerance(sample.priceDiffBps, toleranceBps)) {
        return buildResult(iterations, sample, anchors);
      }
      if (sample.priceGap != null && sample.priceGap <= 0) {
        lowSample = sample;
        lowDecimal = candidateDecimal;
        break;
      }
      const next = candidateDecimal * EXPANSION_DOWN_FACTOR;
      if (!Number.isFinite(next) || next === candidateDecimal) break;
      candidateDecimal = next;
    }
  }

  if (!lowSample || !highSample || lowDecimal == null || highDecimal == null) {
    const fallback = best ?? initialSample;
    return buildResult(iterations, fallback, anchors);
  }

  let evalCount = iterations.length;
  while (
    lowDecimal != null &&
    highDecimal != null &&
    evalCount < maxIterations &&
    Math.abs(highDecimal - lowDecimal) > minDecimal
  ) {
    let candidateDecimal: number | null = null;
    if (
      lowSample &&
      highSample &&
      lowSample.priceGap != null &&
      highSample.priceGap != null &&
      lowSample.priceGap !== highSample.priceGap
    ) {
      const numerator =
        (lowSample.amountDecimal * highSample.priceGap) - (highSample.amountDecimal * lowSample.priceGap);
      const denominator = highSample.priceGap - lowSample.priceGap;
      const secantDecimal = numerator / denominator;
      const lowerBound = Math.min(lowDecimal, highDecimal);
      const upperBound = Math.max(lowDecimal, highDecimal);
      if (
        Number.isFinite(secantDecimal) &&
        secantDecimal > lowerBound &&
        secantDecimal < upperBound &&
        Math.abs(secantDecimal - lowDecimal) > minDecimal &&
        Math.abs(secantDecimal - highDecimal) > minDecimal
      ) {
        candidateDecimal = secantDecimal;
      }
    }

    if (candidateDecimal == null) {
      candidateDecimal = (lowDecimal + highDecimal) / 2;
    }

    if (!Number.isFinite(candidateDecimal) || candidateDecimal <= 0) break;

    const sample = await evaluate(candidateDecimal);
    iterations.push(sample);
    evalCount += 1;
    best = pickBetter(best, sample);
      if (withinTolerance(sample.priceDiffBps, toleranceBps)) {
        return buildResult(iterations, sample, anchors);
      }
    if (sample.priceGap == null) break;
    if (sample.priceGap > 0) {
      highSample = sample;
      highDecimal = sample.amountDecimal;
    } else {
      lowSample = sample;
      lowDecimal = sample.amountDecimal;
    }
  }

  const finalSample = pickBetter(best, highSample, lowSample, initialSample);
  return buildResult(iterations, finalSample ?? initialSample, anchors);
}

function buildIteration(
  index: number,
  amountDecimal: number,
  amountRaw: bigint,
  openAmountOutDecimal: number | null,
  closeAmountOutDecimal: number | null,
  poolPrice: number | null,
  closePrice: number | null,
  targetPrice: number | null,
  priceDiffBps: number | null,
  targetDiffBps: number | null,
  priceGap: number | null,
  openQuote: OnchainSwapQuote | null,
  closeQuote: OperationQuoteResponse | null,
): TwoVenueIteration {
  return {
    iteration: index,
    amountDecimal,
    amountRaw,
    openAmountOutDecimal,
    closeAmountOutDecimal,
    poolPrice,
    closePrice,
    targetPrice,
    priceDiffBps,
    targetDiffBps,
    priceGap,
    openQuote,
    closeQuote,
  };
}

function withinTolerance(value: number | null, toleranceBps: number): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return Math.abs(value) <= toleranceBps;
}

function pickBetter<T extends { priceGap?: number | null }>(
  ...candidates: Array<T | null | undefined>
): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate || candidate.priceGap == null || !Number.isFinite(candidate.priceGap)) continue;
    const score = Math.abs(candidate.priceGap);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function buildResult(
  iterations: TwoVenueIteration[],
  finalSample: TwoVenueIteration,
  anchors?: {
    initialPoolPrice: number | null;
    referencePrice: number | null;
  },
): TwoVenueCalibrationResult {
  const rawAlignedPrice =
    finalSample.poolPrice != null && finalSample.closePrice != null
      ? (finalSample.poolPrice + finalSample.closePrice) / 2
      : finalSample.poolPrice ?? finalSample.closePrice ?? null;
  const initialAnchor = anchors?.initialPoolPrice ?? iterations[0]?.poolPrice ?? null;
  const referenceAnchor =
    anchors?.referencePrice ?? finalSample.closePrice ?? iterations[iterations.length - 1]?.closePrice ?? null;
  const alignedPrice = clampCalibrationPrice(rawAlignedPrice, initialAnchor, referenceAnchor);

  return {
    amountDecimal: finalSample.amountDecimal,
    amountRaw: finalSample.amountRaw,
    openAmountOutDecimal: finalSample.openAmountOutDecimal,
    iterations,
    finalPoolPrice: finalSample.poolPrice,
    finalClosePrice: finalSample.closePrice,
    alignedPrice,
  };
}

function toDecimal(amount: bigint | null | undefined, asset: AssetId): number | null {
  if (amount == null) return null;
  return toDecimalRaw(amount, assetDecimals(asset));
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeBpsDiff(reference: number | null, comparison: number | null): number | null {
  if (reference == null || comparison == null || reference === 0) return null;
  return ((comparison / reference) - 1) * 10_000;
}
