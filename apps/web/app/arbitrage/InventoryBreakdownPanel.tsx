import type { InventoryRequirement } from "@domain/arbitrage/types.plan";
import type { InventoryApiResponse } from "@domain/inventory/types.api";
import { formatNumber } from "@shared/format";
import {
  buildInventoryBreakdown,
  formatMaybeNumber,
  describeInventorySource,
} from "./PlanCard.helpers";

export function renderInventoryDetails(details: InventoryRequirement[], snapshot: InventoryApiResponse | null) {
  if (!details || details.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.75 }}>No specific inventory requirements.</div>;
  }
  const breakdown = buildInventoryBreakdown(details, snapshot);
  if (breakdown.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.75 }}>No specific inventory requirements.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {breakdown.map((group) => (
        <div
          key={`inventory-group-${group.assetKey}`}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            padding: "8px 10px",
            background: "rgba(16,23,32,0.7)",
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span>
              {group.assetKey} · Need {formatNumber(group.totalRequired, 4)}
              {group.totalAvailable != null ? ` · Have ${formatNumber(group.totalAvailable, 4)}` : ""}
            </span>
            <span style={{ opacity: 0.75 }}>
              {group.totalShortfall != null && group.totalShortfall > 0 ? (
                <span style={{ color: "#f45b69" }}>Shortfall {formatNumber(group.totalShortfall, 4)}</span>
              ) : group.totalShortfall != null ? (
                <span style={{ color: "#16c784" }}>Covered</span>
              ) : (
                <span>Availability unknown</span>
              )}
            </span>
          </div>
          {group.inventoryTotal != null ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Inventory total: {formatNumber(group.inventoryTotal, 4)}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 4 }}>
            {group.variants.map((variant) => (
              <div
                key={`inventory-${group.assetKey}-${variant.assetId}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  background: "rgba(12,18,26,0.6)",
                  display: "grid",
                  gap: 2,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>
                    <strong>{variant.assetId}</strong>
                    {variant.label ? ` · ${variant.label}` : ""}
                  </span>
                  <span style={{ opacity: 0.75 }}>{describeInventorySource(variant.source)}</span>
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.8 }}>
                  Need {formatNumber(variant.required, 4)} · Have {formatMaybeNumber(variant.available)}
                  {variant.shortfall != null ? (
                    variant.shortfall > 0 ? (
                      <span style={{ color: "#f45b69" }}>{` · Shortfall ${formatNumber(variant.shortfall, 4)}`}</span>
                    ) : (
                      <span style={{ color: "#16c784" }}> · Covered</span>
                    )
                  ) : (
                    <span> · Availability unknown</span>
                  )}
                  {variant.inventoryAmount != null ? (
                    <span style={{ opacity: 0.7 }}>{` · Inventory ${formatNumber(variant.inventoryAmount, 4)}`}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
