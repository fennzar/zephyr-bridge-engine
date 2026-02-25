import type { ReactNode } from "react";

import { AssetBadge, AssetPair } from "@/components/AssetBadge";
import { toFiniteNumber } from "@shared/format";

export type FlowEntry = {
  amount: number | string | null | undefined;
  asset: string | null | undefined;
};

export function renderTokenAmount(value: number | string | null | undefined, asset?: string | null, fractionDigits = 6): ReactNode {
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

export function renderPriceWithPair(value: number | string | null | undefined, base?: string | null, quote?: string | null): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  if (!base || !quote) return numeric.toFixed(6);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{numeric.toFixed(6)}</span>
      <AssetPair base={base} quote={quote} size={14} mode="combined" />
    </span>
  );
}

export function formatRateWithInverse(rate: number | string | null | undefined): ReactNode {
  const numeric = toFiniteNumber(rate);
  if (numeric == null || numeric <= 0) return "—";
  const inverse = numeric !== 0 ? 1 / numeric : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{numeric.toFixed(6)}</span>
      {inverse != null ? <span style={{ opacity: 0.6 }}>{`(${inverse.toFixed(6)})`}</span> : null}
    </span>
  );
}

export function describeNativeBasis(rate: number | null, spot: number | null, movingAverage: number | null): string | null {
  if (rate == null || rate <= 0) return null;
  const approx = (candidate: number | null) =>
    candidate != null && candidate > 0 && Math.abs(candidate - rate) <= Math.max(Math.abs(candidate), Math.abs(rate)) * 1e-6;
  if (approx(spot) && approx(movingAverage)) return "spot/ma";
  if (approx(spot)) return "spot";
  if (approx(movingAverage)) return "ma";
  return null;
}

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
