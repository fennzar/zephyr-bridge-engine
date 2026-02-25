import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import {
  formatUsdInline,
  describeInventoryStatusMeta,
  describeShortfall,
  renderCandidateTitle,
  candidateSignature,
  candidateInventoryStatus,
} from "./PlanCard.helpers";

export function CandidateDrawer({ candidates }: { candidates: QuoterAwareCandidate[] }) {
  const sorted = [...candidates].sort(
    (a, b) => (a.evaluation.score?.hopCount ?? 0) - (b.evaluation.score?.hopCount ?? 0),
  );
  return (
    <details
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 8,
        background: "rgba(9,14,22,0.6)",
      }}
    >
      <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Other path candidates ({sorted.length})
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {sorted.map((candidate, index) => (
          <CandidateSummary key={`${candidateSignature(candidate)}-${index}`} candidate={candidate} />
        ))}
      </div>
    </details>
  );
}

export function CandidateSummary({ candidate }: { candidate: QuoterAwareCandidate }) {
  const evaluation = candidate.evaluation;
  const status = candidateInventoryStatus(candidate) ?? evaluation.inventory?.status ?? evaluation.score.inventoryStatus;
  const statusMeta = describeInventoryStatusMeta(status ?? "unknown");
  const pathAssets = Array.isArray(candidate.path.assets) ? candidate.path.assets : [];
  const hopCount = evaluation.score?.hopCount ?? Math.max(pathAssets.length - 1, 0);
  const costUsd = evaluation.score?.totalCostUsd ?? evaluation.totalCostUsd ?? null;
  const netUsd = evaluation.score?.netUsdChangeUsd ?? evaluation.netUsdChangeUsd ?? null;
  const shortfallSummary = describeShortfall(evaluation);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 10,
        display: "grid",
        gap: 6,
        background: "rgba(8,12,18,0.8)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{renderCandidateTitle(candidate, hopCount)}</span>
        <Badge text={statusMeta.text} color={statusMeta.color} subtle title={shortfallSummary ?? undefined} />
      </div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{pathAssets.join(" → ")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <MiniMetric label="Cost" value={formatUsdInline(costUsd)} />
        <MiniMetric label="Net Δ USD" value={formatUsdInline(netUsd)} />
        <MiniMetric label="Hops" value={`${hopCount}`} />
        {shortfallSummary ? <MiniMetric label="Inventory" value={shortfallSummary} /> : null}
      </div>
    </div>
  );
}

export function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        opacity: 0.85,
      }}
    >
      {label}: {value}
    </span>
  );
}

export function Badge({ text, color, subtle = false, mono = false, title }: { text: string; color: string; subtle?: boolean; mono?: boolean; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color: subtle ? color : "#0b1118",
        background: subtle ? "transparent" : color,
        textTransform: mono ? "none" : "uppercase",
        letterSpacing: mono ? 0 : 0.6,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
