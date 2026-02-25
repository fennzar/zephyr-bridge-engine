import type { ArbAsset } from "@domain/arbitrage";
import { formatAssetStatus } from "@domain/arbitrage";
import { formatBps, formatCurrency, formatNumber } from "@shared/format";

import { ArbBadge } from "./ArbLayout";

export function AssetOverviewTable({ assets }: { assets: ArbAsset[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 760,
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 13,
          background: "#101720",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
        }}
      >
        <thead>
          <tr style={{ textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11, opacity: 0.65 }}>
            <th style={{ textAlign: "left", padding: "12px" }}>Asset</th>
            <th style={{ textAlign: "right", padding: "12px" }}>Status</th>
            <th style={{ textAlign: "right", padding: "12px" }}>DEX Rate</th>
            <th style={{ textAlign: "right", padding: "12px" }}>Native Rate</th>
            <th style={{ textAlign: "right", padding: "12px" }}>CEX Rate</th>
            <th style={{ textAlign: "right", padding: "12px" }}>Gap</th>
            <th style={{ textAlign: "right", padding: "12px" }}>Trigger</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const { dex, native, cex } = asset.pricing;
            const statusColor =
              asset.status.mode === "aligned" ? "#9AA0AA" : asset.status.mode === "premium" ? "#16c784" : "#f45b69";
            const statusLabel = formatAssetStatus(asset);

            return (
              <tr key={asset.asset} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "12px" }}>
                  <a
                    href={`#asset-${asset.asset.toLowerCase()}`}
                    style={{ color: "#fff", textDecoration: "none", fontWeight: 600 }}
                  >
                    {asset.asset} ↔ {asset.wrappedSymbol}
                  </a>
                  <div style={{ fontSize: 11, opacity: 0.55 }}>
                    Trigger {asset.thresholdBps} bps{" "}
                    {asset.asset === "ZYS" && (asset as any).yieldHalted ? (
                      <ArbBadge text="Yield halted (RR < 200%)" color="#f7ad4c" subtle mono />
                    ) : null}
                  </div>
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: statusColor }}>{statusLabel}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>{renderDexCell(dex)}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>{renderNativeCell(native)}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>{renderCexCell(cex)}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>{formatBps(asset.status.gapBps ?? Number.NaN)}</td>
                <td style={{ padding: "12px", textAlign: "right" }}>{`${asset.thresholdBps} bps`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderDexCell(pricing: ArbAsset["pricing"]["dex"]): JSX.Element {
  if (pricing.price == null) return <span style={{ opacity: 0.65 }}>—</span>;
  return (
    <div style={{ display: "grid", gap: 2, justifyItems: "end" }}>
      <span>
        {formatNumber(pricing.price, 6)} {pricing.quote}
      </span>
      {pricing.priceUsd != null ? (
        <span style={{ fontSize: 11, opacity: 0.7 }}>≈ {formatCurrency(pricing.priceUsd)}</span>
      ) : null}
    </div>
  );
}

function renderNativeCell(pricing: ArbAsset["pricing"]["native"]): JSX.Element {
  if (!pricing) return <span style={{ opacity: 0.65 }}>—</span>;
  const spotLine =
    pricing.spot != null
      ? `${formatNumber(pricing.spot, 6)} ${pricing.quote}${
          pricing.spotUsd != null ? ` (${formatCurrency(pricing.spotUsd)})` : ""
        }`
      : null;
  const maLine =
    pricing.movingAverage != null
      ? `${formatNumber(pricing.movingAverage, 6)} ${pricing.quote}${
          pricing.movingAverageUsd != null ? ` (${formatCurrency(pricing.movingAverageUsd)})` : ""
        }`
      : null;

  return (
    <div style={{ display: "grid", gap: 2, justifyItems: "end" }}>
      {spotLine ? <span>Spot: {spotLine}</span> : null}
      {maLine ? <span style={{ opacity: 0.75 }}>MA: {maLine}</span> : null}
      {!spotLine && !maLine ? <span style={{ opacity: 0.65 }}>—</span> : null}
    </div>
  );
}

function renderCexCell(pricing: ArbAsset["pricing"]["cex"]): JSX.Element {
  if (!pricing || pricing.price == null) return <span style={{ opacity: 0.65 }}>—</span>;
  return (
    <div style={{ display: "grid", gap: 2, justifyItems: "end" }}>
      <span>
        {formatNumber(pricing.price, 6)} {pricing.quote}
      </span>
      {pricing.priceUsd != null ? (
        <span style={{ fontSize: 11, opacity: 0.7 }}>≈ {formatCurrency(pricing.priceUsd)}</span>
      ) : null}
    </div>
  );
}
