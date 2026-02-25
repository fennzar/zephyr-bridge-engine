import type { AssetId } from "@domain/types";
import type { PathEvaluation } from "@domain/pathing";
import type { QuoterAwareSegmentPlan } from "@domain/pathing/arb";
import { PathTimeline, buildPriceMap } from "../../components/PathTimeline";

import type { CandidateEntry, MetricTone, CandidateSummary } from "./legPrep.helpers";
import {
  formatBps,
  formatBooleanFlag,
  renderAmount,
  renderGas,
  formatUsd,
  formatSigned,
  formatNumberValue,
  renderInventoryRange,
  uniqueStrings,
  formatDuration,
  candidateKey,
  describeInventoryStatus,
  collectDisallowReasons,
} from "./legPrep.helpers";

export function MetricBadge({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: string;
  tone?: MetricTone;
}) {
  const palette: Record<MetricTone, { border: string; background: string; color: string }> = {
    ok: { border: "rgba(22, 199, 132, 0.4)", background: "rgba(22, 199, 132, 0.12)", color: "#16c784" },
    warn: { border: "rgba(255, 193, 7, 0.4)", background: "rgba(255, 193, 7, 0.12)", color: "#ffc107" },
    error: { border: "rgba(244, 91, 105, 0.4)", background: "rgba(244, 91, 105, 0.12)", color: "#f45b69" },
    info: { border: "rgba(82, 113, 255, 0.3)", background: "rgba(82, 113, 255, 0.12)", color: "#c6d7ff" },
  };

  const style = palette[tone];

  return (
    <div
      style={{
        display: "grid",
        gap: 2,
        minWidth: 110,
        padding: "6px 10px",
        borderRadius: 8,
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        fontWeight: 500,
      }}
    >
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.75 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: MetricTone;
}) {
  const palette: Record<MetricTone, { border: string; background: string; color: string }> = {
    ok: { border: "rgba(22,199,132,0.35)", background: "rgba(22,199,132,0.12)", color: "#16c784" },
    warn: { border: "rgba(255,193,7,0.4)", background: "rgba(255,193,7,0.12)", color: "#ffc107" },
    error: { border: "rgba(244,91,105,0.45)", background: "rgba(244,91,105,0.12)", color: "#f45b69" },
    info: { border: "rgba(148,163,184,0.4)", background: "rgba(15,23,42,0.6)", color: "#cbd5f5" },
  };
  const styles = palette[tone];
  return (
    <span
      style={{
        border: `1px solid ${styles.border}`,
        borderRadius: 16,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        color: styles.color,
        background: styles.background,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ opacity: 0.75, fontSize: 11, textTransform: "uppercase" }}>{label}</span>
      {value}
    </span>
  );
}

export function SegmentSummary({
  step,
  summary,
}: {
  step: QuoterAwareSegmentPlan["step"];
  summary: CandidateSummary;
}) {
  const bestHop = summary.bestHopIndex != null ? step.candidates[summary.bestHopIndex] : null;
  const bestCost = summary.bestCostIndex != null ? step.candidates[summary.bestCostIndex] : null;
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
      <MetricBadge
        label="Candidates"
        value={step.candidates.length.toString()}
        tone={step.candidates.length > 0 ? "info" : "warn"}
      />
      <MetricBadge
        label="Inventory-ready"
        value={`${summary.validCount}/${step.candidates.length}`}
        tone={summary.validCount > 0 ? "ok" : "error"}
      />
      <MetricBadge
        label="Shortest valid hops"
        value={bestHop ? bestHop.evaluation.score.hopCount.toString() : "None"}
        tone={bestHop ? "ok" : "warn"}
      />
      <MetricBadge
        label="Cheapest valid cost"
        value={bestCost ? formatUsd(bestCost.evaluation.totalCostUsd) : "None"}
        tone={bestCost ? "ok" : "warn"}
      />
    </div>
  );
}

export function SegmentCandidates({
  step,
  needAsset,
  summary,
}: {
  step: QuoterAwareSegmentPlan["step"];
  needAsset: AssetId;
  summary: CandidateSummary;
}) {
  if (step.candidates.length === 0) {
    return <div style={{ fontStyle: "italic", opacity: 0.7 }}>No candidates available for this segment.</div>;
  }

  const recommendedIndex = summary.bestHopIndex ?? summary.bestCostIndex;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {step.candidates.map((candidate, index) => (
        <CandidateCard
          key={candidateKey(candidate, index)}
          candidate={candidate}
          index={index}
          needAsset={needAsset}
          highlightShortest={summary.bestHopIndex === index}
          highlightCheapest={summary.bestCostIndex === index}
          recommended={recommendedIndex === index}
        />
      ))}
      {summary.validCount === 0 ? (
        <div style={{ padding: 12, borderRadius: 8, border: "1px solid #5a1f2a", background: "rgba(90,31,42,0.25)", color: "#f45b69", fontSize: 13 }}>
          No allowed paths currently have sufficient inventory. Use the Pathing tools to replenish holdings or adjust probe amount.
        </div>
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  needAsset,
  highlightShortest,
  highlightCheapest,
  recommended,
}: {
  candidate: CandidateEntry;
  index: number;
  needAsset: AssetId;
  highlightShortest: boolean;
  highlightCheapest: boolean;
  recommended: boolean;
}) {
  const evaluation = candidate.evaluation;
  const priceMap = buildPriceMap(evaluation);
  const inventoryBadge = describeInventoryStatus(evaluation);
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
  const highlightTags: Array<{ label: string; color?: string; border?: string }> = [];
  if (highlightShortest) highlightTags.push({ label: "Shortest valid path" });
  if (highlightCheapest) highlightTags.push({ label: "Lowest cost valid" });
  if (recommended) highlightTags.push({ label: "Recommended" });
  highlightTags.push({
    label: inventoryBadge.text,
    color: inventoryBadge.tone === "error" ? "#f45b69" : inventoryBadge.tone === "warn" ? "#ffc107" : "#16c784",
    border:
      inventoryBadge.tone === "error"
        ? "rgba(244,91,105,0.45)"
        : inventoryBadge.tone === "warn"
          ? "rgba(255,193,7,0.45)"
          : "rgba(22,199,132,0.45)",
  });

  const summaryMetrics: Array<{ label: string; value: string; tone: MetricTone }> = [
    { label: "Cost", value: formatUsd(evaluation.totalCostUsd), tone: costTone },
    { label: "Net \u0394USD", value: formatUsd(evaluation.netUsdChangeUsd), tone: netTone },
    { label: "Inventory", value: inventoryBadge.text, tone: inventoryBadge.tone },
  ];

  return (
    <details
      open={recommended || index === 0}
      style={{
        border: `1px solid ${recommended ? "rgba(22,199,132,0.5)" : "rgba(22,199,132,0.2)"}`,
        borderRadius: 10,
        padding: 10,
        background: evaluation.score.allowed ? "rgba(22,199,132,0.035)" : "rgba(244,91,105,0.08)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              Candidate #{index + 1} · Source: {candidate.source}
            </span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{candidate.path.assets.join(" \u2192 ")}</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Score: {evaluation.score.allowed ? "Allowed" : "Blocked"} \u2022 Hops {evaluation.score.hopCount} \u2022 Fee{" "}
              {formatBps(evaluation.score.totalFeeBps)}
            </span>
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: 12, textAlign: "right", opacity: 0.75 }}>
            <span>Gas USD: {formatUsd(evaluation.totalGasUsd)}</span>
            <span>Duration: {formatDuration(evaluation.score.totalDurationMs)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {summaryMetrics.map((metric) => (
            <SummaryMetric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
          ))}
        </div>
      </summary>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {highlightTags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {highlightTags.map((tag) => (
              <span
                key={tag.label}
                style={{
                  fontSize: 11,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  padding: "2px 10px",
                  borderRadius: 999,
                  border: tag.border ?? "1px solid rgba(22,199,132,0.35)",
                  color: tag.color ?? "#16c784",
                }}
              >
                {tag.label}
              </span>
            ))}
          </div>
        ) : null}

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
            startAmount={candidate.amountIn}
            priceMap={priceMap}
            formatUsd={formatUsd}
            formatBps={formatBps}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <MetricBadge label="Cost" value={formatUsd(evaluation.totalCostUsd)} tone={costTone} />
        <MetricBadge label="Hops" value={evaluation.score.hopCount.toString()} tone="info" />
          <MetricBadge label="Duration" value={formatDuration(evaluation.score.totalDurationMs)} tone="info" />
          <MetricBadge label="Policy" value={evaluation.score.allowed ? "Allowed" : "Blocked"} tone={policyTone} />
          <MetricBadge label="Inventory" value={inventoryBadge.text} tone={inventoryBadge.tone} />
          <MetricBadge label="Net \u0394USD" value={formatUsd(evaluation.netUsdChangeUsd)} tone={netTone} />
        </div>

        <div
          style={{
            display: "grid",
            gap: 6,
            fontSize: 12,
            opacity: 0.75,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          <div>Amount in: {renderAmount(candidate.amountIn, candidate.source)}</div>
          <div>Amount out: {renderAmount(evaluation.finalAmountOut, needAsset)}</div>
          <div>Cost: {formatUsd(evaluation.totalCostUsd)}</div>
          <div>Net \u0394USD: {formatUsd(evaluation.netUsdChangeUsd)}</div>
          <div>Gas USD: {formatUsd(evaluation.totalGasUsd)}</div>
          {evaluation.totalFeeUsd != null ? <div>Fees USD: {formatUsd(evaluation.totalFeeUsd)}</div> : null}
        </div>

        <div>{formatBooleanFlag(evaluation.score.allowed, collectDisallowReasons(evaluation))}</div>

        {evaluation.hops.length > 0 ? (
          <details
            style={{
              border: "1px solid rgba(22,199,132,0.05)",
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(11,15,20,0.65)",
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Hop details ({evaluation.hops.length})
            </summary>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {evaluation.hops.map((hop, hopIndex) => (
                <div
                  key={`${hop.op}-${hopIndex}`}
                  style={{
                    border: "1px solid rgba(22,199,132,0.08)",
                    borderRadius: 8,
                    padding: 8,
                    fontSize: 12,
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    Hop {hopIndex + 1}: {hop.from} \u2192 {hop.to} ({hop.op})
                  </div>
                  <div>Allowed: {hop.allowed ? "yes" : "no"}</div>
                  <div>Fee: {formatBps(hop.feeBps)}</div>
                  <div>Gas: {renderGas(hop.gasWei)}</div>
                  {hop.warnings.length > 0 ? <div>Warnings: {hop.warnings.join("; ")}</div> : null}
                  {hop.allowanceReasons.length > 0 ? <div>Policy: {hop.allowanceReasons.join("; ")}</div> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {evaluation.assetDeltas.length > 0 ? (
          <details
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(6,10,16,0.6)",
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Inventory deltas ({evaluation.assetDeltas.length})
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
                    \u0394: {formatSigned(delta.amountDecimal)}
                    {delta.usdChange != null ? ` (${formatUsd(delta.usdChange)})` : ""}
                  </div>
                  <div>
                    Inventory: {renderInventoryRange(delta.startingBalance, delta.endingBalance, evaluation.inventory.status)}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {evaluation.feeBreakdown.length > 0 ? (
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
        ) : null}

        {evaluation.inventory.shortfalls.length > 0 ? (
          <div style={{ fontSize: 12, color: "#f45b69" }}>
            Shortfalls:{" "}
            {evaluation.inventory.shortfalls
              .map((entry) => `${entry.asset} (${formatNumberValue(entry.shortfall)})`)
              .join("; ")}
          </div>
        ) : null}

        {evaluation.notes.length > 0 ? (
          <div style={{ fontSize: 12, color: "#e5b567" }}>
            Path notes: {uniqueStrings(evaluation.notes).join("; ")}
          </div>
        ) : null}
      </div>
    </details>
  );
}
