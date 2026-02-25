export { decimalToBigInt, toDecimal } from "@domain/core/conversion";
import { isFiniteNumber } from "@shared/format";
import type { ClipEstimate } from "./clip.types";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";

export function normalizeSymbol(value: string | null | undefined): string {
  return value ? value.replace(/\.(e|n)$/i, "").toUpperCase() : "";
}

export function computeBpsDiff(reference: number, comparison: number): number | null {
  if (!Number.isFinite(reference) || !Number.isFinite(comparison) || reference === 0) return null;
  return ((comparison / reference) - 1) * 10_000;
}

export function readSpotUsd(rate: unknown): number | null {
  if (!rate || typeof rate !== "object") return null;
  if ("spotUSD" in (rate as Record<string, unknown>)) {
    const value = (rate as { spotUSD?: number }).spotUSD;
    if (isFiniteNumber(value)) return value;
  }
  return null;
}

export function cloneClipEstimate(clip: ClipEstimate): ClipEstimate {
  return {
    asset: clip.asset,
    amount: BigInt(clip.amount),
    amountDecimal: clip.amountDecimal,
    amountUsd: clip.amountUsd,
    pool: clip.pool ?? null,
  };
}

export function cloneCandidate(candidate: QuoterAwareCandidate | null): QuoterAwareCandidate | null {
  if (!candidate) return null;
  return {
    source: candidate.source,
    amountIn: BigInt(candidate.amountIn),
    path: {
      assets: [...candidate.path.assets],
      steps: candidate.path.steps.map((step) => ({ ...step })),
    },
    evaluation: candidate.evaluation,
  };
}
