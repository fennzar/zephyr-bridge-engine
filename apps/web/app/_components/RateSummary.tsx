import type { ReactNode } from "react";
import type { RateDetail } from "@domain/zephyr";
import { formatRateValue } from "../_lib/dashboard-format";

export function renderRateSummary(label: string, rate: RateDetail, decimals = 4): ReactNode {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ opacity: 0.65, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          opacity: 0.85,
        }}
      >
        <span>spot {formatRateValue(rate.spot, decimals)}</span>
        <span>ma {formatRateValue(rate.movingAverage, decimals)}</span>
        <span>mint {formatRateValue(rate.mint, decimals)}</span>
        <span>redeem {formatRateValue(rate.redeem, decimals)}</span>
      </div>
    </div>
  );
}

export function renderUsdSpot(label: string, spot: number, decimals = 4): ReactNode {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ opacity: 0.65, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          opacity: 0.85,
        }}
      >
        <span>spot {formatRateValue(spot, decimals)}</span>
      </div>
    </div>
  );
}
