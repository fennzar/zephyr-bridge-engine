import type { ReactNode } from "react";

import { AssetBadge } from "@/components/AssetBadge";
import { toFiniteNumber } from "@shared/format";

import type { ClipSearchIterationResponse, } from "./clipExplorer.types";
import {
  computeBpsChange,
  formatBps,
} from "./clipExplorer.helpers";

type TableRow = {
  key: string;
  iterationLabel: string;
  clipAmount: number | null;
  clipDelta: number | null;
  purchasedAmount: number | null;
  poolPrice: number | null;
  counterPrice: number | null;
  priceGap: number | null;
  priceGapBps: number | null;
  target: number | null;
  targetGapBps: number | null;
  highlight: boolean;
};

export function SearchLog({
  entries,
  initialPoolPrice,
  referencePrice,
  targetPrice,
  clipAsset,
  purchasedAsset,
}: {
  entries: ClipSearchIterationResponse[];
  initialPoolPrice?: number | null;
  referencePrice?: number | null;
  targetPrice?: number | null;
  clipAsset?: string | null;
  purchasedAsset?: string | null;
}) {
  if (entries.length === 0) return null;

  const formatNumber = (value: number | string | null | undefined, digits = 6) => {
    const numeric = toFiniteNumber(value);
    if (numeric == null) return "—";
    return numeric.toFixed(digits);
  };

  const formatAmount = (value: number | string | null | undefined) => {
    const numeric = toFiniteNumber(value);
    if (numeric == null) return "—";
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  const formatClipDelta = (value: number | string | null | undefined) => {
    const numeric = toFiniteNumber(value);
    if (numeric == null) return "—";
    if (Math.abs(numeric) < 1e-9) return "\u2248 0";
    const symbol = numeric > 0 ? "\u2191" : "\u2193";
    return `${symbol} ${Math.abs(numeric).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  };

  const clipHeader: ReactNode = clipAsset ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      Clip
      <AssetBadge asset={clipAsset} />
    </span>
  ) : (
    "Clip amount"
  );
  const purchasedHeader: ReactNode = purchasedAsset ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      Open fill
      <AssetBadge asset={purchasedAsset} />
    </span>
  ) : (
    "Open fill"
  );

  const finalIteration = entries[entries.length - 1]?.iteration;

  const rows: TableRow[] = [];

  if (initialPoolPrice != null || referencePrice != null) {
    const initialPriceGap =
      initialPoolPrice != null && referencePrice != null ? initialPoolPrice - referencePrice : null;
    const initialGapBps = computeBpsChange(referencePrice ?? null, initialPoolPrice ?? null);
    const initialTargetGapBps = computeBpsChange(targetPrice ?? null, initialPoolPrice ?? null);
    rows.push({
      key: "initial",
      iterationLabel: "Start",
      clipAmount: 0,
      clipDelta: null,
      purchasedAmount: 0,
      poolPrice: initialPoolPrice ?? null,
      counterPrice: referencePrice ?? null,
      priceGap: initialPriceGap,
      priceGapBps: initialGapBps,
      target: targetPrice ?? null,
      targetGapBps: initialTargetGapBps,
      highlight: false,
    });
  }

  entries.forEach((entry, index) => {
    const previous = index > 0 ? entries[index - 1] : null;
    const clipDelta = previous ? entry.amountDecimal - previous.amountDecimal : entry.amountDecimal;
    const priceGap =
      entry.priceGap ??
      (entry.poolPriceAfter != null && entry.counterPriceAfter != null
        ? entry.poolPriceAfter - entry.counterPriceAfter
        : null);
    const priceGapBps =
      entry.priceDiffBps ??
      (entry.counterPriceAfter != null && entry.poolPriceAfter != null
        ? computeBpsChange(entry.counterPriceAfter, entry.poolPriceAfter)
        : null);
    const targetGapBps =
      entry.targetDiffBps ??
      (entry.targetPrice != null && entry.poolPriceAfter != null
        ? computeBpsChange(entry.targetPrice, entry.poolPriceAfter)
        : null);

    rows.push({
      key: `iter-${entry.iteration}`,
      iterationLabel: entry.iteration.toString(),
      clipAmount: entry.amountDecimal,
      clipDelta,
      purchasedAmount: entry.openAmountOutDecimal ?? null,
      poolPrice: entry.poolPriceAfter,
      counterPrice: entry.counterPriceAfter,
      priceGap,
      priceGapBps,
      target: entry.targetPrice ?? null,
      targetGapBps,
      highlight: false,
    });
  });

  const bestRowKey = rows
    .filter((row) => row.priceGap != null)
    .sort((a, b) => Math.abs(a.priceGap as number) - Math.abs(b.priceGap as number))[0]?.key;

  if (bestRowKey) {
    rows.forEach((row) => {
      row.highlight = row.key === bestRowKey;
    });
  }

  return (
    <details
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 12,
        background: "rgba(9,14,22,0.6)",
      }}
    >
      <summary
        style={{
          textTransform: "uppercase",
          fontSize: 12,
          letterSpacing: 0.6,
          opacity: 0.75,
          cursor: "pointer",
        }}
      >
        Calibration search log {finalIteration != null ? `(iterations: ${finalIteration})` : null}
      </summary>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {initialPoolPrice != null && Number.isFinite(initialPoolPrice) ? (
          <InfoTile label="Starting pool price" value={formatNumber(initialPoolPrice, 6)} tone="blue" />
        ) : null}
        {referencePrice != null && Number.isFinite(referencePrice) ? (
          <InfoTile label="Starting close price" value={formatNumber(referencePrice, 6)} tone="green" />
        ) : null}
        {targetPrice != null && Number.isFinite(targetPrice) ? (
          <InfoTile label="Calibrated target" value={formatNumber(targetPrice, 6)} tone="amber" />
        ) : null}
      </div>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 11,
            minWidth: 640,
          }}
        >
          <thead>
            <tr style={{ textAlign: "right", opacity: 0.6 }}>
              <th style={{ textAlign: "left", padding: "0 6px" }}>Iter</th>
              <th style={{ padding: "0 6px" }}>{clipHeader}</th>
              <th style={{ padding: "0 6px" }}>{"\u0394"} Clip</th>
              <th style={{ padding: "0 6px" }}>{purchasedHeader}</th>
              <th style={{ padding: "0 6px" }}>Pool price</th>
              <th style={{ padding: "0 6px" }}>Close price</th>
              <th style={{ padding: "0 6px" }}>Pool {"\u2212"} close</th>
              <th style={{ padding: "0 6px" }}>Gap (bps)</th>
              <th style={{ padding: "0 6px" }}>Target</th>
              <th style={{ padding: "0 6px" }}>Target gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const gapTone =
                row.priceGap == null
                  ? undefined
                  : row.priceGap > 0
                    ? "rgba(239,68,68,0.85)"
                    : row.priceGap < 0
                      ? "rgba(34,197,94,0.85)"
                      : "rgba(148,163,184,0.85)";
              const rowHighlight = row.highlight ? "rgba(59,130,246,0.15)" : "transparent";

              return (
                <tr
                  key={row.key}
                  style={{
                    textAlign: "right",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    background: rowHighlight,
                  }}
                >
                  <td style={{ textAlign: "left", padding: "6px" }}>{row.iterationLabel}</td>
                  <td style={{ padding: "6px" }}>{formatAmount(row.clipAmount)}</td>
                  <td style={{ padding: "6px", color: "rgba(148,163,184,0.9)" }}>{formatClipDelta(row.clipDelta)}</td>
                  <td style={{ padding: "6px" }}>{formatAmount(row.purchasedAmount)}</td>
                  <td style={{ padding: "6px" }}>{formatNumber(row.poolPrice, 6)}</td>
                  <td style={{ padding: "6px" }}>{formatNumber(row.counterPrice, 6)}</td>
                  <td style={{ padding: "6px", color: gapTone }}>{formatNumber(row.priceGap, 6)}</td>
                  <td style={{ padding: "6px", color: gapTone }}>{formatBps(row.priceGapBps)}</td>
                  <td style={{ padding: "6px" }}>{formatNumber(row.target, 6)}</td>
                  <td style={{ padding: "6px" }}>{formatBps(row.targetGapBps)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, fontSize: 10, opacity: 0.6 }}>
        Positive gaps mean the pool ended richer than the close venue; negative gaps indicate the close venue is still
        richer. The initial row shows the pre-trade state (clip size 0), and the highlighted row marks the final solver
        sample.
      </p>
    </details>
  );
}

export function InfoTile({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "amber" }) {
  const palette =
    tone === "blue"
      ? { background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)" }
      : tone === "green"
        ? { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)" }
        : { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)" };
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        background: palette.background,
        border: palette.border,
        display: "grid",
        gap: 2,
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}
