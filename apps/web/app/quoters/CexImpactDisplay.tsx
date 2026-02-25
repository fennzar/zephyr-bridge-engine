import type { QuoteCexImpact } from "@/types/api";
import { valueArrow, formatBpsLabel } from "./quoters.helpers";

function renderWarnings(warnings?: string[]) {
  if (!warnings?.length) return null;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Warnings</div>
      <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.8 }}>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

export function CexImpactDisplay({ impact }: { impact?: QuoteCexImpact | null }) {
  if (!impact) return null;

  const title = impact.market ? `CEX Impact (${impact.market})` : "CEX Impact";
  const sideLabel = impact.side ? impact.side.toUpperCase() : "\u2014";
  const priceImpact = formatBpsLabel(impact.priceImpactBps);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>Side</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{sideLabel}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>Price</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {valueArrow(impact.priceBefore ?? null, impact.priceAfter ?? null)}
            {priceImpact ? (
              <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>{priceImpact}</span>
            ) : null}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>Average fill</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.averageFillPrice ?? "\u2014"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ opacity: 0.75 }}>Gross notional</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.grossNotional ?? "\u2014"}</span>
        </div>
        {impact.netNotional ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>Net notional</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.netNotional}</span>
          </div>
        ) : null}
        {impact.feeNotional ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>Fees</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.feeNotional}</span>
          </div>
        ) : null}
        {impact.depthLevelsUsed != null ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ opacity: 0.75 }}>Depth levels used</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{impact.depthLevelsUsed}</span>
          </div>
        ) : null}
      </div>
      {impact.warnings && impact.warnings.length > 0 ? renderWarnings(impact.warnings) : null}
    </div>
  );
}
