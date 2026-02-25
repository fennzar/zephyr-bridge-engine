import {
  ARB_DEFS,
  decodeLegSegmentKey,
  encodeLegSegmentKey,
  listSegmentsFor,
  type ArbLegs,
  type LegSegmentKind,
  type SemanticStep,
} from "@domain/arbitrage/routing";
import type { AssetId } from "@domain/types";
import type { PathEvaluation, PathInventoryStatus } from "@domain/pathing";
import type { QuoterAwareSegmentPlan } from "@domain/pathing/arb";
import { getAssetDecimals } from "@/app/shared/assetMetadata";
import { parseDecimalToUnits, formatAmount, formatUnits } from "@/app/quoters/quoteHelpers";

// ── Inline types ────────────────────────────────────────

export interface LegChoice {
  label: string;
  value: string;
  leg: ArbLegs;
}

export interface ParsedParams {
  asset: ArbLegs["asset"];
  direction: ArbLegs["direction"];
  legChoice: SegmentChoice;
  amountInOverride?: bigint;
  maxDepth?: number;
  pathLimit?: number;
  errors: string[];
}

export interface SegmentChoice {
  value: string;
  label: string;
  kind: LegSegmentKind;
  index: number;
  need: AssetId;
  step: SemanticStep;
}

export type MetricTone = "ok" | "warn" | "error" | "info";

export type CandidateEntry = QuoterAwareSegmentPlan["step"]["candidates"][number];

export interface CandidateSummary {
  validCount: number;
  bestHopIndex: number | null;
  bestCostIndex: number | null;
}

// ── Helper functions ────────────────────────────────────

export function segmentLabel(kind: LegSegmentKind): string {
  switch (kind) {
    case "open":
      return "Open leg";
    case "close_native":
      return "Close leg (native)";
    case "close_cex":
      return "Close leg (CEX)";
    default:
      return kind;
  }
}

export function pickFirst(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function buildAssetChoices(): ArbLegs["asset"][] {
  return Array.from(new Set(ARB_DEFS.map((leg) => leg.asset)));
}

export function buildDirectionChoices(asset: ArbLegs["asset"]): ArbLegs["direction"][] {
  return ARB_DEFS.filter((leg) => leg.asset === asset).map((leg) => leg.direction);
}

export function buildSegmentChoices(asset: ArbLegs["asset"], direction: ArbLegs["direction"]): SegmentChoice[] {
  return listSegmentsFor(asset, direction).map((segment) => ({
    value: encodeLegSegmentKey(segment.kind, segment.index),
    label: `${segmentLabel(segment.kind)} · ${formatStepLabel(segment.step)}`,
    kind: segment.kind,
    index: segment.index,
    need: segment.step.from as AssetId,
    step: segment.step,
  }));
}

export function parsePositiveInt(raw: string | null, label: string): { value?: number; error?: string } {
  if (!raw) return {};
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${label} must be a positive integer.` };
  }
  return { value: parsed };
}

export function parseLegParams(params: Record<string, string | string[] | undefined>): ParsedParams {
  const errors: string[] = [];
  const assetChoices = buildAssetChoices();
  if (assetChoices.length === 0) {
    errors.push("No arbitrage legs are configured.");
    return { asset: "ZEPH", direction: "evm_discount", legChoice: {
      value: "",
      label: "",
      kind: "open",
      index: 0,
      need: "ZEPH.n",
      step: { from: "ZEPH.n", to: "ZEPH.n", op: ["nativeMint"] },
    }, errors };
  }

  const assetParam = pickFirst(params.asset);
  const selectedAsset = assetChoices.includes(assetParam as ArbLegs["asset"]) ? (assetParam as ArbLegs["asset"]) : assetChoices[0]!;
  if (assetParam && !assetChoices.includes(assetParam as ArbLegs["asset"])) {
    errors.push(`Unknown asset: ${assetParam}`);
  }

  const directionChoices = buildDirectionChoices(selectedAsset);
  const directionParam = pickFirst(params.direction);
  const selectedDirection = directionChoices.includes(directionParam as ArbLegs["direction"])
    ? (directionParam as ArbLegs["direction"])
    : directionChoices[0]!;
  if (directionParam && !directionChoices.includes(directionParam as ArbLegs["direction"])) {
    errors.push(`Direction ${directionParam} not available for ${selectedAsset}.`);
  }

  const legChoices = buildSegmentChoices(selectedAsset, selectedDirection);
  if (legChoices.length === 0) {
    errors.push("Selected asset/direction has no leg segments.");
    const fallbackLeg = listSegmentsFor(ARB_DEFS[0]!.asset, ARB_DEFS[0]!.direction)[0];
    const fallbackChoice: SegmentChoice = fallbackLeg
      ? {
          value: encodeLegSegmentKey(fallbackLeg.kind, fallbackLeg.index),
          label: `${segmentLabel(fallbackLeg.kind)} · ${formatStepLabel(fallbackLeg.step)}`,
          kind: fallbackLeg.kind,
          index: fallbackLeg.index,
          need: fallbackLeg.step.from as AssetId,
          step: fallbackLeg.step,
        }
      : {
          value: encodeLegSegmentKey("open", 0),
          label: "Unavailable segment",
          kind: "open",
          index: 0,
          need: "ZEPH.n",
          step: { from: "ZEPH.n", to: "ZEPH.n", op: ["nativeMint"] },
        };
    return {
      asset: selectedAsset,
      direction: selectedDirection,
      legChoice: fallbackChoice,
      errors,
    };
  }

  const legParam = pickFirst(params.leg);
  const selectedLegChoice = legChoices.find((choice) => choice.value === legParam) ?? legChoices[0]!;
  if (legParam && !legChoices.some((choice) => choice.value === legParam)) {
    errors.push("Requested leg segment not found for selected asset/direction.");
  }

  const amountParam = pickFirst(params.amount);
  let amountInOverride: bigint | undefined;
  if (amountParam) {
    const decimals = getAssetDecimals(selectedLegChoice.need);
    const parsed = parseDecimalToUnits(amountParam, decimals);
    if (parsed.ok) {
      if (parsed.value <= 0n) {
        errors.push("Amount must be greater than zero.");
      } else {
        amountInOverride = parsed.value;
      }
    } else {
      errors.push(parsed.error);
    }
  }

  const { value: maxDepth, error: depthError } = parsePositiveInt(pickFirst(params.maxDepth), "Max depth");
  if (depthError) errors.push(depthError);

  const { value: pathLimit, error: limitError } = parsePositiveInt(pickFirst(params.pathLimit), "Path limit");
  if (limitError) errors.push(limitError);

  return {
    asset: selectedAsset,
    direction: selectedDirection,
    legChoice: selectedLegChoice,
    amountInOverride,
    maxDepth,
    pathLimit,
    errors,
  };
}

export function formatStepLabel(step: SemanticStep): string {
  const ops = step.op.join(", ");
  return `${step.from} → ${step.to} (${ops})`;
}

export function formatBps(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)} bps`;
}

export function formatBooleanFlag(value: boolean, reasons: string[]): JSX.Element {
  if (value) {
    return <span style={{ color: "#16c784", fontWeight: 600 }}>Allowed</span>;
  }
  const detail = reasons.length > 0 ? ` – ${reasons.join("; ")}` : "";

  return (
    <span style={{ color: "#f45b69", fontWeight: 600 }}>
      Blocked
      {detail}
    </span>
  );
}

export function renderAmount(amount: bigint | null | undefined, asset: AssetId): string {
  if (amount == null || amount <= 0n) return amount != null ? amount.toString() : "—";
  const view = formatAmount(amount, getAssetDecimals(asset));
  return view.decimal ?? amount.toString();
}

export function renderGas(gas: bigint | null | undefined): string {
  if (gas == null || gas < 0n) return "—";
  const wei = gas.toString();
  const gwei = formatUnits(gas, 9);
  return `${wei} wei (${gwei} gwei)`;
}

export function formatUsd(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(digits)}`;
}

export function formatSigned(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  const formatted = value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}

export function formatNumberValue(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function renderInventoryRange(
  start: number | null | undefined,
  end: number | null | undefined,
  status: PathInventoryStatus,
): string {
  const startLabel = formatNumberValue(start);
  const endLabel = formatNumberValue(end);
  if (status === "short" && start != null && end != null && end < 0) {
    const shortfall = formatNumberValue(start - end);
    return `${startLabel} → shortfall of ${shortfall}`;
  }
  return `${startLabel} → ${endLabel}`;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds === 0 ? `${minutes} min` : `${minutes}m ${remainingSeconds}s`;
}

export function candidateKey(candidate: CandidateEntry, index: number): string {
  return `${candidate.source}-${index}-${candidate.path.assets.join("->")}`;
}

export function describeInventoryStatus(evaluation: PathEvaluation): { text: string; tone: MetricTone } {
  switch (evaluation.inventory.status) {
    case "prepped":
      return { text: "Prepped", tone: "ok" };
    case "covered":
      return { text: "Covered", tone: "ok" };
    case "unknown":
      return { text: "Unknown", tone: "warn" };
    case "short":
    default:
      return { text: "Shortfall", tone: "error" };
  }
}

export function summarizeCandidates(candidates: CandidateEntry[]): CandidateSummary {
  const validIndexes = candidates
    .map((candidate, index) => (isInventoryReady(candidate.evaluation) ? index : null))
    .filter((index): index is number => index != null);

  const computeBestBy = (metric: (candidate: CandidateEntry) => number): number | null => {
    let bestIndex: number | null = null;
    let bestValue = Number.POSITIVE_INFINITY;
    for (const index of validIndexes) {
      const value = metric(candidates[index]!);
      if (value < bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const bestHopIndex = computeBestBy((candidate) => candidate.evaluation.score.hopCount);
  const bestCostIndex = computeBestBy((candidate) =>
    candidate.evaluation.totalCostUsd != null && Number.isFinite(candidate.evaluation.totalCostUsd)
      ? candidate.evaluation.totalCostUsd
      : Number.POSITIVE_INFINITY,
  );

  return {
    validCount: validIndexes.length,
    bestHopIndex,
    bestCostIndex,
  };
}

export function isInventoryReady(evaluation: PathEvaluation): boolean {
  if (!evaluation.score.allowed) return false;
  return evaluation.inventory.status === "prepped" || evaluation.inventory.status === "covered";
}

export function collectDisallowReasons(evaluation: PathEvaluation): string[] {
  const reasons = evaluation.hops.flatMap((hop) => hop.allowanceReasons);
  return uniqueStrings(reasons);
}
