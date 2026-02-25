import { formatCurrency as formatUsd } from "@shared/format";

import { buildInventorySummary, renderSignedTokenAmount } from "./clipExplorer.helpers";

export function InventorySummary({
  groups,
  netUsdChange,
  capitalDeployedUsd,
}: {
  groups: ReturnType<typeof buildInventorySummary>;
  netUsdChange: number | null;
  capitalDeployedUsd: number | null;
}) {
  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        {groups.map((group) => (
          <div
            key={group.asset}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.15)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{group.asset}</span>
              {group.totalUsdChange != null ? (
                <span style={{ opacity: 0.75 }}>{`(${formatUsd(group.totalUsdChange)})`}</span>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {group.entries.map((entry, entryIndex) => (
                <div
                  key={`${entry.assetId}-${entryIndex}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px, 1fr) minmax(140px, 1fr) minmax(100px, auto)",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 12,
                  }}
                >
                  <span style={{ opacity: 0.75 }}>
                    {entry.assetId}
                    {entry.source ? <span style={{ opacity: 0.4, marginLeft: 6 }}>{`(${entry.source})`}</span> : null}
                  </span>
                  <span>{renderSignedTokenAmount(entry.amount, entry.assetId)}</span>
                  <span>
                    {entry.usdChange != null ? (
                      <span style={{ opacity: 0.75 }}>{`(${formatUsd(entry.usdChange)})`}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gap: 6,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(148,163,184,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Trade PnL</span>
          <span>{netUsdChange != null ? formatUsd(netUsdChange) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Capital deployed</span>
          <span>{capitalDeployedUsd != null ? formatUsd(capitalDeployedUsd) : "—"}</span>
        </div>
      </div>
    </>
  );
}
