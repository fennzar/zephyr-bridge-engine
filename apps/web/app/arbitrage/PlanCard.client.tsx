'use client';

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { AssetBadge, AssetPair } from "@/components/AssetBadge";
import type { AssetId } from "@domain/types";
import type {
  ArbPlan,
  ArbPlanStage,
  ArbPlanStep,
  ArbPlanLegPrepView,
} from "@domain/arbitrage/types.plan";
import type { ClipOption, ClipExecutionVariant, ClipSearchIteration } from "@domain/arbitrage/clip.types";
import type { InventoryApiResponse } from "@domain/inventory/types.api";
import { formatCurrency, formatNumber, toFiniteNumber } from "@shared/format";
import { PathTimeline, buildPriceMap } from "../components/PathTimeline";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import type { PathEvaluation } from "@domain/pathing";

import type { ClipFlavor, FlowEntry, PrepContext } from "./PlanCard.helpers";
import {
  formatBps,
  formatUsdInline,
  describeStepAmount,
  buildLegPrepHref,
  buildClipFlowSections,
  buildPrepContext,
  filterStepsByFlavor,
  pickClosePrep,
  describeInventoryStatusMeta,
  describeNativeBasis,
  candidateSignature,
  describeNeedVsInventory,
  unitsToDecimal,
  isStableAsset,
  STAGE_LABELS,
} from "./PlanCard.helpers";
import { ClipSearchLog } from "./ClipSearchLog";
import { renderInventoryDetails } from "./InventoryBreakdownPanel";
import { CandidateDrawer, MiniMetric, Badge } from "./CandidateSection";

export function ArbPlanCard({
  plan,
  statusColor,
  inventorySnapshot,
}: {
  plan: ArbPlan;
  statusColor: string;
  inventorySnapshot: InventoryApiResponse | null;
}) {
  const summaryClipOptions = useMemo(
    () => plan.summary.clipOptions ?? (plan.summary.clipOption ? [plan.summary.clipOption] : []),
    [plan.summary.clipOptions, plan.summary.clipOption],
  );
  const viewClipEntries = plan.view?.clipOptions ?? null;
  const clipOptions = viewClipEntries ? viewClipEntries.map((entry) => entry.option) : summaryClipOptions;
  const initialFlavor = (plan.summary.closeFlavor ?? clipOptions[0]?.flavor ?? null) as ClipFlavor | null;
  const [selectedFlavor, setSelectedFlavor] = useState<ClipFlavor | null>(initialFlavor);

  const statusBadgeColor = plan.summary.blocked ? "#f45b69" : "#16c784";
  const statusText = plan.summary.blocked ? "Blocked" : "Ready";

  const selectedOption = useMemo(
    () => clipOptions.find((option) => option.flavor === selectedFlavor) ?? clipOptions[0],
    [clipOptions, selectedFlavor],
  );
  const selectedViewEntry =
    viewClipEntries?.find((entry) => entry.option.flavor === selectedOption?.flavor) ?? viewClipEntries?.[0] ?? null;

  const prepSteps = plan.stages.preparation;
  const openPrepStep = prepSteps.find((step) => step.prepSegment?.kind === "open") ?? null;
  const closePrepStep = pickClosePrep(prepSteps, selectedFlavor);
  const openCandidate = (selectedOption?.open?.candidate as QuoterAwareCandidate | null | undefined) ?? null;
  const closeCandidate = (selectedOption?.close?.candidate as QuoterAwareCandidate | null | undefined) ?? null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: 12,
          background: "rgba(12,18,26,0.85)",
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.65, textTransform: "uppercase", letterSpacing: 0.4 }}>Clip option selection</div>

        <header style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>
            {plan.asset} · {plan.direction.replace("_", " ")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {clipOptions.length > 1 ? (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {clipOptions.map((option) => (
                  <button
                    key={`${plan.asset}-${plan.direction}-toggle-${option.flavor}`}
                    type="button"
                    onClick={() => setSelectedFlavor(option.flavor)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: option.flavor === selectedFlavor ? `1px solid ${statusColor}` : "1px solid rgba(148,163,184,0.35)",
                      background: option.flavor === selectedFlavor ? statusColor : "transparent",
                      color: option.flavor === selectedFlavor ? "#0f172a" : "#cbd5f5",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.55,
                      cursor: "pointer",
                    }}
                  >
                    {option.flavor.toUpperCase()}
                  </button>
                ))}
              </span>
            ) : null}
            <Badge text={statusText} color={statusBadgeColor} subtle />
          </div>
        </header>

        {clipOptions.length > 0 ? (
        <ClipSelectionPanel
          plan={plan}
          clipOptions={clipOptions}
          selectedFlavor={selectedFlavor}
          onSelect={(flavor) => setSelectedFlavor(flavor)}
        />
        ) : null}
      </section>

      <section
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: 12,
          background: "rgba(12,18,26,0.6)",
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.65, textTransform: "uppercase", letterSpacing: 0.4 }}>Arbitrage timeline</div>

        <LegPrepSummary
          plan={plan}
          openStep={openPrepStep}
          closeStep={closePrepStep}
          openCandidate={openCandidate}
          closeCandidate={closeCandidate}
          viewPrep={selectedViewEntry?.prep}
        />
        {selectedOption ? <LegExecutionOverview option={selectedOption} /> : null}
        {selectedOption ? <SettlementStep option={selectedOption} /> : null}

        {plan.summary.notes.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 12 }}>
            {plan.summary.notes.map((note, idx) => (
              <li key={`${plan.asset}-${plan.direction}-note-${idx}`}>{note}</li>
            ))}
          </ul>
        ) : null}

        {plan.stages.settlement.length > 0 ? (
          <ArbPlanStageList
            plan={plan}
            stage="settlement"
            steps={plan.stages.settlement}
            inventorySnapshot={inventorySnapshot}
            selectedFlavor={selectedFlavor}
          />
        ) : null}
        {plan.stages.realisation.length > 0 ? (
          <ArbPlanStageList
            plan={plan}
            stage="realisation"
            steps={plan.stages.realisation}
            inventorySnapshot={inventorySnapshot}
            selectedFlavor={selectedFlavor}
          />
        ) : null}

        {plan.stages.preparation.length > 0 || plan.stages.execution.length > 0 ? (
          <details style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(12,18,26,0.35)" }}>
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.75 }}>Preparation & execution details</summary>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {plan.stages.preparation.length > 0 ? (
                <ArbPlanStageList
                  plan={plan}
                  stage="preparation"
                  steps={plan.stages.preparation}
                  inventorySnapshot={inventorySnapshot}
                  selectedFlavor={selectedFlavor}
                />
              ) : null}
              {plan.stages.execution.length > 0 ? (
                <ArbPlanStageList
                  plan={plan}
                  stage="execution"
                  steps={plan.stages.execution}
                  inventorySnapshot={inventorySnapshot}
                  selectedFlavor={selectedFlavor}
                />
              ) : null}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function ClipSelectionPanel({
  plan,
  clipOptions,
  selectedFlavor,
  onSelect,
}: {
  plan: ArbPlan;
  clipOptions: ClipOption[];
  selectedFlavor: ClipFlavor | null;
  onSelect: (flavor: ClipFlavor) => void;
}) {
  if (!clipOptions || clipOptions.length === 0) return null;

  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 12,
        background: "rgba(12,18,26,0.85)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.4 }}>Clip options</div>
        {clipOptions.length > 1 ? (
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            Select a clip to drive inventory prep & execution details.
          </span>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        {clipOptions.map((option, index) => (
          <ClipOptionView
            key={`${plan.asset}-${plan.direction}-clip-${option.flavor}-${index}`}
            option={option}
            selected={selectedFlavor === option.flavor}
            onSelect={() => onSelect(option.flavor)}
            plan={plan}
          />
        ))}
      </div>
    </section>
  );
}

function ClipOptionView({
  option,
  selected,
  onSelect,
  plan,
}: {
  option: ClipOption;
  selected: boolean;
  onSelect: () => void;
  plan: ArbPlan;
}) {
  const clip = option.clip;
  const clipAmountDecimal = toFiniteNumber(clip?.amountDecimal);
  const clipAmountUsd = toFiniteNumber(clip?.amountUsd);
  const clipAsset = clip?.asset ?? plan.summary.clipAsset ?? null;

  const closeExecution = option.close?.execution as ClipExecutionVariant | null | undefined;
  const { sections: flowSections, openToAsset, openFromAsset, closeToAsset } = buildClipFlowSections(
    option,
    clipAmountDecimal,
  );
  const logEntries = Array.isArray(option.open?.searchLog) ? (option.open.searchLog as ClipSearchIteration[]) : [];

  const referencePrice = toFiniteNumber(option.referencePrice ?? closeExecution?.referencePriceBefore);
  const referenceBase = closeExecution?.nativeReferenceUsdBase ?? closeExecution?.nativeRateReferenceAsset ?? openToAsset ?? openFromAsset;
  const referenceQuote = closeExecution?.nativeReferenceUsdQuote ?? closeExecution?.nativeRateStableAsset ?? closeToAsset ?? "USD";

  const mintRate = toFiniteNumber(closeExecution?.nativeRateMintPrice);
  const redeemRate = toFiniteNumber(closeExecution?.nativeRateRedeemPrice);
  const nativeSpot = toFiniteNumber(closeExecution?.nativeRateSpot);
  const nativeMa = toFiniteNumber(closeExecution?.nativeRateMovingAverage);
  const mintBasis = mintRate != null ? describeNativeBasis(mintRate, nativeSpot, nativeMa) : null;
  const redeemBasis = redeemRate != null ? describeNativeBasis(redeemRate, nativeSpot, nativeMa) : null;

  const netDisplay = option.summary?.netUsdChange != null ? formatCurrency(option.summary.netUsdChange) : "—";
  const costDisplay = option.summary?.totalCostUsd != null ? formatCurrency(option.summary.totalCostUsd) : "—";

  const clipLink = `/clip-explorer?asset=${encodeURIComponent(plan.asset)}&direction=${encodeURIComponent(plan.direction)}&flavor=${option.flavor}`;

  return (
    <section
      style={{
        border: `1px solid ${selected ? "rgba(22,199,132,0.4)" : "rgba(148,163,184,0.25)"}`,
        borderRadius: 12,
        padding: 12,
        background: selected ? "rgba(22,199,132,0.06)" : "rgba(8,12,18,0.8)",
        display: "grid",
        gap: 10,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onSelect}
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            opacity: 0.75,
            letterSpacing: 0.6,
            color: "#cbd5f5",
            textDecoration: "none",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Clip option {option.flavor.toUpperCase()}
        </button>
        <Link
          href={clipLink}
          style={{
            padding: "4px 8px",
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.35)",
            color: "#cbd5f5",
            textDecoration: "none",
            fontSize: 11,
            letterSpacing: 0.55,
            textTransform: "uppercase",
          }}
        >
          Open in Clip Explorer
        </Link>
      </header>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Stat label="Clip amount" value={renderTokenAmount(clipAmountDecimal, clipAsset, 4)} hint={clipAmountUsd != null ? formatCurrency(clipAmountUsd) : undefined} />
        <Stat label="Reference price" value={renderPriceWithPair(referencePrice, referenceBase, referenceQuote)} />
        <Stat label="Net Δ USD" value={netDisplay} />
        <Stat label="Execution cost" value={costDisplay} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {flowSections.map((section) => (
          <LegFlowCard key={section.label} label={section.label} entries={section.entries} />
        ))}
      </div>

      {(mintRate != null || redeemRate != null) && (
        <div style={{ display: "grid", gap: 4, fontSize: 12, opacity: 0.85 }}>
          {mintRate != null ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{`ZSD mint rate${mintBasis ? ` (${mintBasis})` : ""}`}</span>
              {formatRateWithInverse(mintRate)}
            </div>
          ) : null}
          {redeemRate != null ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{`ZSD redeem rate${redeemBasis ? ` (${redeemBasis})` : ""}`}</span>
              {formatRateWithInverse(redeemRate)}
            </div>
          ) : null}
        </div>
      )}

      {logEntries.length > 0 ? (
        <details style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(9,14,22,0.6)" }}>
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.75 }}>
            Calibration log ({logEntries.length})
          </summary>
          <ClipSearchLog entries={logEntries} clipAsset={clipAsset} purchasedAsset={openToAsset} />
        </details>
      ) : null}
    </section>
  );
}

function ArbPlanStageList({
  plan,
  stage,
  steps,
  inventorySnapshot,
  selectedFlavor,
}: {
  plan: ArbPlan;
  stage: ArbPlanStage;
  steps: ArbPlanStep[];
  inventorySnapshot: InventoryApiResponse | null;
  selectedFlavor: ClipFlavor | null;
}) {
  if (stage === "inventory") {
    const openSteps = steps.filter((step) => step.flavor == null);
    const closeSteps = filterStepsByFlavor(
      steps.filter((step) => step.flavor === "native" || step.flavor === "cex"),
      selectedFlavor,
    );
    const settlementSteps = steps.filter((step) => step.flavor === "bridge");

    const groupedClose = new Map<string, ArbPlanStep[]>();
    closeSteps.forEach((step) => {
      const key = step.flavor ?? "close";
      const group = groupedClose.get(key) ?? [];
      group.push(step);
      groupedClose.set(key, group);
    });

    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>{STAGE_LABELS[stage]}</div>

        {openSteps.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {openSteps.map((step) => (
              <ArbPlanStepCard key={step.id} plan={plan} step={step} inventorySnapshot={inventorySnapshot} />
            ))}
          </div>
        ) : null}

        {groupedClose.size > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {Array.from(groupedClose.entries()).map(([flavor, list]) => (
              <div
                key={`inventory-close-${flavor}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: 10,
                  background: "rgba(14,20,27,0.75)",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
                  Close leg · {flavor.toUpperCase()}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {list.map((step) => (
                    <ArbPlanStepCard
                      key={step.id}
                      plan={plan}
                      step={step}
                      inventorySnapshot={inventorySnapshot}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {settlementSteps.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {settlementSteps.map((step) => (
              <ArbPlanStepCard key={step.id} plan={plan} step={step} inventorySnapshot={inventorySnapshot} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (stage === "execution") {
    const openSteps = steps.filter((step) => !step.flavor);
    const closeSteps = filterStepsByFlavor(steps.filter((step) => step.flavor), selectedFlavor);
    const closeGroups = new Map<string, ArbPlanStep[]>();
    closeSteps.forEach((step) => {
      const key = step.flavor ?? "alt";
      const group = closeGroups.get(key) ?? [];
      group.push(step);
      closeGroups.set(key, group);
    });

    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>{STAGE_LABELS[stage]}</div>

        {openSteps.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {openSteps.map((step) => (
              <ArbPlanStepCard key={step.id} plan={plan} step={step} inventorySnapshot={inventorySnapshot} />
            ))}
          </div>
        ) : null}

        {closeGroups.size > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {Array.from(closeGroups.entries()).map(([flavor, flavorSteps]) => (
              <div
                key={`${stage}-${flavor}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: 10,
                  background: "rgba(14,20,27,0.75)",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
                  Close path · {flavor.toUpperCase()}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {flavorSteps.map((step) => (
                    <ArbPlanStepCard key={step.id} plan={plan} step={step} inventorySnapshot={inventorySnapshot} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const displaySteps = filterStepsByFlavor(steps, selectedFlavor);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>{STAGE_LABELS[stage]}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {displaySteps.map((step) => (
          <ArbPlanStepCard
            key={step.id}
            plan={plan}
            step={step}
            inventorySnapshot={inventorySnapshot}
          />
        ))}
      </div>
    </div>
  );
}

function ArbPlanStepCard({
  plan,
  step,
  inventorySnapshot,
}: {
  plan: ArbPlan;
  step: ArbPlanStep;
  inventorySnapshot: InventoryApiResponse | null;
}) {
  const allowed = !step.blocked;
  const borderColor = allowed ? "rgba(22,199,132,0.35)" : "rgba(244,91,105,0.45)";
  const background = allowed ? "rgba(22,199,132,0.05)" : "rgba(244,91,105,0.08)";
  const isPreparation = step.stage === "preparation";
  const isInventory = step.stage === "inventory";
  const showDetails = !step.skip;
  const score = showDetails ? step.path?.score : null;
  const costText =
    showDetails && score?.totalCostUsd != null && Number.isFinite(score.totalCostUsd)
      ? formatCurrency(score.totalCostUsd)
      : null;
  const netText =
    showDetails && step.path?.netUsdChangeUsd != null && Number.isFinite(step.path.netUsdChangeUsd)
      ? formatCurrency(step.path.netUsdChangeUsd)
      : null;

  const pathLabel = !isInventory && showDetails ? (step.path ? step.path.path.assets.join(" → ") : step.description) : null;
  const amountLabel = !isInventory && showDetails ? describeStepAmount(step) : null;
  const linkHref = isPreparation ? buildLegPrepHref(plan, step) : null;
  const Wrapper: any = linkHref ? "a" : "div";

  return (
    <Wrapper
      {...(linkHref ? { href: linkHref } : {})}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: 10,
        background,
        display: "grid",
        gap: 6,
        textDecoration: "none",
        color: "inherit",
        cursor: linkHref ? "pointer" : "default",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{step.label}</div>
      {step.skip ? (
        <div style={{ fontSize: 12, color: "#16c784", opacity: 0.85 }}>No preparation required — sufficient inventory.</div>
      ) : null}
      {isInventory ? (
        renderInventoryDetails(step.inventoryDetails ?? [], inventorySnapshot)
      ) : (
        <>
          {pathLabel ? <div style={{ fontSize: 12, opacity: 0.75 }}>{pathLabel}</div> : null}
          {amountLabel ? <div style={{ fontSize: 12, opacity: 0.75 }}>{amountLabel}</div> : null}
        </>
      )}
      {showDetails && step.notes && step.notes.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2, fontSize: 12 }}>
          {step.notes.map((note, idx) => (
            <li key={`${step.id}-note-${idx}`}>{note}</li>
          ))}
        </ul>
      ) : null}
      {!isInventory && showDetails && (costText || netText) ? (
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {[costText ? `Cost: ${costText}` : null, netText ? `Δ USD: ${netText}` : null]
            .filter(Boolean)
            .join(" • ")}
        </div>
      ) : null}
    </Wrapper>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 12,
        background: "#101720",
        display: "grid",
        gap: 4,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.65 }}>{hint}</div> : null}
    </div>
  );
}

function renderTokenAmount(value: number | string | null | undefined, asset?: string | null, fractionDigits = 6): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  const formatted = numeric.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>{formatted}</span>
      {asset ? <AssetBadge asset={asset} /> : null}
    </span>
  );
}

function renderFlowEntries(entries: FlowEntry[]): ReactNode {
  const unique = new Map<string, FlowEntry>();
  entries.forEach((entry) => {
    if (!entry.asset || entry.amount == null) return;
    const key = `${entry.asset}-${entry.amount}`;
    if (!unique.has(key)) unique.set(key, entry);
  });
  const visible = Array.from(unique.values());
  if (visible.length === 0) {
    return <span style={{ opacity: 0.6 }}>—</span>;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {visible.map((entry, index) => (
        <span key={`${entry.asset}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {renderTokenAmount(entry.amount, entry.asset)}
        </span>
      ))}
    </div>
  );
}

function renderPriceWithPair(value: number | string | null | undefined, base?: string | null, quote?: string | null): ReactNode {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  if (!base || !quote) return numeric.toFixed(6);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{numeric.toFixed(6)}</span>
      <AssetPair base={base} quote={quote} size={14} mode="combined" />
    </span>
  );
}

function formatRateWithInverse(rate: number | string | null | undefined): ReactNode {
  const numeric = toFiniteNumber(rate);
  if (numeric == null || numeric <= 0) return "—";
  const inverse = numeric !== 0 ? 1 / numeric : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{numeric.toFixed(6)}</span>
      {inverse != null ? <span style={{ opacity: 0.6 }}>{`(${inverse.toFixed(6)})`}</span> : null}
    </span>
  );
}

function LegPrepSummary({
  plan,
  openStep,
  closeStep,
  openCandidate,
  closeCandidate,
  viewPrep,
}: {
  plan: ArbPlan;
  openStep: ArbPlanStep | null;
  closeStep: ArbPlanStep | null;
  openCandidate: QuoterAwareCandidate | null;
  closeCandidate: QuoterAwareCandidate | null;
  viewPrep?: {
    open: ArbPlanLegPrepView | null;
    close: ArbPlanLegPrepView | null;
  } | null;
}) {
  const openContext = buildPrepContext("Open leg prep", viewPrep?.open, openCandidate, openStep, plan);
  const closeContext = buildPrepContext("Close leg prep", viewPrep?.close, closeCandidate, closeStep, plan);
  if (!openContext && !closeContext) return null;
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase" }}>Inventory prep</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {openContext ? <PrepCard context={openContext} /> : null}
        {closeContext ? <PrepCard context={closeContext} /> : null}
      </div>
    </section>
  );
}

function LegExecutionOverview({ option }: { option: ClipOption }) {
  const { sections, openFromAsset, closeToAsset } = buildClipFlowSections(option);
  const openSection = sections.find((section) => section.label === "Open leg");
  const closeSection = sections.find((section) => section.label === "Close leg");
  const intermediateSection = sections.find((section) => section.label === "Intermediate");
  if (!openSection && !closeSection) return null;

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase" }}>Arb leg overview</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {openSection ? (
          <LegFlowCard
            label={`Open leg${openFromAsset ? ` · ${openFromAsset}` : ""}`}
            entries={openSection.entries}
          />
        ) : null}
        {closeSection ? (
          <LegFlowCard
            label={`Close leg${closeToAsset ? ` · ${closeToAsset}` : ""}`}
            entries={closeSection.entries}
          />
        ) : null}
      </div>
      {intermediateSection && intermediateSection.entries.length > 0 ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "10px 12px",
            background: "rgba(6,10,16,0.65)",
            display: "grid",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase" }}>Intermediate assets</span>
          {renderFlowEntries(intermediateSection.entries)}
        </div>
      ) : null}
    </section>
  );
}

function SettlementStep({ option }: { option: ClipOption }) {
  const { sections, closeToAsset } = buildClipFlowSections(option);
  const closeSection = sections.find((section) => section.label === "Close leg");
  const closeEntry = closeSection?.entries[0] ?? null;
  const finalAsset = (closeEntry?.asset as string | null) ?? closeToAsset;
  const amount = closeEntry?.amount ?? option.clip?.amountDecimal ?? null;
  const alreadyStable = isStableAsset(finalAsset);
  const targetAsset = alreadyStable ? finalAsset : "WZSD.e";
  const entries: FlowEntry[] = alreadyStable
    ? [{ amount, asset: finalAsset }]
    : [
        { amount, asset: finalAsset },
        { amount, asset: targetAsset },
      ];

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase" }}>Settlement</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <LegFlowCard label="Preferred payout" entries={entries} />
      </div>
      <span style={{ fontSize: 12, opacity: 0.75 }}>
        {alreadyStable
          ? "Close leg already yields a stable balance; mark settlement as complete."
          : `Convert final proceeds into ${targetAsset} before booking profit.`}
      </span>
    </section>
  );
}

function PrepCard({
  context,
}: {
  context: PrepContext;
}) {
  const { label, evaluation, amount, href, inventoryStatus, candidates, primaryKey, primaryCandidate, needAsset } = context;
  if (!evaluation) return null;
  const score = evaluation.score;
  const inventoryMeta = describeInventoryStatusMeta(inventoryStatus ?? evaluation.inventory?.status ?? "unknown");
  const priceMap = buildPriceMap(evaluation);
  const otherCandidates = candidates.filter((candidate) => candidateSignature(candidate) !== primaryKey);
  const displayCandidate = primaryCandidate ?? candidates[0] ?? null;

  return (
    <div
      style={{
        border: "1px solid rgba(82,113,255,0.25)",
        borderRadius: 10,
        padding: 12,
        background: "rgba(10,15,23,0.85)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <Badge text={inventoryMeta.text} color={inventoryMeta.color} subtle />
      </div>
      {displayCandidate ? (
        <PrepPathMeta candidate={displayCandidate} evaluation={evaluation} needAsset={needAsset} />
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <MiniMetric label="Cost" value={formatUsdInline(score?.totalCostUsd)} />
        <MiniMetric label="Net Δ USD" value={formatUsdInline(score?.netUsdChangeUsd)} />
        <MiniMetric label="Hops" value={score?.hopCount != null ? score.hopCount.toString() : "—"} />
      </div>
      <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(6,10,16,0.7)" }}>
        <PathTimeline
          evaluation={evaluation}
          startAmount={amount ?? null}
          priceMap={priceMap}
          formatUsd={formatUsdInline}
          formatBps={formatBps}
        />
      </div>
      {otherCandidates.length > 0 ? (
        <CandidateDrawer candidates={otherCandidates} />
      ) : null}
      {href ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link
            href={href}
            style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#9ac5ff" }}
          >
            View full prep →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function LegFlowCard({ label, entries }: { label: string; entries: FlowEntry[] }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "8px 10px",
        background: "rgba(6,10,16,0.7)",
        display: "grid",
        gap: 4,
        minWidth: 180,
      }}
    >
      <span style={{ fontSize: 10, opacity: 0.65, textTransform: "uppercase" }}>{label}</span>
      {renderFlowEntries(entries)}
    </div>
  );
}

function PrepPathMeta({
  candidate,
  evaluation,
  needAsset,
}: {
  candidate: QuoterAwareCandidate;
  evaluation: PathEvaluation;
  needAsset: AssetId | null;
}) {
  const pathAssets = Array.isArray(candidate.path.assets) ? candidate.path.assets : [];
  const sourceAsset = candidate.source;
  const fallbackTarget =
    pathAssets.length > 0 ? (pathAssets[pathAssets.length - 1] as AssetId) : (sourceAsset as AssetId);
  const targetAsset = (needAsset ?? fallbackTarget ?? sourceAsset) as AssetId;
  const needAmountDecimal = unitsToDecimal(candidate.amountIn, sourceAsset);
  const targetAmountDecimal =
    unitsToDecimal(evaluation.finalAmountOut ?? null, targetAsset) ?? null;
  const inventory = describeNeedVsInventory(evaluation, sourceAsset);
  const shortfallBadge =
    inventory.shortfall != null && inventory.shortfall > 0
      ? `Short ${formatNumber(inventory.shortfall, inventory.shortfall >= 1 ? 2 : 4)}`
      : null;

  const labelStyle: CSSProperties = {
    fontSize: 11,
    opacity: 0.65,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <div style={labelStyle}>Path</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
          {renderAssetPath(pathAssets.length > 0 ? pathAssets : ([sourceAsset, targetAsset].filter(Boolean) as string[]))}
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={labelStyle}>Need & inventory</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={labelStyle}>Need</span>
          <AssetBadge asset={sourceAsset} amount={needAmountDecimal} amountDigits={4} />
          <span style={labelStyle}>Inventory</span>
          {inventory.available != null ? (
            <AssetBadge asset={sourceAsset} amount={inventory.available} amountDigits={4} />
          ) : (
            <span style={{ fontSize: 12, opacity: 0.6 }}>unknown</span>
          )}
          {shortfallBadge ? <Badge text={shortfallBadge} color="#f45b69" subtle /> : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={labelStyle}>Target</span>
          <AssetBadge asset={targetAsset} amount={targetAmountDecimal} amountDigits={4} />
        </div>
      </div>
    </div>
  );
}

function renderAssetPath(assets: string[]): ReactNode {
  if (!assets || assets.length === 0) {
    return <span style={{ opacity: 0.6 }}>—</span>;
  }
  const nodes: ReactNode[] = [];
  assets.forEach((asset, index) => {
    nodes.push(<AssetBadge key={`path-asset-${asset}-${index}`} asset={asset} size={16} />);
    if (index < assets.length - 1) {
      nodes.push(
        <span key={`path-arrow-${asset}-${index}`} style={{ opacity: 0.4, fontSize: 14 }}>
          →
        </span>,
      );
    }
  });
  return <>{nodes}</>;
}
