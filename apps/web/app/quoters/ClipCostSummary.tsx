import { formatCurrency as formatUsd } from "@shared/format";

import type { CostEntry } from "./clipExplorer.types";
import { renderTokenAmount } from "./clipExplorer.helpers";

export function CostSummary({
  costEntries,
  totalFeesUsd,
  totalGasUsd,
  totalCostUsd,
  estimatedProfitUsd,
  notes,
}: {
  costEntries: CostEntry[];
  totalFeesUsd: number;
  totalGasUsd: number;
  totalCostUsd: number;
  estimatedProfitUsd: number | null;
  notes: string[];
}) {
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        {costEntries.map((entry, entryIndex) => (
          <div
            key={`${entry.label}-${entryIndex}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: "1px solid rgba(148,163,184,0.08)",
              paddingBottom: 6,
            }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>{entry.label}</span>
              {entry.asset ? <span style={{ opacity: 0.6, fontSize: 11 }}>{entry.asset}</span> : null}
              <span style={{ opacity: 0.6, fontSize: 11 }}>{entry.source}</span>
            </div>
            <div style={{ textAlign: "right", display: "grid", gap: 2 }}>
              <span>{renderTokenAmount(entry.amount, entry.asset, 8)}</span>
              <span>{entry.usdAmount != null ? formatUsd(-entry.usdAmount) : ""}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Total fees</span>
          <span>{formatUsd(-totalFeesUsd)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Total gas</span>
          <span>{formatUsd(-totalGasUsd)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
          <span>Total execution cost</span>
          <span>{formatUsd(-totalCostUsd)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
          <span>Estimated profit</span>
          <span>{estimatedProfitUsd != null ? formatUsd(estimatedProfitUsd) : "—"}</span>
        </div>
        {notes.length > 0 ? <div style={{ opacity: 0.6 }}>{notes.join("; ")}</div> : null}
      </div>
    </>
  );
}
