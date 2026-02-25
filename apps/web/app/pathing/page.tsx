import type { AssetId } from "@domain/types";
import { ASSET_STEPS } from "@domain/inventory/graph";
import { evaluatePaths, loadInventoryBalances, type PathEvaluation } from "@domain/pathing";
import { buildGlobalState } from "@domain/state/state.builder";
import { getAssetDecimals } from "@/app/shared/assetMetadata";
import { PathTimeline, buildPriceMap } from "../components/PathTimeline";
import { parseDecimalToUnits } from "../quoters/quoteHelpers";
import { colors, styles } from "@/components/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const ASSET_IDS = Object.keys(ASSET_STEPS) as AssetId[];
const SORTED_ASSETS = [...ASSET_IDS].sort((a, b) => a.localeCompare(b));
const ASSET_SET = new Set<AssetId>(ASSET_IDS);

function pickFirst(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toAssetId(value: string | null): AssetId | null {
  if (!value) return null;
  return ASSET_SET.has(value as AssetId) ? (value as AssetId) : null;
}

function parsePositiveInt(raw: string | null): { value: number | undefined; error?: string } {
  if (!raw) return { value: undefined };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: undefined, error: "Value must be a positive integer." };
  }
  return { value: parsed };
}

function formatUsd(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(digits)}`;
}

function formatSigned(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  const formatted = value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatNumberValue(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatPathAssets(evaluation: PathEvaluation): string {
  return evaluation.path.assets.join(" → ");
}

function uniqueCombiner(values: string[]): string[] {
  return Array.from(new Set(values));
}


function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds === 0 ? `${minutes} min` : `${minutes}m ${remainingSeconds}s`;
}

function formatBpsValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} bps`;
}

type MetricTone = "ok" | "warn" | "error" | "info";

function MetricBadge({
  label,
  value,
  tone = "info",
  emphasize = false,
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  emphasize?: boolean;
}) {
  const palette: Record<MetricTone, { border: string; background: string; color: string }> = {
    ok: { border: "rgba(22, 199, 132, 0.4)", background: colors.accent.greenBg, color: colors.accent.green },
    warn: { border: "rgba(255, 193, 7, 0.4)", background: "rgba(255, 193, 7, 0.12)", color: "#ffc107" },
    error: { border: "rgba(244, 91, 105, 0.4)", background: colors.accent.redBg, color: colors.accent.red },
    info: { border: "rgba(82, 113, 255, 0.3)", background: "rgba(82, 113, 255, 0.12)", color: "#c6d7ff" },
  };

  const style = palette[tone];

  return (
    <div
      style={{
        display: "grid",
        gap: 2,
        minWidth: 120,
        padding: emphasize ? "10px 14px" : "8px 12px",
        borderRadius: 10,
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        fontWeight: emphasize ? 600 : 500,
      }}
    >
      <span style={{ ...styles.label, opacity: 0.75 }}>{label}</span>
      <span style={{ fontSize: emphasize ? 17 : 14 }}>{value}</span>
    </div>
  );
}

function computeInventoryStatus(
  deltas: PathEvaluation["assetDeltas"],
): { text: string; tone: MetricTone } {
  if (deltas.length === 0) return { text: "N/A", tone: "info" };
  let hasUnknown = false;
  for (const delta of deltas) {
    if (delta.startingBalance == null || delta.endingBalance == null) {
      hasUnknown = true;
      continue;
    }
    if (delta.endingBalance < -1e-9) {
      return { text: "Insufficient", tone: "error" };
    }
  }
  if (hasUnknown) return { text: "Unknown", tone: "warn" };
  return { text: "Sufficient", tone: "ok" };
}


export default async function DomainPathingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const fromParam = pickFirst(params.from);
  const toParam = pickFirst(params.to);
  const amountParam = pickFirst(params.amount);
  const maxDepthParam = pickFirst(params.maxDepth);
  const limitParam = pickFirst(params.limit);

  const errors: string[] = [];

  const fromAsset = toAssetId(fromParam);
  if (fromParam && !fromAsset) errors.push(`Unknown source asset: ${fromParam}`);

  const toAsset = toAssetId(toParam);
  if (toParam && !toAsset) errors.push(`Unknown target asset: ${toParam}`);

  const { value: maxDepth, error: depthError } = parsePositiveInt(maxDepthParam);
  if (depthError) errors.push(depthError);

  const { value: limit, error: limitError } = parsePositiveInt(limitParam);
  if (limitError) errors.push(limitError);

  let amountIn: bigint | null = null;
  if (amountParam && fromAsset) {
    const decimals = getAssetDecimals(fromAsset);
    const parsed = parseDecimalToUnits(amountParam, decimals);
    if (parsed.ok) {
      amountIn = parsed.value;
      if (amountIn <= 0n) errors.push("Amount must be greater than zero.");
    } else {
      errors.push(parsed.error);
    }
  } else if (amountParam && !fromAsset) {
    errors.push("Select a valid source asset before specifying the amount.");
  }

  const ready = fromAsset && toAsset && amountIn != null && errors.length === 0;

  let result: Awaited<ReturnType<typeof evaluatePaths>> | null = null;
  if (ready && fromAsset && toAsset && amountIn != null) {
    const [state, inventoryBalances] = await Promise.all([
      buildGlobalState(),
      loadInventoryBalances(),
    ]);
    result = await evaluatePaths(
      {
        from: fromAsset,
        to: toAsset,
        amountIn,
        maxDepth,
        limit,
        inventory: inventoryBalances,
      },
      state,
    );
  }

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Domain Pathing (Quoter-Aware)</h1>
        <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.6 }}>
          Explore inventory paths enriched with runtime context, live quotes, and policy allowances. Paths are
          ranked by allowance status first, then cumulative fee burden.
        </p>
        <form
          method="get"
          style={{
            display: "grid",
            gap: 12,
            ...styles.card,
            padding: 16,
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="from">From asset</label>
            <select
              id="from"
              name="from"
              defaultValue={fromAsset ?? ""}
              style={{ padding: "8px 10px", background: colors.bg.body, color: colors.text.primary }}
              required
            >
              <option value="" disabled>
                Select asset
              </option>
              {SORTED_ASSETS.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="to">To asset</label>
            <select
              id="to"
              name="to"
              defaultValue={toAsset ?? ""}
              style={{ padding: "8px 10px", background: colors.bg.body, color: colors.text.primary }}
              required
            >
              <option value="" disabled>
                Select asset
              </option>
              {SORTED_ASSETS.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="amount">Amount in ({fromAsset ?? "source asset decimals"})</label>
            <input
              id="amount"
              name="amount"
              type="text"
              defaultValue={amountParam ?? ""}
              placeholder="Enter amount (decimal)"
              style={{ padding: "8px 10px", background: colors.bg.body, color: colors.text.primary }}
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <label htmlFor="maxDepth">
                Max depth <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="maxDepth"
                name="maxDepth"
                type="number"
                min={1}
                defaultValue={maxDepth ?? ""}
                placeholder="Auto"
                style={{ padding: "8px 10px", background: colors.bg.body, color: colors.text.primary }}
              />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <label htmlFor="limit">
                Path limit <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="limit"
                name="limit"
                type="number"
                min={1}
                defaultValue={limit ?? ""}
                placeholder="All"
                style={{ padding: "8px 10px", background: colors.bg.body, color: colors.text.primary }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                background: colors.accent.green,
                color: "#04121d",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Evaluate Paths
            </button>
            <a
              href="/pathing"
              style={{
                padding: "8px 16px",
                color: colors.text.primary,
                borderRadius: 6,
                border: `1px solid ${colors.border.primary}`,
                textDecoration: "none",
              }}
            >
              Reset
            </a>
          </div>
        </form>

        {errors.length > 0 && (
          <div
            style={{
              background: colors.accent.redBg,
              border: "1px solid rgba(244,91,105,0.3)",
              borderRadius: 8,
              padding: 12,
              color: colors.accent.red,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Input issues</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {ready && result && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Results</span>
              <span style={{ opacity: 0.7 }}>
                {result.paths.length === 0
                  ? "No viable paths found."
                  : `${result.paths.length} path${result.paths.length === 1 ? "" : "s"} evaluated.`}
              </span>
            </div>

            {result.paths.map((evaluation, index) => {
              const notes = uniqueCombiner(evaluation.notes);
              const inventoryStatus = computeInventoryStatus(evaluation.assetDeltas);
              const costTone: MetricTone = evaluation.totalCostUsd == null
                ? "info"
                : evaluation.totalCostUsd <= 0
                  ? "ok"
                  : "warn";
              const netTone: MetricTone = evaluation.netUsdChangeUsd == null
                ? "info"
                : evaluation.netUsdChangeUsd >= 0
                  ? "ok"
                  : "warn";
              const policyTone: MetricTone = evaluation.score.allowed ? "ok" : "error";
              const priceMap = buildPriceMap(evaluation);

              return (
                <div
                  key={`${evaluation.path.assets.join("::")}::${index}`}
                  style={{
                    border: `1px solid ${colors.border.primary}`,
                    borderRadius: 10,
                    background: colors.bg.body,
                    padding: 16,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "grid", gap: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>Path #{index + 1}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{formatPathAssets(evaluation)}</div>
                      </div>
                      <div
                        style={{
                          ...styles.badge,
                          border: "1px solid rgba(82,113,255,0.2)",
                          background: "rgba(82,113,255,0.08)",
                          alignSelf: "flex-start",
                        }}
                      >
                        Policy: {evaluation.score.allowed ? "Allowed" : "Blocked"}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(82,113,255,0.15)",
                        borderRadius: 14,
                        background: "rgba(6,10,16,0.8)",
                        padding: 12,
                      }}
                    >
                      <PathTimeline
                        evaluation={evaluation}
                        startAmount={result.amountIn}
                        priceMap={priceMap}
                        formatUsd={formatUsd}
                        formatBps={formatBpsValue}
                      />
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <MetricBadge label="Cost" value={formatUsd(evaluation.totalCostUsd)} tone={costTone} emphasize />
                      <MetricBadge label="Hops" value={evaluation.score.hopCount.toString()} tone="info" emphasize />
                      <MetricBadge label="Duration" value={formatDuration(evaluation.score.totalDurationMs)} tone="info" />
                      <MetricBadge label="Policy" value={evaluation.score.allowed ? "Allowed" : "Blocked"} tone={policyTone} />
                      <MetricBadge label="Inventory" value={inventoryStatus.text} tone={inventoryStatus.tone} />
                      <MetricBadge label="Net ΔUSD" value={formatUsd(evaluation.netUsdChangeUsd)} tone={netTone} />
                    </div>
                  </div>

                  {evaluation.assetDeltas.length > 0 && (
                    <details
                      style={{
                        border: "1px solid rgba(22,199,132,0.08)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(11,15,20,0.8)",
                      }}
                    >
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        Asset deltas ({evaluation.assetDeltas.length})
                      </summary>
                      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                        {evaluation.assetDeltas.map((delta, idx) => (
                          <div
                            key={`${delta.asset}-${idx}`}
                            style={{
                              border: "1px solid rgba(22,199,132,0.08)",
                              borderRadius: 8,
                              padding: 10,
                              display: "grid",
                              gap: 4,
                              fontSize: 12,
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{delta.asset}</div>
                            <div>
                              Δ: {formatSigned(delta.amountDecimal)}
                              {delta.usdChange != null ? ` (${formatUsd(delta.usdChange)})` : ""}
                            </div>
                            <div>
                              Inventory: {formatNumberValue(delta.startingBalance)} → {formatNumberValue(delta.endingBalance)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {evaluation.feeBreakdown.length > 0 && (
                    <details
                      style={{
                        border: "1px solid rgba(22,199,132,0.05)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(11,15,20,0.65)",
                      }}
                    >
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        Fee breakdown ({evaluation.feeBreakdown.length})
                      </summary>
                      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                        {evaluation.feeBreakdown.map((fee, idx) => (
                          <div
                            key={`${fee.asset}-${idx}`}
                            style={{
                              border: "1px solid rgba(22,199,132,0.05)",
                              borderRadius: 8,
                              padding: 10,
                              fontSize: 12,
                              display: "grid",
                              gap: 4,
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{fee.asset}</div>
                            <div>Amount: {formatNumberValue(fee.amountDecimal)}</div>
                            <div>USD: {formatUsd(fee.usdAmount)}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {notes.length > 0 && (
                    <div style={{ fontSize: 12, color: "#e5b567" }}>Path notes: {notes.join("; ")}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
