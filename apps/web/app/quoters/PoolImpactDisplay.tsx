import type { QuotePoolImpact } from "@/types/api";
import { valueArrow, formatBpsLabel } from "./quoters.helpers";

export function PoolImpactDisplay({ impact }: { impact?: QuotePoolImpact | null }) {
  if (!impact) return null;

  const pairLabel = impact.baseAsset && impact.quoteAsset
    ? `${impact.baseAsset}/${impact.quoteAsset}`
    : impact.poolKey ?? "Pool";

  const priceImpactLabel = formatBpsLabel(impact.priceImpactBps);

  const baseLabel = `${impact.baseAsset ?? "Base"} reserve`;
  const quoteLabel = `${impact.quoteAsset ?? "Quote"} reserve`;
  const rawPriceRow = impact.priceBeforeRaw || impact.priceAfterRaw;
  const baseDeltaRow = impact.baseDelta != null;
  const quoteDeltaRow = impact.quoteDelta != null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Pool Impact ({pairLabel})</div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>Price</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {valueArrow(impact.priceBefore, impact.priceAfter)}
            {priceImpactLabel ? (
              <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>{priceImpactLabel}</span>
            ) : null}
          </span>
        </div>
        {rawPriceRow ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>Raw price</span>
            {valueArrow(impact.priceBeforeRaw ?? null, impact.priceAfterRaw ?? impact.priceAfterSqrt ?? null)}
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>{baseLabel}</span>
          {valueArrow(impact.baseReserveBefore ?? null, impact.baseReserveAfter ?? null)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>{quoteLabel}</span>
          {valueArrow(impact.quoteReserveBefore ?? null, impact.quoteReserveAfter ?? null)}
        </div>
        {baseDeltaRow ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>{"\u0394"} {impact.baseAsset ?? "Base"}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.baseDelta}</span>
          </div>
        ) : null}
        {quoteDeltaRow ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>{"\u0394"} {impact.quoteAsset ?? "Quote"}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.quoteDelta}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
