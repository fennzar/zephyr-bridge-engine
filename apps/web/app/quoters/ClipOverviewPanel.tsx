import { AssetBadge } from "@/components/AssetBadge";
import type { ClipOptionResponse, OverviewMetric } from "./clipExplorer.types";

function formatDirectionLabel(direction: string): string {
  switch (direction) {
    case "evm_discount":
      return "EVM Discount";
    case "evm_premium":
      return "EVM Premium";
    default:
      return direction;
  }
}

function formatFlavor(flavor: ClipOptionResponse["flavor"]): string {
  return flavor === "native" ? "Native close" : "CEX close";
}

export function ClipOverviewPanel({
  optionLabel,
  asset,
  direction,
  flavor,
  metrics,
}: {
  optionLabel: string;
  asset: string;
  direction: string;
  flavor: ClipOptionResponse["flavor"];
  metrics: OverviewMetric[];
}) {
  const directionLabel = formatDirectionLabel(direction);
  const flavorLabel = formatFlavor(flavor);
  const flavorChipStyle =
    flavor === "native"
      ? { background: "rgba(22,199,132,0.18)", color: "#6fe3b3" }
      : { background: "rgba(88,140,255,0.18)", color: "#9ebdff" };
  const priceMetrics = metrics.filter((metric) => metric.variant === "price" || metric.variant === "price-final");
  const otherMetrics = metrics.filter((metric) => metric.variant !== "price" && metric.variant !== "price-final");

  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 16,
        display: "grid",
        gap: 12,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{optionLabel}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AssetBadge asset={asset} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>{directionLabel}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              background: flavorChipStyle.background,
              color: flavorChipStyle.color,
            }}
          >
            {flavorLabel}
          </span>
        </div>
      </div>

      {priceMetrics.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          }}
        >
          {priceMetrics.map((metric, metricIndex) => {
            const isFinal = metric.variant === "price-final";
            const badgePositionStyle = metric.badgeAlign === "right" ? { right: 12 } : { left: 12 };
            return (
              <div
                key={`${metric.label}-${metricIndex}`}
                style={{
                  border: isFinal ? "1px solid rgba(80,200,255,0.55)" : "1px solid rgba(120,160,255,0.25)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  background: isFinal
                    ? "linear-gradient(135deg, rgba(58,102,160,0.6) 0%, rgba(16,32,54,0.8) 100%)"
                    : "rgba(32,54,88,0.38)",
                  display: "grid",
                  gap: 4,
                  position: "relative",
                }}
              >
                {isFinal ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 12,
                      fontSize: 10,
                      letterSpacing: 0.5,
                      opacity: 0.8,
                      textTransform: "uppercase",
                      color: "#8be7ff",
                    }}
                  >
                    Final
                  </span>
                ) : null}
                {metric.badge ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      ...badgePositionStyle,
                      fontSize: 10,
                      letterSpacing: 0.5,
                      opacity: 0.85,
                      textTransform: "uppercase",
                      color: isFinal ? "#f1fbff" : "#c6d9ff",
                    }}
                  >
                    {metric.badge}
                  </span>
                ) : null}
                <span style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {metric.label}
                </span>
                <span style={{ fontSize: isFinal ? 20 : 18, fontWeight: 600, color: isFinal ? "#d9f4ff" : undefined }}>
                  {metric.value}
                </span>
                {metric.hint ? <span style={{ fontSize: 11, opacity: 0.75 }}>{metric.hint}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {otherMetrics.length > 0 ? (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
          {otherMetrics.map((metric, metricIndex) => (
            <div
              key={`${metric.label}-${metricIndex}`}
              style={{
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 8,
                padding: "10px 12px",
                background: "rgba(8,12,20,0.55)",
                display: "grid",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.4 }}>{metric.label}</span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: metric.tone === "positive" ? "#16c784" : metric.tone === "negative" ? "#f45b69" : "#f8f9fb",
                }}
              >
                {metric.value}
              </span>
              {metric.hint ? <span style={{ fontSize: 11, opacity: 0.75 }}>{metric.hint}</span> : null}
              {metric.details && metric.details.length > 0 ? (
                <div style={{ display: "grid", gap: 2, fontSize: 11, opacity: 0.75 }}>
                  {metric.details.map((detail, detailIndex) => (
                    <div
                      key={`${metric.label}-${detailIndex}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
                    >
                      <span>{detail.label}</span>
                      <span>{detail.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
