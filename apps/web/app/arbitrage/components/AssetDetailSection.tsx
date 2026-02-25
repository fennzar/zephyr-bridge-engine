import type { ReactNode } from "react";

import {
  formatAssetStatus,
  type ArbAsset,
  type ArbPlan,
} from "@domain/arbitrage";
import {
  formatBps,
  formatCurrency,
  formatNumber,
  formatSignedRateWithUnit,
} from "@shared/format";
import type { InventoryApiResponse } from "@domain/inventory/types.api";
import type { PoolOverview } from "@services/evm/uniswapV4";

import { ArbSection, ArbBadge, ArbStat } from "./ArbLayout";
import { ArbPlanSection } from "./ArbPlanSection";
import { AssetPoolsTable } from "./AssetPoolsTable";
import { ArbOpportunityCard } from "./ArbOpportunityCard";

export function AssetDetailSection({
  overview,
  plans,
  plannerError,
  inventorySnapshot,
}: {
  overview: ArbAsset;
  plans: ArbPlan[];
  plannerError: string | null;
  inventorySnapshot: InventoryApiResponse | null;
}) {
  const associatedPools = extractAssociatedPools(overview);

  const comparison = overview.primaryComparison;
  const status = overview.status;

  const dexRateDisplay = renderDexStatValue(overview.pricing.dex);
  const nativeRateDisplay = renderNativeStatValue(overview.pricing.native);
  const unitSymbol = comparison?.unitSymbol ?? overview.wrappedSymbol;

  const referenceDifference =
    comparison &&
    Number.isFinite(comparison.dexPrice ?? Number.NaN) &&
    Number.isFinite(status.referencePrice ?? Number.NaN)
      ? (comparison.dexPrice as number) - (status.referencePrice as number)
      : null;
  const referenceDifferenceUsd =
    comparison &&
    Number.isFinite(comparison.dexPriceUsd ?? Number.NaN) &&
    Number.isFinite(status.referencePriceUsd ?? Number.NaN)
      ? (comparison.dexPriceUsd as number) - (status.referencePriceUsd as number)
      : null;

  const statusColor = status.mode === "aligned" ? "#9AA0AA" : status.mode === "premium" ? "#16c784" : "#f45b69";

  return (
    <ArbSection
      id={`asset-${overview.asset.toLowerCase()}`}
      title={`${overview.asset} ↔ ${overview.wrappedSymbol}`}
      subtitle={formatAssetStatus(overview)}
    >
      {overview.asset === "ZYS" && (overview as any).yieldHalted ? (
        <ArbBadge text="Yield halted (RR < 200%)" color="#f7ad4c" subtle mono />
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <ArbStat label="DEX Rate" value={dexRateDisplay} />
        <ArbStat label="Native Rate" value={nativeRateDisplay} hint={status.referenceDescription} />
        <ArbStat label="Gap" value={formatBps(status.gapBps ?? Number.NaN)} />
        <ArbStat
          label="Δ vs Reference"
          value={
            <>
              {formatSignedRateWithUnit(referenceDifference, unitSymbol)}{" "}
              {referenceDifferenceUsd != null && Number.isFinite(referenceDifferenceUsd)
                ? `(${formatCurrency(referenceDifferenceUsd)})`
                : ""}
            </>
          }
        />
      </div>

      <ArbPlanSection
        plans={plans}
        plannerError={plannerError}
        statusColor={statusColor}
        inventorySnapshot={inventorySnapshot}
      />

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>Wrapped Pools</div>
        <AssetPoolsTable pools={associatedPools} />
      </div>

      {overview.opportunities.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>Recorded Opportunities</div>
          <div style={{ display: "grid", gap: 12 }}>
            {overview.opportunities.map((opportunity) => (
              <ArbOpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </div>
      ) : null}
    </ArbSection>
  );
}

function extractAssociatedPools(overview: ArbAsset): PoolOverview[] {
  const seen = new Map<string, PoolOverview>();
  for (const comparison of overview.comparisons) {
    if (comparison.pool) {
      seen.set(comparison.pool.id, comparison.pool);
    }
  }
  return Array.from(seen.values());
}

function renderDexStatValue(pricing: ArbAsset["pricing"]["dex"]): ReactNode {
  if (pricing.price == null) return "—";
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span>
        {formatNumber(pricing.price, 6)} {pricing.quote}
      </span>
      {pricing.priceUsd != null ? (
        <span style={{ fontSize: 12, opacity: 0.75 }}>≈ {formatCurrency(pricing.priceUsd)}</span>
      ) : null}
    </div>
  );
}

function renderNativeStatValue(pricing: ArbAsset["pricing"]["native"]): ReactNode {
  if (!pricing) return "—";
  const lines: ReactNode[] = [];
  if (pricing.spot != null) {
    lines.push(
      <span key="spot">
        Spot: {formatNumber(pricing.spot, 6)} {pricing.quote}
        {pricing.spotUsd != null ? ` (${formatCurrency(pricing.spotUsd)})` : ""}
      </span>,
    );
  }
  if (pricing.movingAverage != null) {
    lines.push(
      <span key="ma" style={{ opacity: 0.75 }}>
        MA: {formatNumber(pricing.movingAverage, 6)} {pricing.quote}
        {pricing.movingAverageUsd != null ? ` (${formatCurrency(pricing.movingAverageUsd)})` : ""}
      </span>,
    );
  }
  if (lines.length === 0) {
    return "—";
  }
  return <div style={{ display: "grid", gap: 2 }}>{lines}</div>;
}
