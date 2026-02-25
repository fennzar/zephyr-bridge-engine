import type { Opportunity } from "@domain/arbitrage";
import { MAX_POOL_SHARE } from "@domain/arbitrage";
import { formatBps, formatCurrency, formatToken } from "@shared/format";

export function ArbOpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const {
    asset: assetSymbol,
    title,
    path,
    direction,
    edgeBps,
    thresholdBps,
    meetsThreshold,
    estProfitUsd,
    unitProfitUsd,
    tradeSize,
    tradeSymbol,
    steps,
    working,
    notes,
  } = opportunity;

  const statusColor = meetsThreshold ? "#16c784" : "#f45b69";
  const statusLabel = meetsThreshold ? "Meets trigger" : "Below trigger";

  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        background: "#101720",
        padding: 20,
        display: "grid",
        gap: 16,
      }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, opacity: 0.65, letterSpacing: 0.6 }}>
          {assetSymbol} · {path}
        </div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>{direction}</div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>Edge</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{formatBps(edgeBps)}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Threshold {thresholdBps.toFixed(0)} bps · <span style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>P&L / Clip</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(estProfitUsd)}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Unit edge {formatCurrency(unitProfitUsd, 4)} per {tradeSymbol}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>Recommended Size</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{formatToken(tradeSize, tradeSymbol, 2)}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Clip capped at {Math.round(MAX_POOL_SHARE * 100)}% depth</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>Steps</div>
        <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
          {steps.map((step: Opportunity["steps"][number]) => (
            <li key={step.label} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <strong>{step.label}:</strong> {step.detail}
            </li>
          ))}
        </ol>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>Working</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          {working.map((line, index) => (
            <li key={`${opportunity.id}-work-${index}`} style={{ fontSize: 12.5, opacity: 0.8 }}>
              {line}
            </li>
          ))}
        </ul>
      </div>

      {notes.length > 0 ? (
        <div style={{ fontSize: 12.5, opacity: 0.7, display: "grid", gap: 4 }}>
          {notes.map((note, index) => (
            <div key={`${opportunity.id}-note-${index}`}>• {note}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
