import type { AmountDisplay, QuoteDisplay, RateDisplay, NetworkEffectDisplay } from "./quoteHelpers";
import type { QuoteCardMetadata } from "./quoters.helpers";
import { PoolImpactDisplay } from "./PoolImpactDisplay";
import { CexImpactDisplay } from "./CexImpactDisplay";
import { colors } from "@/components/theme";

function renderAmountRow(label: string, amount: AmountDisplay | undefined) {
  if (!amount) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <span>
        {amount.decimal ?? amount.wei}
        <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>({amount.wei} wei)</span>
      </span>
    </div>
  );
}

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

function renderRates(rates?: RateDisplay[]) {
  if (!rates?.length) return null;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Runtime Rates</div>
      <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.8 }}>
        {rates.map(({ label, value }) => (
          <li key={`${label}:${value}`}>
            <span style={{ opacity: 0.75 }}>{label}:</span> <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderNetworkEffect(effect?: NetworkEffectDisplay) {
  if (!effect || effect.metrics.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Network Effect</div>
      <div style={{ display: "grid", gap: 6 }}>
        {effect.metrics.map((metric) => (
          <div key={metric.label} style={{ display: "grid", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ opacity: 0.75 }}>{metric.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {metric.delta}
                {metric.deltaPercent ? (
                  <span style={{ opacity: 0.7, marginLeft: 6, fontSize: 12 }}>{metric.deltaPercent}</span>
                ) : null}
              </span>
            </div>
            <div style={{ opacity: 0.65, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {metric.oldValue} \u2192 {metric.newValue}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderPolicy(policy?: QuoteDisplay["policy"]) {
  if (!policy) return null;

  const entries: Array<{ label: string; allowed: boolean; reasons?: string[] }> = [];
  if (policy.native) entries.push({ label: "Native conversions", ...policy.native });
  if (policy.bridge) entries.push({ label: "Bridge operations", ...policy.bridge });
  if (policy.cex) entries.push({ label: "CEX trades", ...policy.cex });

  if (entries.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Policy Check</div>
      <div style={{ display: "grid", gap: 8 }}>
        {entries.map(({ label, allowed, reasons }) => (
          <div key={label} style={{ display: "grid", gap: 4 }}>
            <div style={{ opacity: 0.75, fontSize: 13 }}>{label}</div>
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border: `1px solid ${allowed ? "rgba(22,199,132,0.3)" : "rgba(244,91,105,0.3)"}`,
                background: allowed ? colors.accent.greenBg : colors.accent.redBg,
                color: allowed ? colors.accent.green : colors.accent.red,
                fontSize: 13,
              }}
            >
              {allowed ? "Allowed" : "Not Allowed"}
            </div>
            {reasons && reasons.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.8 }}>
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuoteResultCard({
  quote,
  metadata,
  error,
}: {
  quote: QuoteDisplay | null;
  metadata: QuoteCardMetadata;
  error: string | null;
}) {
  if (!quote && !error) return null;

  const title = (() => {
    switch (metadata.operation) {
      case "swapEVM":
        return "On-Chain Swap";
      case "nativeMint":
        return "Native Mint";
      case "nativeRedeem":
        return "Native Redeem";
      case "tradeCEX":
        return "CEX Trade";
      case "wrap":
        return "Bridge Wrap";
      case "unwrap":
        return "Bridge Unwrap";
      default:
        return "Quote";
    }
  })();

  const feeAsset =
    quote?.amounts.feeAsset === "to"
      ? quote?.request.to ?? metadata.to ?? quote?.request.from
      : quote?.request.from ?? metadata.from ?? null;

  return (
    <div style={{ border: `1px solid ${colors.border.primary}`, borderRadius: 10, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        {metadata.zeroForOne != null ? (
          <span style={{ opacity: 0.7, fontSize: 13 }}>{metadata.zeroForOne ? "zero\u2192one" : "one\u2192zero"}</span>
        ) : null}
      </div>
      {quote ? (
        <>
          {renderAmountRow(`Amount In (${quote.request.from})`, quote.request.amountIn)}
          {renderAmountRow(`Target Amount Out (${quote.request.to})`, quote.request.amountOutTarget)}
          {renderAmountRow(`Gross Amount Out (${quote.request.to})`, quote.amounts.grossAmountOut)}
          {renderAmountRow(`Net Amount Out (${quote.request.to})`, quote.amounts.amountOut)}
          {renderAmountRow(
            `Fee${feeAsset ? ` (${feeAsset})` : ""}`,
            quote.amounts.feePaid,
          )}
          {renderAmountRow("Estimated Gas", quote.amounts.estGasWei)}
          {renderRates(quote.rates)}
          {renderNetworkEffect(quote.networkEffect)}
          {renderPolicy(quote.policy)}
          {renderWarnings(quote.warnings)}
          <PoolImpactDisplay impact={metadata.poolImpact} />
          <CexImpactDisplay impact={metadata.cexImpact} />
        </>
      ) : null}
      {error ? (
        <div style={{ color: "#ff8a99", fontSize: 13 }}>
          Quoter error:
          <br />
          <span style={{ opacity: 0.85 }}>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
