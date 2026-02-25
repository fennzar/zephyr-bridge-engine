import type { ReactNode } from "react";

import { AssetBadge, AssetPair, formatOperationLabel, stripVariantSuffix } from "@/components/AssetBadge";
import { formatCurrency as formatUsd, toFiniteNumber } from "@shared/format";

import type {
  ClipLegSectionProps,
  ClipOptionCardProps,
  ClipOptionResponse,
  InfoEntry,
  OverviewMetric,
} from "./clipExplorer.types";
import {
  buildCostEntries,
  buildInventorySummary,
  buildPairLabelFromAssets,
  buildReferenceLabel,
  computePercentDiff,
  describeNativeBasis,
  deriveCandidateSourceAsset,
  deriveCandidateTerminalAsset,
  extractCandidatePath,
  extractCandidateSource,
  formatBps,
  formatPercent,
  formatPrice,
  formatRateWithInverse,
  formatValue,
  renderHint,
  renderFlowEntries,
  renderPriceWithPair,
  renderTokenAmount,
  sumCapitalUsage,
  sumCostEntries,
  sumTradeUsdChanges,
} from "./clipExplorer.helpers";
import { ClipOverviewPanel } from "./ClipOverviewPanel";
import { ClipDetailCard } from "./ClipDetailCard";
import { FlowArrow, FlowCard, OperationChipRow } from "./ClipFlow";
import { SearchLog } from "./ClipSearchLogTable";
import { InventorySummary } from "./ClipInventorySummary";
import { CostSummary } from "./ClipCostSummary";
import { InfoGrid } from "./ClipInfoGrid";

export function ClipOptionCard({ option, index, pool, asset, direction, zephSpotUsd }: ClipOptionCardProps) {
  const openExecution = option.open.execution;
  const closeExecution = option.close.execution;
  const searchLogEntries = option.open.searchLog;
  if (!searchLogEntries || searchLogEntries.length === 0) {
    throw new Error("ClipOptionCard requires calibration log");
  }
  const finalLogEntry = searchLogEntries[searchLogEntries.length - 1];
  const initialLogEntry = searchLogEntries[0];

  const openFromAsset =
    openExecution?.fromAsset ?? deriveCandidateSourceAsset(option.open.candidate) ?? option.clip.asset;
  const openToAsset = openExecution?.toAsset ?? deriveCandidateTerminalAsset(option.open.candidate) ?? null;
  const closeFromAsset = closeExecution?.fromAsset ?? deriveCandidateSourceAsset(option.close.candidate) ?? openToAsset;
  const closeToAsset = closeExecution?.toAsset ?? deriveCandidateTerminalAsset(option.close.candidate) ?? null;

  const optionAssetSymbol = stripVariantSuffix(asset);
  const isZephNative = option.flavor === "native" && optionAssetSymbol === "ZEPH";
  const hasNativeStableRate = option.flavor === "native" && Boolean(closeExecution?.nativeRateStableAsset);
  const openPair = { base: openFromAsset ?? null, quote: openToAsset ?? null };
  const closePair = { base: closeFromAsset ?? null, quote: closeToAsset ?? null };
  const closePairLabel = buildPairLabelFromAssets(closePair.base, closePair.quote);
  const openPairBadge =
    openPair.base && openPair.quote ? (
      <AssetPair base={openPair.base} quote={openPair.quote} size={14} mode="combined" />
    ) : null;
  const closePairBadge =
    closePair.base && closePair.quote ? (
      <AssetPair base={closePair.base} quote={closePair.quote} size={14} mode="combined" />
    ) : null;
  const openReferenceContext = openExecution ? (buildReferenceLabel(openExecution) ?? "Pool price") : "Pool price";
  const closeReferenceContextRaw = closeExecution
    ? (buildReferenceLabel(closeExecution) ?? (option.flavor === "cex" ? "CEX reference" : "Native reference"))
    : option.flavor === "cex"
      ? "CEX reference"
      : "Native reference";
  const nativeReferenceSpotRaw = option.flavor === "native" ? (closeExecution?.nativeReferenceSpotUsd ?? null) : null;
  const nativeReferenceSpot = hasNativeStableRate ? nativeReferenceSpotRaw : null;
  const zephSpotReference = isZephNative ? (zephSpotUsd ?? null) : null;
  const nativeRateSpotValue = option.flavor === "native" ? toFiniteNumber(closeExecution?.nativeRateSpot) : null;
  const nativeRateMovingAverageValue =
    option.flavor === "native" ? toFiniteNumber(closeExecution?.nativeRateMovingAverage) : null;
  const mintRateValue = option.flavor === "native" ? toFiniteNumber(closeExecution?.nativeRateMintPrice) : null;
  const redeemRateValue = option.flavor === "native" ? toFiniteNumber(closeExecution?.nativeRateRedeemPrice) : null;
  const mintBasisLabel = describeNativeBasis(mintRateValue, nativeRateSpotValue, nativeRateMovingAverageValue);
  const redeemBasisLabel = describeNativeBasis(redeemRateValue, nativeRateSpotValue, nativeRateMovingAverageValue);
  const closeReferenceContext = option.flavor === "native" && isZephNative ? "Spot price" : closeReferenceContextRaw;
  const initialPrice = option.initialPrice ?? initialLogEntry.poolPriceAfter ?? null;
  let referencePrice: number | null;
  if (isZephNative) {
    referencePrice = zephSpotReference;
  } else if (option.referencePrice != null) {
    referencePrice = option.referencePrice;
  } else if (option.flavor === "native") {
    referencePrice = nativeReferenceSpot;
  } else {
    referencePrice =
      closeExecution?.referencePriceBefore ??
      closeExecution?.effectivePrice ??
      initialLogEntry.counterPriceAfter ??
      null;
  }
  const calibratedPrice = finalLogEntry.poolPriceAfter;
  const calibratedVsInitial = computePercentDiff(initialPrice, calibratedPrice);
  const calibratedVsReference = computePercentDiff(referencePrice, calibratedPrice);
  const averageEntryPrice =
    finalLogEntry.openAmountOutDecimal != null && finalLogEntry.amountDecimal > 0
      ? finalLogEntry.openAmountOutDecimal / finalLogEntry.amountDecimal
      : null;
  const openTargetPrice = finalLogEntry.targetPrice ?? referencePrice ?? calibratedPrice;
  const closeTargetPrice = option.targetPrice ?? referencePrice ?? calibratedPrice;
  const nativeReferenceBase = "ZEPH";
  const nativeReferenceQuote = "USD";
  const zephUsdPairBadge = <AssetPair base="ZEPH" quote="USD" size={14} mode="combined" />;
  const initialPriceHint = renderHint([openReferenceContext, openPairBadge]);
  let referenceBadge: string | null = null;
  if (option.flavor === "native") {
    referenceBadge = "Native";
  } else if (option.flavor === "cex") {
    referenceBadge = "CEX";
  }
  const referenceMetricValue =
    option.flavor === "native" && isZephNative
      ? renderPriceWithPair(referencePrice, nativeReferenceBase, nativeReferenceQuote)
      : renderPriceWithPair(referencePrice, closePair.base, closePair.quote);
  const referencePriceHint =
    option.flavor === "native" && isZephNative ? renderHint([zephUsdPairBadge]) : renderHint([closePairBadge]);

  const openCandidateSource = extractCandidateSource(option.open.candidate);
  const closeCandidateSource = extractCandidateSource(option.close.candidate);
  const openPathInfo = extractCandidatePath(option.open.candidate, openFromAsset, openToAsset);
  const closePathInfo = extractCandidatePath(option.close.candidate, closeFromAsset, closeToAsset);
  const openStepLabels = openPathInfo.steps
    .map((step) => formatOperationLabel(step))
    .filter((label): label is string => Boolean(label));
  const closeStepLabels = closePathInfo.steps
    .map((step) => formatOperationLabel(step))
    .filter((label): label is string => Boolean(label));
  const inventoryGroups = buildInventorySummary(option);
  const netUsdChange = sumTradeUsdChanges(inventoryGroups);
  const capitalDeployedUsd = sumCapitalUsage(inventoryGroups);
  const costEntries = buildCostEntries(option);
  const totalFeesUsd = sumCostEntries(costEntries, "fee");
  const totalGasUsd = sumCostEntries(costEntries, "gas");
  const totalCostUsd = totalFeesUsd + totalGasUsd;
  const estimatedProfitUsd =
    option.summary.netUsdChange != null ? option.summary.netUsdChange - totalCostUsd : netUsdChange;

  const clipUsdHint = option.clip.amountUsd != null ? renderHint([formatUsd(option.clip.amountUsd)]) : null;

  const overviewMetrics: OverviewMetric[] = [
    {
      label: "Initial price",
      value: renderPriceWithPair(initialPrice, openPair.base, openPair.quote),
      hint: initialPriceHint,
      variant: "price",
    },
    {
      label: "Calibrated price",
      value: renderPriceWithPair(calibratedPrice, openPair.base, openPair.quote),
      hint: renderHint([
        calibratedVsInitial != null ? `vs initial ${formatPercent(calibratedVsInitial)}` : null,
        calibratedVsReference != null ? `vs reference ${formatPercent(calibratedVsReference)}` : null,
      ]),
      variant: "price-final",
      tone:
        finalLogEntry.priceDiffBps == null
          ? undefined
          : finalLogEntry.priceDiffBps > 0
            ? "negative"
            : finalLogEntry.priceDiffBps < 0
              ? "positive"
              : undefined,
    },
    {
      label: "Reference price",
      value: referenceMetricValue,
      variant: "price",
      badge: referenceBadge,
      badgeAlign: "right",
    },
    {
      label: "Clip size",
      value: (
        <AssetBadge
          asset={option.clip.asset}
          amount={option.clip.amountDecimal}
          amountDigits={2}
          compactAmount={false}
          showLabel
        />
      ),
      hint: clipUsdHint,
    },
    {
      label: "Expected fill",
      value: (
        <AssetBadge
          asset={openToAsset ?? option.clip.asset}
          amount={finalLogEntry.openAmountOutDecimal}
          amountDigits={2}
          compactAmount={false}
          showLabel
        />
      ),
    },
    {
      label: "Capital deployed",
      value: capitalDeployedUsd != null ? formatUsd(capitalDeployedUsd) : "—",
    },
    {
      label: "Net Δ USD",
      value: netUsdChange != null ? formatUsd(netUsdChange) : "—",
      tone: netUsdChange != null ? (netUsdChange >= 0 ? "positive" : "negative") : undefined,
    },
    {
      label: "Execution cost",
      value: formatUsd(-totalCostUsd),
      tone: totalCostUsd > 0 ? "negative" : undefined,
    },
    {
      label: "Estimated profit",
      value: estimatedProfitUsd != null ? formatUsd(estimatedProfitUsd) : "—",
      tone: estimatedProfitUsd != null ? (estimatedProfitUsd >= 0 ? "positive" : "negative") : undefined,
    },
  ];

  const openTradeEntries: InfoEntry[] = [
    {
      label: "Clip amount",
      value: renderTokenAmount(option.clip.amountDecimal, option.clip.asset),
    },
    {
      label: "Expected fill",
      value: renderTokenAmount(finalLogEntry.openAmountOutDecimal, openToAsset),
    },
  ];
  if (averageEntryPrice != null) {
    openTradeEntries.push({
      label: "Average price",
      value: renderPriceWithPair(averageEntryPrice, openPair.base, openPair.quote),
      hint: renderHint([openPairBadge]),
    });
  }

  const openPriceEntries: InfoEntry[] = [
    {
      label: openReferenceContext,
      value: renderPriceWithPair(initialPrice, openPair.base, openPair.quote),
      hint: renderHint([openPairBadge]),
      align: "start",
    },
    {
      label: "Calibrated pool price",
      value: renderPriceWithPair(calibratedPrice, openPair.base, openPair.quote),
      hint: renderHint([
        calibratedVsInitial != null ? `vs initial ${formatPercent(calibratedVsInitial)}` : null,
        calibratedVsReference != null ? `vs reference ${formatPercent(calibratedVsReference)}` : null,
      ]),
      tone:
        finalLogEntry.priceDiffBps == null
          ? undefined
          : finalLogEntry.priceDiffBps > 0
            ? "negative"
            : finalLogEntry.priceDiffBps < 0
              ? "positive"
              : undefined,
      align: "start",
    },
    {
      label: "Target price",
      value: renderPriceWithPair(openTargetPrice, openPair.base, openPair.quote),
      align: "start",
    },
  ];

  const closeTradeEntries: InfoEntry[] = [
    {
      label: "Amount in",
      value: renderTokenAmount(finalLogEntry.openAmountOutDecimal, closeFromAsset, 8),
    },
    {
      label: "Amount out",
      value: renderTokenAmount(finalLogEntry.closeAmountOutDecimal, closeToAsset, 8),
    },
  ];
  const closeAveragePrice =
    finalLogEntry.closeAmountOutDecimal != null && finalLogEntry.openAmountOutDecimal != null
      ? finalLogEntry.closeAmountOutDecimal / finalLogEntry.openAmountOutDecimal
      : null;
  if (!(option.flavor === "native" && hasNativeStableRate) && closeAveragePrice != null) {
    closeTradeEntries.push({
      label: "Average price",
      value: renderPriceWithPair(closeAveragePrice, closePair.base, closePair.quote),
      hint: renderHint([closePairBadge]),
    });
  }

  const closePriceEntries = buildClosePriceEntries({
    option,
    closeReferenceContext,
    referenceMetricValue,
    referencePriceHint,
    mintRateValue,
    mintBasisLabel,
    redeemRateValue,
    redeemBasisLabel,
    closeVenuePrice: finalLogEntry.counterPriceAfter,
    closePairBadge: closePairBadge,
    poolPriceAfter: finalLogEntry.poolPriceAfter,
    closeTargetPrice,
    closeGapBps: finalLogEntry.targetDiffBps,
    nativeReferenceSpot,
    nativeReferenceBadge: zephSpotReference != null ? zephUsdPairBadge : null,
  });

  const openFlowContent = renderFlowEntries([{ amount: finalLogEntry.amountDecimal, asset: openFromAsset }]);
  const intermediateFlowContent = renderFlowEntries([
    { amount: finalLogEntry.openAmountOutDecimal, asset: openToAsset },
    { amount: finalLogEntry.openAmountOutDecimal, asset: closeFromAsset },
  ]);
  const closeFlowContent = renderFlowEntries([{ amount: finalLogEntry.closeAmountOutDecimal, asset: closeToAsset }]);

  return (
    <section
      style={{
        display: "grid",
        gap: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 18,
        background: "rgba(8,12,20,0.55)",
      }}
    >
      <ClipOverviewPanel
        optionLabel={`Option ${index + 1}`}
        asset={asset}
        direction={direction}
        flavor={option.flavor}
        metrics={overviewMetrics}
      />

      <div style={{ display: "grid", gap: 12 }}>
        <ClipDetailCard title="Leg flow" style={{ paddingBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 12 }}>
            <FlowCard title="Open leg" tone="open" labels={openStepLabels}>
              {openFlowContent}
            </FlowCard>
            <FlowArrow />
            <FlowCard title="Intermediate asset" tone="bridge">
              {intermediateFlowContent}
            </FlowCard>
            <FlowArrow />
            <FlowCard
              title={option.flavor === "native" ? "Close leg · native" : "Close leg · CEX"}
              tone={option.flavor === "native" ? "close-native" : "close-cex"}
              labels={closeStepLabels}
            >
              {closeFlowContent}
            </FlowCard>
          </div>
        </ClipDetailCard>

        <ClipDetailCard title="Calibration search log">
          <SearchLog
            entries={searchLogEntries}
            clipAsset={option.clip.asset}
            purchasedAsset={openToAsset}
            initialPoolPrice={initialPrice}
            referencePrice={referencePrice}
            targetPrice={closeTargetPrice}
          />
        </ClipDetailCard>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
        }}
      >
        <ClipDetailCard title="Open leg details">
          <ClipLegSection
            flavorBadge="open"
            flavorTone="open"
            rawLabel="Open leg candidate"
            rawCandidate={option.open.candidate}
            metaEntries={
              [
                openCandidateSource ? { label: "Source", value: openCandidateSource, align: "start" } : null,
                { label: "Steps", value: openPathInfo.steps.length.toString(), align: "start" },
                openStepLabels.length > 0
                  ? { label: "Operations", value: <OperationChipRow labels={openStepLabels} />, align: "start" }
                  : null,
              ].filter(Boolean) as InfoEntry[]
            }
            tradeEntries={openTradeEntries}
            priceEntries={openPriceEntries}
          />
        </ClipDetailCard>

        <ClipDetailCard title="Close leg details">
          <ClipLegSection
            flavorBadge={option.flavor === "native" ? "native close" : "cex close"}
            flavorTone={option.flavor === "native" ? "close-native" : "close-cex"}
            rawLabel="Close leg candidate"
            rawCandidate={option.close.candidate}
            metaEntries={
              [
                closeCandidateSource ? { label: "Source", value: closeCandidateSource, align: "start" } : null,
                { label: "Steps", value: closePathInfo.steps.length.toString(), align: "start" },
                closeStepLabels.length > 0
                  ? { label: "Operations", value: <OperationChipRow labels={closeStepLabels} />, align: "start" }
                  : null,
              ].filter(Boolean) as InfoEntry[]
            }
            tradeEntries={closeTradeEntries}
            priceEntries={closePriceEntries}
          />
        </ClipDetailCard>
      </div>

      <ClipDetailCard title="Pool snapshot">
        {pool ? <ClipPoolDetails pool={pool} /> : <span style={{ opacity: 0.7 }}>Pool details unavailable.</span>}
      </ClipDetailCard>

      <ClipDetailCard title="Inventory & balances">
        <InventorySummary
          groups={inventoryGroups}
          netUsdChange={netUsdChange}
          capitalDeployedUsd={capitalDeployedUsd}
        />
      </ClipDetailCard>

      <ClipDetailCard title="Cost breakdown">
        <CostSummary
          costEntries={costEntries}
          totalFeesUsd={totalFeesUsd}
          totalGasUsd={totalGasUsd}
          totalCostUsd={totalCostUsd}
          estimatedProfitUsd={estimatedProfitUsd}
          notes={option.summary.notes}
        />
      </ClipDetailCard>
    </section>
  );
}

function buildClosePriceEntries({
  option,
  closeReferenceContext,
  referenceMetricValue,
  referencePriceHint,
  mintRateValue,
  mintBasisLabel,
  redeemRateValue,
  redeemBasisLabel,
  closeVenuePrice,
  closePairBadge,
  poolPriceAfter,
  closeTargetPrice,
  closeGapBps,
  nativeReferenceSpot,
  nativeReferenceBadge,
}: {
  option: ClipOptionResponse;
  closeReferenceContext: string | null;
  referenceMetricValue: ReactNode;
  referencePriceHint: ReactNode;
  mintRateValue: number | null;
  mintBasisLabel: string | null;
  redeemRateValue: number | null;
  redeemBasisLabel: string | null;
  closeVenuePrice: number | null;
  closePairBadge: ReactNode;
  poolPriceAfter: number | null;
  closeTargetPrice: number | null;
  closeGapBps: number | null;
  nativeReferenceSpot: number | null;
  nativeReferenceBadge: ReactNode;
}): InfoEntry[] {
  const entries: InfoEntry[] = [
    {
      label: closeReferenceContext ?? "Reference price",
      value: referenceMetricValue,
      hint: referencePriceHint,
      align: "start",
    },
  ];

  if (option.flavor === "native" && nativeReferenceSpot != null) {
    entries.push({
      label: "Native spot",
      value: renderPriceWithPair(nativeReferenceSpot, "ZEPH", "USD"),
      hint: renderHint([nativeReferenceBadge]),
      align: "start",
    });
  }

  if (option.flavor === "native" && mintRateValue != null) {
    entries.push({
      label: `ZSD mint rate${mintBasisLabel ? ` (${mintBasisLabel})` : ""}`,
      value: formatRateWithInverse(mintRateValue),
      align: "start",
    });
  }

  if (option.flavor === "native" && redeemRateValue != null) {
    entries.push({
      label: `ZSD redeem rate${redeemBasisLabel ? ` (${redeemBasisLabel})` : ""}`,
      value: formatRateWithInverse(redeemRateValue),
      align: "start",
    });
  }

  if (closeVenuePrice != null) {
    entries.push({
      label: "Close venue price",
      value: renderPriceWithPair(closeVenuePrice, null, null),
      hint: renderHint([closePairBadge]),
    });
  }

  entries.push({
    label: "Pool price",
    value: formatPrice(poolPriceAfter),
  });

  if (closeTargetPrice != null) {
    entries.push({
      label: "Reference target",
      value: formatPrice(closeTargetPrice),
    });
  }

  if (closeGapBps != null) {
    entries.push({
      label: "Gap (bps)",
      value: formatBps(closeGapBps),
      tone: closeGapBps > 0 ? "negative" : closeGapBps < 0 ? "positive" : undefined,
    });
  }

  return entries;
}

function ClipLegSection({
  metaEntries = [],
  tradeEntries = [],
  priceEntries = [],
  flavorBadge,
  flavorTone,
  rawLabel,
  rawCandidate,
}: ClipLegSectionProps) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {flavorBadge ? (
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            alignSelf: "start",
            justifySelf: "start",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            background:
              flavorTone === "close-native"
                ? "rgba(22,199,132,0.18)"
                : flavorTone === "close-cex"
                  ? "rgba(99,102,241,0.14)"
                  : flavorTone === "bridge"
                    ? "rgba(148,163,184,0.18)"
                    : "rgba(59,130,246,0.18)",
            border:
              flavorTone === "close-native"
                ? "1px solid rgba(22,199,132,0.45)"
                : flavorTone === "close-cex"
                  ? "1px solid rgba(99,102,241,0.28)"
                  : flavorTone === "bridge"
                    ? "1px solid rgba(148,163,184,0.35)"
                    : "1px solid rgba(59,130,246,0.35)",
            color:
              flavorTone === "close-native"
                ? "#6fe3b3"
                : flavorTone === "close-cex"
                  ? "#c7d2fe"
                  : flavorTone === "bridge"
                    ? "#d6dde7"
                    : "#9ec5ff",
          }}
        >
          {flavorBadge}
        </span>
      ) : null}
      {tradeEntries.length > 0 ? <InfoGrid entries={tradeEntries} /> : null}
      {priceEntries.length > 0 ? <InfoGrid entries={priceEntries} /> : null}
      {metaEntries.length > 0 ? <InfoGrid entries={metaEntries} /> : null}
      <details>
        <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.75 }}>{rawLabel}</summary>
        <pre style={{ margin: "8px 0 0", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {rawCandidate ? JSON.stringify(rawCandidate, null, 2) : "null"}
        </pre>
      </details>
    </div>
  );
}

function ClipPoolDetails({ pool }: { pool: Record<string, unknown> }) {
  const entries = Object.entries(pool)
    .filter(([_, value]) => value != null)
    .slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
      <div style={{ opacity: 0.6, textTransform: "uppercase" }}>Pool snapshot</div>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ opacity: 0.75 }}>{key}</span>
          <span>{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
}
