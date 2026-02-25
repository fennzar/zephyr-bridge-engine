import type { AssetId } from "@domain/types";
import type {
  ArbPlan,
  ArbPlanStep,
  InventoryRequirement,
  ArbPlanLegPrepView,
} from "@domain/arbitrage/types.plan";
import type { LegSegmentKind } from "@domain/arbitrage/routing";
import type { ClipOption, ClipExecutionVariant, ClipSearchIteration } from "@domain/arbitrage/clip.types";
import type { InventoryVariantView } from "@domain/inventory/types.api";
import { ASSET_VARIANTS, ASSET_BASE_BY_VARIANT, type AssetBase } from "@domain/assets/variants";
import { assetDecimals } from "@domain/assets/decimals";
import { formatCurrency, formatNumber, toFiniteNumber } from "@shared/format";
import { stripVariantSuffix } from "@/components/AssetBadge";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import type { PathEvaluation, PathInventoryStatus } from "@domain/pathing";

// ── Inline types ────────────────────────────────────────

export type ClipFlavor = ClipOption["flavor"];

export type InventoryVariantBreakdown = {
  assetId: string;
  required: number;
  available: number | null;
  shortfall: number | null;
  label?: string;
  source: string;
  inventoryAmount: number | null;
};

export type FlowEntry = {
  amount: number | string | null | undefined;
  asset: string | null | undefined;
};

export type FlowSection = { label: string; entries: FlowEntry[] };

export type ClipFlowSummary = {
  sections: FlowSection[];
  openFromAsset: string | null;
  openToAsset: string | null;
  closeFromAsset: string | null;
  closeToAsset: string | null;
};

export type PrepContext = {
  label: string;
  evaluation: PathEvaluation | null;
  amount: bigint | null;
  href: string | null;
  inventoryStatus: PathInventoryStatus | null;
  candidates: QuoterAwareCandidate[];
  primaryCandidate: QuoterAwareCandidate | null;
  primaryKey: string | null;
  needAsset: AssetId | null;
};

// ── Helper functions ────────────────────────────────────

export function formatBps(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)} bps`;
}

export function formatUsdInline(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return formatCurrency(value);
}

export function formatMaybeNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  return formatNumber(value, Math.abs(value) >= 1 ? 3 : 6);
}

export function describeStepAmount(step: ArbPlanStep): string | null {
  if (!step.asset || step.asset.length === 0) return null;
  if (step.amountIn != null) {
    const numeric = Number(step.amountIn);
    const display =
      Number.isFinite(numeric) && Math.abs(numeric) > 0
        ? formatNumber(numeric, Math.abs(numeric) >= 1 ? 4 : 8)
        : step.amountIn.toString();
    return `Amount: ${display} ${step.asset}`;
  }
  if (step.path?.finalAmountOut != null) {
    const numeric = Number(step.path.finalAmountOut);
    const display =
      Number.isFinite(numeric) && Math.abs(numeric) > 0
        ? formatNumber(numeric, Math.abs(numeric) >= 1 ? 4 : 8)
        : step.path.finalAmountOut.toString();
    return `Output: ${display} ${step.asset}`;
  }
  return null;
}

export function encodeLegSegment(kind: LegSegmentKind, index: number): string {
  return `${kind}:${index}`;
}

export function buildLegPrepHref(plan: ArbPlan, step?: ArbPlanStep): string {
  const params = new URLSearchParams();
  params.set("asset", plan.asset);
  params.set("direction", plan.direction);
  if (step?.prepSegment) {
    params.set("leg", encodeLegSegment(step.prepSegment.kind, step.prepSegment.index));
  }
  const clipDecimal = plan.summary.clipAmountDecimal;
  if (clipDecimal != null && Number.isFinite(clipDecimal) && clipDecimal > 0) {
    params.set("amount", clipDecimal.toString());
  }
  if (!params.has("leg")) {
    params.set("leg", encodeLegSegment("open", 0));
  }
  return `/arbitrage/leg-prep?${params.toString()}`;
}

export function buildClipFlowSections(option: ClipOption, clipAmountDecimal?: number | null): ClipFlowSummary {
  const amount = clipAmountDecimal ?? toFiniteNumber(option.clip?.amountDecimal);
  const openExecution = option.open?.execution as ClipExecutionVariant | null | undefined;
  const closeExecution = option.close?.execution as ClipExecutionVariant | null | undefined;
  const openCandidateAssets = Array.isArray(option.open?.candidate?.path?.assets)
    ? (option.open!.candidate!.path!.assets as string[])
    : [];
  const closeCandidateAssets = Array.isArray(option.close?.candidate?.path?.assets)
    ? (option.close!.candidate!.path!.assets as string[])
    : [];

  const openFromAsset = openExecution?.fromAsset ?? openCandidateAssets[0] ?? option.clip?.asset ?? null;
  const openToAsset = openExecution?.toAsset ?? openCandidateAssets[openCandidateAssets.length - 1] ?? openFromAsset;
  const closeFromAsset = closeExecution?.fromAsset ?? closeCandidateAssets[0] ?? openToAsset;
  const closeToAsset = closeExecution?.toAsset ?? closeCandidateAssets[closeCandidateAssets.length - 1] ?? closeFromAsset;

  const logEntries = Array.isArray(option.open?.searchLog) ? (option.open.searchLog as ClipSearchIteration[]) : [];
  const finalLog = logEntries.length > 0 ? logEntries[logEntries.length - 1] : null;
  const openFill =
    toFiniteNumber(finalLog?.openAmountOutDecimal)
    ?? toFiniteNumber(openExecution?.onchainAmountOutDecimal)
    ?? toFiniteNumber(openExecution?.amountOutDecimal);
  const closeFill =
    toFiniteNumber(finalLog?.closeAmountOutDecimal)
    ?? toFiniteNumber(closeExecution?.onchainAmountOutDecimal)
    ?? toFiniteNumber(closeExecution?.amountOutDecimal);

  const sections: FlowSection[] = [
    { label: "Open leg", entries: [{ amount, asset: openFromAsset }] },
    {
      label: "Intermediate",
      entries: [
        ...(openFill != null && openToAsset ? [{ amount: openFill, asset: openToAsset }] : []),
        ...(openFill != null && closeFromAsset && closeFromAsset !== openToAsset
          ? [{ amount: openFill, asset: closeFromAsset }]
          : []),
      ],
    },
    { label: "Close leg", entries: [{ amount: closeFill, asset: closeToAsset }] },
  ];

  return {
    sections,
    openFromAsset: openFromAsset ?? null,
    openToAsset: openToAsset ?? null,
    closeFromAsset: closeFromAsset ?? null,
    closeToAsset: closeToAsset ?? null,
  };
}

export function buildInventoryBreakdown(
  details: InventoryRequirement[],
  inventorySnapshot: { assets: Array<{ key: string; total: number | null; variants: InventoryVariantView[] | null }> } | null,
) {
  const groups = new Map<string, {
    assetKey: string;
    totalRequired: number;
    totalAvailable: number;
    availableKnown: boolean;
    inventoryTotal: number | null;
    inventoryVariants: InventoryVariantView[] | null;
    variants: InventoryVariantBreakdown[];
  }>();

  for (const detail of details) {
    const assetBase = ASSET_BASE_BY_VARIANT[detail.asset] ?? detail.asset;
    let group = groups.get(assetBase);
    if (!group) {
      const inventoryAsset = inventorySnapshot?.assets.find((asset) => asset.key === assetBase) ?? null;
      group = {
        assetKey: assetBase,
        totalRequired: 0,
        totalAvailable: 0,
        availableKnown: true,
        inventoryTotal: inventoryAsset?.total ?? null,
        inventoryVariants: inventoryAsset?.variants ?? null,
        variants: [],
      };
      groups.set(assetBase, group);
    }

    const required = Number.isFinite(detail.required) ? detail.required : 0;
    const available = Number.isFinite(detail.available ?? NaN) ? (detail.available as number) : null;
    group.totalRequired += required;
    if (available == null) {
      group.availableKnown = false;
    } else if (group.availableKnown) {
      group.totalAvailable += available;
    }

    const variantInventoryAmount = group.inventoryVariants?.find((entry) => entry.assetId === detail.asset)?.amount ?? null;
    const variantDef = ASSET_VARIANTS[assetBase as AssetBase]?.find((entry) => entry.assetId === detail.asset);
    const source = variantDef?.defaultSourceLabel ?? "unknown";
    const shortfall = available == null ? null : Math.max(required - available, 0);

    group.variants.push({
      assetId: detail.asset,
      required,
      available,
      shortfall,
      label: detail.label,
      source,
      inventoryAmount: variantInventoryAmount,
    });
  }

  return Array.from(groups.values()).map((group) => {
    const totalAvailable =
      group.inventoryTotal != null && Number.isFinite(group.inventoryTotal)
        ? group.inventoryTotal
        : group.availableKnown
          ? group.totalAvailable
          : null;
    const totalShortfall = totalAvailable == null ? null : Math.max(group.totalRequired - totalAvailable, 0);
    return {
      assetKey: group.assetKey,
      totalRequired: group.totalRequired,
      totalAvailable,
      totalShortfall,
      inventoryTotal: group.inventoryTotal,
      variants: group.variants,
    };
  });
}

export function buildPrepContext(
  label: string,
  snapshot: ArbPlanLegPrepView | null | undefined,
  fallbackCandidate: QuoterAwareCandidate | null,
  step: ArbPlanStep | null,
  plan: ArbPlan,
): PrepContext | null {
  const { primaryCandidate, candidates, primaryKey } = resolvePrepCandidates(snapshot, fallbackCandidate);
  const evaluation =
    primaryCandidate?.evaluation ??
    snapshot?.evaluation ??
    fallbackCandidate?.evaluation ??
    step?.path ??
    null;
  if (!evaluation) return null;

  const amount =
    snapshot?.amountIn ??
    primaryCandidate?.amountIn ??
    fallbackCandidate?.amountIn ??
    step?.amountIn ??
    null;

  const inventoryStatus =
    candidateInventoryStatus(primaryCandidate) ??
    evaluation.inventory?.status ??
    evaluation.score.inventoryStatus ??
    null;

  const primaryPathAssets = primaryCandidate?.path?.assets ?? [];
  const fallbackPathAssets = fallbackCandidate?.path?.assets ?? [];
  const primaryTarget =
    primaryPathAssets.length > 0 ? (primaryPathAssets[primaryPathAssets.length - 1] as AssetId) : null;
  const fallbackTarget =
    fallbackPathAssets.length > 0 ? (fallbackPathAssets[fallbackPathAssets.length - 1] as AssetId) : null;
  const needAsset =
    (snapshot?.need as AssetId | undefined) ??
    (step?.asset as AssetId | undefined) ??
    primaryTarget ??
    fallbackTarget ??
    (primaryCandidate?.source as AssetId | undefined) ??
    (fallbackCandidate?.source as AssetId | undefined) ??
    null;

  return {
    label,
    evaluation,
    amount,
    href: step ? buildLegPrepHref(plan, step) : null,
    inventoryStatus,
    candidates,
    primaryCandidate,
    primaryKey,
    needAsset: needAsset ?? null,
  };
}

export function resolvePrepCandidates(
  snapshot: ArbPlanLegPrepView | null | undefined,
  fallbackCandidate: QuoterAwareCandidate | null,
): {
  primaryCandidate: QuoterAwareCandidate | null;
  candidates: QuoterAwareCandidate[];
  primaryKey: string | null;
} {
  const map = new Map<string, QuoterAwareCandidate>();
  const push = (candidate: QuoterAwareCandidate | null | undefined) => {
    if (!candidate) return;
    map.set(candidateSignature(candidate), candidate);
  };
  push(snapshot?.candidate ?? null);
  (snapshot?.candidates ?? []).forEach((candidate) => push(candidate));
  push(fallbackCandidate);

  let primaryCandidate: QuoterAwareCandidate | null =
    Array.from(map.values()).find((candidate) => candidateInventoryStatus(candidate) !== "short") ??
    snapshot?.candidate ??
    fallbackCandidate ??
    null;

  if (!primaryCandidate && map.size > 0) {
    primaryCandidate = map.values().next().value ?? null;
  }

  const primaryKey = primaryCandidate ? candidateSignature(primaryCandidate) : null;
  if (primaryCandidate && primaryKey && !map.has(primaryKey)) {
    map.set(primaryKey, primaryCandidate);
  }

  return {
    primaryCandidate,
    candidates: Array.from(map.values()),
    primaryKey,
  };
}

export function filterStepsByFlavor(steps: ArbPlanStep[], selectedFlavor: ClipFlavor | null): ArbPlanStep[] {
  if (!selectedFlavor) return steps;
  const filtered = steps.filter((step) => matchesFlavorSelection(step, selectedFlavor));
  return filtered.length > 0 ? filtered : steps;
}

export function matchesFlavorSelection(step: ArbPlanStep, selectedFlavor: ClipFlavor | null): boolean {
  if (!step.flavor) return true;
  if (step.flavor === "bridge") return true;
  if (!selectedFlavor) return true;
  return step.flavor === selectedFlavor;
}

export function pickClosePrep(steps: ArbPlanStep[], flavor: ClipFlavor | null): ArbPlanStep | null {
  const candidates = steps.filter((step) => step.prepSegment?.kind === "close_native" || step.prepSegment?.kind === "close_cex");
  if (candidates.length === 0) return null;
  if (!flavor) return candidates[0] ?? null;
  const preferredKind = flavor === "native" ? "close_native" : "close_cex";
  return candidates.find((step) => step.prepSegment?.kind === preferredKind) ?? candidates[0] ?? null;
}

export function describeInventoryStatusMeta(status: PathInventoryStatus): { text: string; color: string } {
  switch (status) {
    case "prepped":
      return { text: "Prepped", color: "#16c784" };
    case "covered":
      return { text: "Covered", color: "#4fd1c5" };
    case "short":
      return { text: "Shortfall", color: "#f45b69" };
    case "unknown":
    default:
      return { text: "Unknown", color: "#ffc107" };
  }
}

export function describeInventorySource(source: string): string {
  switch (source) {
    case "evm":
      return "EVM";
    case "evm:native":
      return "EVM native";
    case "paper:mexc":
      return "Paper · MEXC";
    case "paper:zephyr":
      return "Paper · Zephyr";
    default:
      return source;
  }
}

export function describeNativeBasis(rate: number | null, spot: number | null, movingAverage: number | null): string | null {
  if (rate == null || rate <= 0) return null;
  const approx = (candidate: number | null) =>
    candidate != null &&
    candidate > 0 &&
    Math.abs(candidate - rate) <= Math.max(Math.abs(candidate), Math.abs(rate)) * 1e-6;
  if (approx(spot) && approx(movingAverage)) return "spot/ma";
  if (approx(spot)) return "spot";
  if (approx(movingAverage)) return "ma";
  return null;
}

export function candidateSignature(candidate: QuoterAwareCandidate): string {
  const pathAssets = Array.isArray(candidate.path.assets) ? candidate.path.assets.join(">") : "";
  return `${candidate.source}|${pathAssets}|${candidate.amountIn.toString()}`;
}

export function candidateInventoryStatus(candidate: QuoterAwareCandidate | null | undefined): PathInventoryStatus | null {
  if (!candidate) return null;
  return candidate.evaluation.inventory?.status ?? candidate.evaluation.score.inventoryStatus ?? null;
}

export function renderCandidateTitle(candidate: QuoterAwareCandidate, hopCount: number): string {
  const start = candidate.source;
  const pathAssets = Array.isArray(candidate.path.assets) ? candidate.path.assets : [];
  const target = pathAssets[pathAssets.length - 1] ?? start;
  const hopLabel = hopCount === 1 ? "hop" : "hops";
  return `${start} → ${target} (${hopCount} ${hopLabel})`;
}

export function describeShortfall(evaluation: PathEvaluation): string | null {
  const status = evaluation.inventory?.status ?? evaluation.score.inventoryStatus;
  if (status !== "short") return null;
  const shortfalls = evaluation.inventory?.shortfalls ?? [];
  if (shortfalls.length === 0) return "Shortfall";
  const first = shortfalls[0];
  if (first && Number.isFinite(first.shortfall)) {
    const formatted = formatNumber(first.shortfall, Math.abs(first.shortfall) >= 1 ? 2 : 4);
    return `Short ${formatted} ${first.asset}`;
  }
  const total = shortfalls.reduce((sum, entry) => sum + (entry.shortfall ?? 0), 0);
  if (Number.isFinite(total) && total > 0) {
    return `Short ${formatNumber(total, total >= 1 ? 2 : 4)}`;
  }
  return "Shortfall";
}

export function describeNeedVsInventory(
  evaluation: PathEvaluation,
  asset: AssetId | null,
): { available: number | null; shortfall: number | null; status: PathInventoryStatus } {
  const status = evaluation.inventory?.status ?? evaluation.score.inventoryStatus ?? "unknown";
  if (!asset) return { available: null, shortfall: null, status };
  const shortfallEntry = evaluation.inventory?.shortfalls?.find((entry) => entry.asset === asset) ?? null;
  const deltaEntry = evaluation.assetDeltas?.find((entry) => entry.asset === asset) ?? null;
  const available = shortfallEntry?.startingBalance ?? deltaEntry?.startingBalance ?? null;
  const shortfall = shortfallEntry?.shortfall ?? null;
  return { available, shortfall, status: shortfall ? "short" : status };
}

export function unitsToDecimal(amount: bigint | null | undefined, asset: AssetId | null | undefined): number | null {
  if (amount == null || asset == null) return null;
  try {
    const decimals = assetDecimals(asset);
    if (decimals <= 0) return Number(amount);
    const divisor = 10 ** decimals;
    const numeric = Number(amount) / divisor;
    if (Number.isFinite(numeric)) return numeric;
    return parseFloat(amount.toString()) / divisor;
  } catch {
    return null;
  }
}

export const STABLE_ASSETS = new Set(["WZSD.e", "ZSD.n", "USDT.e", "USDT.x", "ZSD", "USDT"]);

export function isStableAsset(asset: string | null | undefined): boolean {
  if (!asset) return false;
  return STABLE_ASSETS.has(asset) || STABLE_ASSETS.has(stripVariantSuffix(asset));
}

export const STAGE_LABELS: Record<string, string> = {
  inventory: "Inventory",
  preparation: "Preparation",
  execution: "Execution",
  settlement: "Settlement",
  realisation: "Realisation",
};
