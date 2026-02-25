import type { ClipSearchIteration } from "@domain/arbitrage/clip.types";
import { toFiniteNumber } from "@shared/format";

export function ClipSearchLog({
  entries,
  clipAsset,
  purchasedAsset,
}: {
  entries: ClipSearchIteration[];
  clipAsset: string | null;
  purchasedAsset: string | null;
}) {
  return (
    <div style={{ marginTop: 10, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ opacity: 0.6, textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Iter</th>
            <th style={{ padding: "4px 6px" }}>Clip ({clipAsset ?? "clip"})</th>
            <th style={{ padding: "4px 6px" }}>Open fill ({purchasedAsset ?? "fill"})</th>
            <th style={{ padding: "4px 6px" }}>Pool price</th>
            <th style={{ padding: "4px 6px" }}>Counter price</th>
            <th style={{ padding: "4px 6px" }}>Gap (bps)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const clipAmount = toFiniteNumber(entry.amountDecimal);
            const openAmount = toFiniteNumber(entry.openAmountOutDecimal);
            const poolPrice = toFiniteNumber(entry.poolPriceAfter);
            const counterPrice = toFiniteNumber(entry.counterPriceAfter);
            const gap = toFiniteNumber(entry.priceDiffBps);
            return (
              <tr key={`log-${entry.iteration}`} style={{ borderTop: "1px solid rgba(148,163,184,0.12)", textAlign: "right" }}>
                <td style={{ padding: "4px 6px", textAlign: "left" }}>{entry.iteration}</td>
                <td style={{ padding: "4px 6px" }}>{clipAmount != null ? clipAmount.toFixed(4) : "—"}</td>
                <td style={{ padding: "4px 6px" }}>{openAmount != null ? openAmount.toFixed(4) : "—"}</td>
                <td style={{ padding: "4px 6px" }}>{poolPrice != null ? poolPrice.toFixed(6) : "—"}</td>
                <td style={{ padding: "4px 6px" }}>{counterPrice != null ? counterPrice.toFixed(6) : "—"}</td>
                <td style={{ padding: "4px 6px" }}>{gap != null ? gap.toFixed(2) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
