import type { ReactNode } from "react";

import { AssetBadge, AssetPair, stripVariantSuffix } from "@/components/AssetBadge";
import { toFiniteNumber } from "@shared/format";

import type {
  CandidatePathInfo,
  ClipExecutionResponse,
  ClipOptionResponse,
  CostEntry,
  InventoryDelta,
  InventoryGroup,
  MutableInventoryGroup,
} from "./clipExplorer.types";

export function buildReferenceLabel(execution: ClipExecutionResponse | null | undefined): string | null {
  if (!execution) return null;
  const baseLabel =
    execution.referenceLabel ??
    (execution.nativeRateMode
      ? `Native ${execution.nativeRateMode === "mint" ? "mint" : "redeem"} rate`
      : execution.flavor === "cex"
        ? "CEX reference"
        : execution.flavor === "open"
          ? "Pool price"
          : null);
  if (!baseLabel) return null;
  if (execution.nativeRateBasisLabel) {
    return `${baseLabel} · ${execution.nativeRateBasisLabel}`;
  }
  return baseLabel;
}

export function renderTokenAmount(
  value: number | string | null | undefined,
  asset?: string | null,
  fractionDigits = 6,
): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  const formatted = numeric.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>{formatted}</span>
      {asset ? <AssetBadge asset={asset} /> : null}
    </span>
  );
}

export function renderSignedTokenAmount(
  value: number | string | null | undefined,
  asset?: string | null,
  fractionDigits = 6,
): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  const absValue = Math.abs(numeric);
  const magnitude = absValue.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  const sign = numeric > 0 ? "+" : numeric < 0 ? "−" : "";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>{`${sign}${magnitude}`}</span>
      {asset ? <AssetBadge asset={asset} /> : null}
    </span>
  );
}

export function renderHint(parts: Array<ReactNode | null | undefined>): ReactNode | null {
  const filtered = parts.filter(Boolean) as ReactNode[];
  if (filtered.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {filtered.map((part, index) => (
        <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {part}
          {index < filtered.length - 1 ? <span style={{ opacity: 0.35 }}>·</span> : null}
        </span>
      ))}
    </span>
  );
}

export type FlowEntry = {
  amount: number | string | null | undefined;
  asset: string | null;
};

export function renderFlowEntries(entries: FlowEntry[]): ReactNode {
  const unique = new Map<string, FlowEntry>();
  entries.forEach((entry) => {
    if (!entry.asset || entry.amount == null) return;
    const key = `${entry.asset}-${entry.amount}`;
    if (!unique.has(key)) unique.set(key, entry);
  });
  const visible = Array.from(unique.values());
  if (visible.length === 0) {
    return <span style={{ opacity: 0.6 }}>—</span>;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {visible.map((entry, index) => (
        <span key={`${entry.asset}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {renderTokenAmount(entry.amount, entry.asset)}
        </span>
      ))}
    </div>
  );
}

export function formatPrice(value: number | string | null | undefined, fractionDigits = 6): string {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  return numeric.toFixed(fractionDigits);
}

export function renderPriceWithPair(
  value: number | string | null | undefined,
  base?: string | null,
  quote?: string | null,
  fractionDigits = 6,
): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  const formatted = numeric.toFixed(fractionDigits);
  if (!base || !quote) return formatted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>{formatted}</span>
      <AssetPair base={base} quote={quote} size={14} mode="combined" />
    </span>
  );
}

export function formatBps(value: number | string | null | undefined): string {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  const signed = numeric >= 0 ? `+${numeric.toFixed(3)}` : numeric.toFixed(3);
  return `${signed} bps`;
}

export function describeNativeBasis(rate: number | null, spot: number | null, movingAverage: number | null): string | null {
  if (rate == null || rate <= 0) return null;
  const isApprox = (candidate: number | null) => {
    if (candidate == null || candidate <= 0) return false;
    const tolerance = Math.max(Math.abs(candidate), Math.abs(rate)) * 1e-6;
    return Math.abs(candidate - rate) <= tolerance;
  };
  if (isApprox(spot) && isApprox(movingAverage)) return "spot/ma";
  if (isApprox(spot)) return "spot";
  if (isApprox(movingAverage)) return "ma";
  return null;
}

export function formatRateWithInverse(rate: number | null): ReactNode {
  if (rate == null || rate <= 0) return "—";
  const inverse = rate !== 0 ? 1 / rate : null;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span>{formatPrice(rate)}</span>
      {inverse != null ? <span style={{ opacity: 0.6 }}>{`(${formatPrice(inverse)})`}</span> : null}
    </span>
  );
}

export function deriveCandidateSourceAsset(candidate: Record<string, unknown> | null): string | null {
  if (!candidate) return null;
  const path = (candidate as { path?: Record<string, unknown> }).path;
  const assets = Array.isArray(path?.assets) ? (path?.assets as string[]) : [];
  return assets.length > 0 ? assets[0] : null;
}

export function deriveCandidateTerminalAsset(candidate: Record<string, unknown> | null): string | null {
  if (!candidate) return null;
  const path = (candidate as { path?: Record<string, unknown> }).path;
  const assets = Array.isArray(path?.assets) ? (path?.assets as string[]) : [];
  return assets.length > 0 ? assets[assets.length - 1] : null;
}

export function buildPairLabelFromAssets(base?: string | null, quote?: string | null): string | null {
  if (!base || !quote) return null;
  return `${base}/${quote}`;
}

export function extractCandidatePath(
  candidate: Record<string, unknown> | null,
  fallbackFrom?: string | null,
  fallbackTo?: string | null,
): CandidatePathInfo {
  const path = (candidate as { path?: Record<string, unknown> })?.path;
  const assets = Array.isArray(path?.assets) ? (path?.assets as string[]) : [];
  const steps = Array.isArray(path?.steps)
    ? (path?.steps as Array<{ op?: string | null; venue?: string | null }>)
    : [];

  const normalizedAssets =
    assets.length > 0
      ? assets
      : [fallbackFrom ?? null, fallbackTo ?? null].filter((asset): asset is string => Boolean(asset));

  const requiredSteps = Math.max(0, normalizedAssets.length - 1);
  const normalizedSteps = [...steps].slice(0, requiredSteps);
  while (normalizedSteps.length < requiredSteps) {
    normalizedSteps.push({});
  }

  return { assets: normalizedAssets, steps: normalizedSteps };
}

export function extractCandidateSource(candidate: Record<string, unknown> | null): string | null {
  if (!candidate) return null;
  const source = (candidate as { source?: unknown }).source;
  return typeof source === "string" ? source : null;
}

export function buildInventorySummary(option: ClipOptionResponse): InventoryGroup[] {
  const groups = new Map<string, MutableInventoryGroup>();

  const pushEntry = (entry: InventoryDelta) => {
    const baseAsset = entry.baseAsset;
    const group = groups.get(baseAsset) ?? {
      asset: baseAsset,
      totalAmount: 0,
      totalUsdChange: 0,
      hasUsd: false,
      entries: [],
    };
    group.entries.push(entry);
    group.totalAmount = (group.totalAmount ?? 0) + entry.amount;
    if (entry.usdChange != null) {
      group.totalUsdChange += entry.usdChange;
      group.hasUsd = true;
    }
    groups.set(baseAsset, group);
  };

  const accumulate = (
    execution: ClipExecutionResponse | null | undefined,
    context: string,
  ) => {
    const deltas = execution?.evaluation && Array.isArray((execution.evaluation as { assetDeltas?: unknown }).assetDeltas)
      ? (execution.evaluation as { assetDeltas?: Array<Record<string, unknown>> }).assetDeltas || []
      : [];

    for (const delta of deltas) {
      const assetId = typeof delta.asset === "string" ? delta.asset : null;
      if (!assetId) continue;

      const amount = toFiniteNumber(delta.amountDecimal);
      if (amount == null) continue;

      const usd = toFiniteNumber(delta.usdChange);
      const usdPrice = toFiniteNumber(delta.usdPrice);
      const baseVariant = stripVariantSuffix(assetId);
      const baseAsset = canonicalAssetSymbol(baseVariant);
      const entry: InventoryDelta = {
        assetId,
        baseAsset,
        amount,
        usdChange: usd,
        usdPrice,
        source: context,
      };
      pushEntry(entry);
    }

    const gasEntry = buildGasInventoryEntry(execution, context ? `Gas · ${context}` : "Gas");
    if (gasEntry) {
      pushEntry(gasEntry);
    }
  };

  accumulate(option.open.execution, "Open execution");
  accumulate(option.close.execution, option.close.execution ? `Close execution · ${option.flavor}` : `Close execution`);

  return Array.from(groups.values()).map((group) => ({
    asset: group.asset,
    totalAmount: group.totalAmount,
    totalUsdChange: group.hasUsd ? group.totalUsdChange : null,
    entries: group.entries,
  }));
}

export function sumTradeUsdChanges(groups: InventoryGroup[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const group of groups) {
    for (const entry of group.entries) {
      const source = entry.source?.toLowerCase() ?? "";
      if (entry.usdChange != null && !source.startsWith("gas")) {
        total += entry.usdChange;
        hasValue = true;
      }
    }
  }
  return hasValue ? total : null;
}

export function sumCapitalUsage(groups: InventoryGroup[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const group of groups) {
    for (const entry of group.entries) {
      const source = entry.source?.toLowerCase() ?? "";
      if (entry.usdChange != null && entry.usdChange < 0 && !source.startsWith("gas")) {
        total += Math.abs(entry.usdChange);
        hasValue = true;
      }
    }
  }
  return hasValue ? total : null;
}

export function canonicalAssetSymbol(symbol: string): string {
  if (symbol.startsWith("WZ") && symbol.length > 2) {
    const candidate = symbol.slice(1);
    if (/^[A-Z]+$/.test(candidate)) {
      return candidate;
    }
  }
  return symbol;
}

export function buildGasInventoryEntry(
  execution: ClipExecutionResponse | null | undefined,
  source?: string,
): InventoryDelta | null {
  if (!execution?.evaluation) return null;
  const evaluation = execution.evaluation as Record<string, unknown>;
  const score = evaluation.score as Record<string, unknown> | undefined;
  if (!score) return null;

  const gasUsd = toFiniteNumber(score.totalGasUsd);
  const gasWei = toBigIntValue(score.totalGasWei);
  if ((gasUsd == null || gasUsd === 0) && (gasWei == null || gasWei === 0n)) {
    return null;
  }

  let amountDecimal = 0;
  if (gasWei != null) {
    amountDecimal = Number(gasWei) / 1e18;
  }
  const usdChange = gasUsd != null ? -gasUsd : null;
  const signedAmount = -amountDecimal;
  const usdPrice = amountDecimal !== 0 && usdChange != null ? Math.abs(usdChange) / Math.abs(amountDecimal) : null;

  return {
    assetId: "ETH.e",
    baseAsset: "ETH",
    amount: signedAmount,
    usdChange,
    usdPrice,
    source,
  };
}

export function buildCostEntries(option: ClipOptionResponse): CostEntry[] {
  const entries: CostEntry[] = [];

  const accumulate = (execution: ClipExecutionResponse | null, source: string) => {
    if (!execution) return;
    const evaluation = execution.evaluation;
    const fees = evaluation && Array.isArray((evaluation as { feeBreakdown?: unknown }).feeBreakdown)
      ? (evaluation as { feeBreakdown?: Array<Record<string, unknown>> }).feeBreakdown || []
      : [];

    for (const fee of fees) {
      const asset = typeof fee.asset === "string" ? fee.asset : undefined;
      const amount = toFiniteNumber((fee as { amountDecimal?: unknown }).amountDecimal ?? (fee as { amount?: unknown }).amount);
      const usdAmount = toFiniteNumber((fee as { usdAmount?: unknown }).usdAmount);
      entries.push({
        label: asset ?? "Fee",
        asset,
        amount,
        usdAmount,
        source,
        kind: "fee",
      });
    }

    const score = evaluation && typeof evaluation === "object"
      ? (evaluation as { score?: Record<string, unknown> }).score
      : undefined;
    const gasUsd = score ? toFiniteNumber((score as { totalGasUsd?: unknown }).totalGasUsd) : null;
    const gasEntry = buildGasInventoryEntry(execution, `Gas · ${source}`);
    if (gasEntry) {
      entries.push({
        label: "Gas",
        asset: gasEntry.assetId,
        amount: Math.abs(gasEntry.amount),
        usdAmount: gasEntry.usdChange != null ? Math.abs(gasEntry.usdChange) : gasUsd,
        source: gasEntry.source ?? source,
        kind: "gas",
      });
    }
  };

  accumulate(option.open.execution, "Open execution");
  accumulate(option.close.execution, option.close.execution ? `Close execution · ${option.flavor}` : "Close execution");

  return entries;
}

export function sumCostEntries(entries: CostEntry[], kind: CostEntry["kind"]): number {
  return entries.reduce((total, entry) => total + (entry.kind === kind && entry.usdAmount != null ? entry.usdAmount : 0), 0);
}

export function toBigIntValue(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  return null;
}

export function computePercentDiff(reference: number | null | undefined, comparison: number | null | undefined): number | null {
  if (reference == null || comparison == null || reference === 0) return null;
  return ((comparison / reference) - 1) * 100;
}

export function formatPercent(value: number, maximumFractionDigits = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(maximumFractionDigits)}%`;
}

export function computeBpsChange(before: number | null, after: number | null): number | null {
  if (before == null || after == null || before === 0) return null;
  return ((after / before) - 1) * 10_000;
}

export function formatValue(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
    return value.toFixed(abs >= 1 ? 2 : 6);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (value == null) return "—";
  return JSON.stringify(value);
}
