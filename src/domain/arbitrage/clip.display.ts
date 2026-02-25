import type { ClipExecutionVariant, ClipRouteOutcome, ClipSearchIteration } from "./clip.types";
import type { EvmPool } from "@domain/state/types";
import type { AssetId } from "@domain/types";
import type { SemanticStep } from "./routing";
import { normalizeSymbol, computeBpsDiff } from "./clip.helpers";

export function invertRouteOutcome(outcome: ClipRouteOutcome): ClipRouteOutcome {
  const clone: ClipRouteOutcome = {
    flavor: outcome.flavor,
    openLeg: outcome.openLeg ? { ...outcome.openLeg } : null,
    closeLeg: outcome.closeLeg ? { ...outcome.closeLeg } : null,
    netUsdChange: outcome.netUsdChange,
    totalCostUsd: outcome.totalCostUsd,
    notes: [...outcome.notes],
  };
  if (clone.openLeg) {
    clone.openLeg = adjustExecutionPricesForDisplay(clone.openLeg, true, outcome.openLeg?.referencePriceBefore ?? null);
  }
  if (clone.closeLeg) {
    clone.closeLeg = adjustExecutionPricesForDisplay(
      clone.closeLeg,
      true,
      outcome.closeLeg?.referencePriceBefore ?? null,
    );
  }
  return clone;
}

export function shouldInvertPoolPriceForDisplay(openStep: SemanticStep, pool: EvmPool | null): boolean {
  if (!pool) return false;
  const fromKey = normalizeSymbol(openStep.from as AssetId);
  const toKey = normalizeSymbol(openStep.to as AssetId);
  const baseKey = normalizeSymbol(pool.base);
  const quoteKey = normalizeSymbol(pool.quote);
  return fromKey === baseKey && toKey === quoteKey;
}

export function adjustPriceForDisplay(value: number | null | undefined, invert: boolean): number | null {
  if (value == null || !Number.isFinite(value)) return value ?? null;
  if (!invert) return value;
  if (value === 0) return null;
  return 1 / value;
}

export function adjustExecutionPricesForDisplay(
  execution: ClipExecutionVariant | null,
  invert: boolean,
  referencePrice: number | null,
): ClipExecutionVariant | null {
  if (!invert || !execution) return execution;
  const clone: ClipExecutionVariant = { ...execution };

  clone.poolPriceBefore = adjustPriceForDisplay(clone.poolPriceBefore, true);
  clone.poolPriceAfter = adjustPriceForDisplay(clone.poolPriceAfter, true);
  clone.onchainPoolPriceAfter = adjustPriceForDisplay(clone.onchainPoolPriceAfter, true);
  clone.predictedPriceAfter = adjustPriceForDisplay(clone.predictedPriceAfter, true);
  clone.onchainPriceAfter = adjustPriceForDisplay(clone.onchainPriceAfter, true);
  clone.effectivePrice = adjustPriceForDisplay(clone.effectivePrice, true);
  clone.referencePriceBefore = adjustPriceForDisplay(clone.referencePriceBefore, true);

  const reference = referencePrice ?? clone.referencePriceBefore ?? null;
  const comparison =
    clone.poolPriceAfter ??
    clone.predictedPriceAfter ??
    clone.onchainPriceAfter ??
    null;
  clone.priceDiffBps =
    reference != null && comparison != null ? computeBpsDiff(reference, comparison) : clone.priceDiffBps ?? null;

  return clone;
}

export function adjustClipSearchLogForDisplay(
  entries: ClipSearchIteration[],
  invert: boolean,
  referencePrice: number | null,
): ClipSearchIteration[] {
  if (!invert) return entries;
  return entries.map((entry) => {
    const counter = entry.counterPriceAfter ?? referencePrice ?? null;
    const pool = adjustPriceForDisplay(entry.poolPriceAfter, true);
    const validated = adjustPriceForDisplay(entry.validatedPriceAfter, true);
    const target = adjustPriceForDisplay(entry.targetPrice, true);
    const priceGap = counter != null && pool != null ? pool - counter : entry.priceGap;
    const priceDiffBps = counter != null && pool != null ? computeBpsDiff(counter, pool) : entry.priceDiffBps ?? null;
    const targetDiffBps =
      counter != null && validated != null ? computeBpsDiff(counter, validated) : entry.targetDiffBps ?? null;
    return {
      ...entry,
      poolPriceAfter: pool,
      validatedPriceAfter: validated,
      targetPrice: target,
      priceGap,
      priceDiffBps,
      targetDiffBps,
    };
  });
}
