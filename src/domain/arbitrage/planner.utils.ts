import { assetDecimals } from "@domain/assets/decimals";
import { toDecimal as toDecimalRaw } from "@domain/core/conversion";
import type { SemanticStep } from "@domain/arbitrage/routing";
import type { PathEvaluation } from "@domain/pathing";
import type {
  QuoterAwareCandidate,
  QuoterAwareStepPreparation,
} from "@domain/pathing/arb";
import type { AssetId } from "@domain/types";

export function pickCandidate(step: QuoterAwareStepPreparation): QuoterAwareCandidate | null {
  if (step.candidates.length === 0) return null;
  const inventoryReady = step.candidates.filter((candidate) => {
    const status = candidate.evaluation.score.inventoryStatus;
    return candidate.evaluation.score.allowed && (status === "prepped" || status === "covered");
  });
  if (inventoryReady.length > 0) {
    return inventoryReady[0]!;
  }
  const allowed = step.candidates.find((candidate) => candidate.evaluation.score.allowed);
  return allowed ?? step.candidates[0] ?? null;
}

export function collectDisallowReasons(evaluation: PathEvaluation): string[] {
  const reasons = evaluation.hops.flatMap((hop) => hop.allowanceReasons);
  return uniqueStrings(reasons);
}

export function collectWarnings(evaluation: PathEvaluation): string[] {
  const warnings = evaluation.hops.flatMap((hop) => hop.warnings ?? []);
  return uniqueStrings([...(warnings ?? []), ...(evaluation.notes ?? [])]);
}

export function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

export function defaultProbeAmount(asset: AssetId): bigint {
  const decimals = assetDecimals(asset);
  if (decimals <= 0) return 1n;
  try {
    return 10n ** BigInt(decimals);
  } catch {
    return 1n;
  }
}

export function firstNonZero(values: Array<bigint | null | undefined>): bigint | null {
  for (const value of values) {
    if (value != null && value > 0n) return value;
  }
  return null;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  const precision = Math.abs(value) >= 1 ? 2 : 4;
  const formatted = value.toFixed(precision);
  return `$${formatted}`;
}

export function formatBalance(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "unknown";
  if (Math.abs(value) >= 1_000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

export function formatSemanticStep(step: SemanticStep): string {
  const ops = step.op.join(", ");
  return `${step.from} → ${step.to} (${ops})`;
}

export function inferLegBaseAsset(leg: { open: SemanticStep[]; close: { native: SemanticStep[]; cex?: SemanticStep[] } }): AssetId {
  const candidates: Array<AssetId | undefined> = [
    leg.open[0]?.from,
    leg.open[0]?.to,
    leg.close.native[0]?.from,
    leg.close.native[0]?.to,
    leg.close.cex?.[0]?.from,
    leg.close.cex?.[0]?.to,
  ];
  const resolved = candidates.find((value): value is AssetId => Boolean(value));
  return resolved ?? "USDT.e";
}

export function toDecimal(amount: bigint, asset: AssetId): number {
  if (amount <= 0n) return 0;
  return toDecimalRaw(amount, assetDecimals(asset));
}

export function appendNote(notes: string[] | undefined, message: string): string[] {
  if (!notes) return [message];
  if (notes.includes(message)) return notes;
  return [...notes, message];
}
