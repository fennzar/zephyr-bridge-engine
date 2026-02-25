"use client";

import { useMemo } from "react";
import { colors, styles } from "@/components/theme";
import { formatUsd } from "@/components/format";
import type { DepthLevel } from "@/types/api";
import { maxNotional, buildOrderBookRows } from "./mexc.helpers";

export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div
      style={{
        width: `${width}%`,
        background: color,
        height: 8,
        borderRadius: 4,
      }}
    />
  );
}

export function OrderBook({ bids, asks }: { bids: DepthLevel[]; asks: DepthLevel[] }) {
  const maxBidNotional = maxNotional(bids);
  const maxAskNotional = maxNotional(asks);
  const bidRows = useMemo(() => buildOrderBookRows(bids, "bid", 10), [bids]);
  const askRows = useMemo(() => buildOrderBookRows(asks, "ask", 10), [asks]);

  return (
    <section style={{ ...styles.section, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Order Book</div>
        <div style={{ fontSize: 12, color: colors.text.dimmed }}>Top 10 levels per side</div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: colors.text.dimmed, marginBottom: 6 }}>Bids</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "80px 70px 90px 90px 110px 1fr",
              ...styles.tableHeader,
              marginBottom: 4,
            }}
          >
            <span>Price</span>
            <span>Qty</span>
            <span>Lvl USD</span>
            <span>Cum Qty</span>
            <span>Cum USDT</span>
            <span />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {bidRows.map((row, idx) => (
              <div
                key={`bid-${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 70px 90px 90px 110px 1fr",
                  gap: 8,
                  alignItems: "center",
                  fontFamily: "ui-monospace",
                  fontSize: 13,
                }}
              >
                <span style={{ color: colors.accent.green }}>{row.price.toFixed(4)}</span>
                <span>{row.qty.toFixed(2)}</span>
                <span>{formatUsd(row.notional)}</span>
                <span>{row.cumQty.toFixed(2)}</span>
                <span>{formatUsd(row.cumNotional)}</span>
                <Bar value={row.notional} max={maxBidNotional} color={colors.accent.greenBg} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.text.dimmed, marginBottom: 6 }}>Asks</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "80px 70px 90px 90px 110px 1fr",
              ...styles.tableHeader,
              marginBottom: 4,
            }}
          >
            <span>Price</span>
            <span>Qty</span>
            <span>Lvl USD</span>
            <span>Cum Qty</span>
            <span>Cum USDT</span>
            <span />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {askRows.map((row, idx) => (
              <div
                key={`ask-${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 70px 90px 90px 110px 1fr",
                  gap: 8,
                  alignItems: "center",
                  fontFamily: "ui-monospace",
                  fontSize: 13,
                }}
              >
                <span style={{ color: colors.accent.orange }}>{row.price.toFixed(4)}</span>
                <span>{row.qty.toFixed(2)}</span>
                <span>{formatUsd(row.notional)}</span>
                <span>{row.cumQty.toFixed(2)}</span>
                <span>{formatUsd(row.cumNotional)}</span>
                <Bar value={row.notional} max={maxAskNotional} color={colors.accent.orangeBg} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
