import type { PoolOverview } from "@services/evm/uniswapV4";
import { formatCurrency, formatNumber } from "@shared/format";

export function AssetPoolsTable({ pools }: { pools: PoolOverview[] }) {
  if (!pools.length) {
    return (
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10,
          padding: 16,
          fontSize: 13,
          opacity: 0.75,
          background: "#0f1621",
        }}
      >
        No wrapped pools discovered yet.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 580,
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 13,
          background: "#0f1621",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10,
        }}
      >
        <thead>
          <tr style={{ textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11, opacity: 0.65 }}>
            <th style={{ textAlign: "left", padding: "10px 12px" }}>Pool</th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>Price</th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>TVL (USD)</th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>Active Positions</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr key={pool.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <td style={{ padding: "12px" }}>
                <div style={{ fontWeight: 600 }}>
                  {pool.base.symbol}/{pool.quote.symbol}
                </div>
                <div style={{ fontSize: 11, opacity: 0.55 }}>{pool.id}</div>
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {pool.lastPrice != null ? formatNumber(pool.lastPrice, 4) : "—"}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>{formatCurrency(pool.tvlUsd ?? Number.NaN)}</td>
              <td style={{ padding: "12px", textAlign: "right" }}>{pool.activePositions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
