import type { ReactNode } from "react";

import { AssetBadge } from "@/components/AssetBadge";
import { formatCurrency, formatNumber } from "@shared/format";
import type { InventoryApiResponse } from "@domain/inventory/types.api";
import {
  getAssetMetadata,
  getAssetMetadataByBase,
  type AssetBase,
  type AssetId,
  type Venue,
} from "@domain/core/assets";

import { ArbBadge, ArbSection } from "./ArbLayout";

const VENUE_SEQUENCE: Venue[] = ["evm", "native", "cex"];
const VENUE_LABELS: Record<Venue, string> = {
  evm: "EVM",
  native: "Zephyr",
  cex: "CEX",
};

const DISCREPANCY_ALERT_THRESHOLD = 0.01; // 1%

type VenueBucket = {
  total: number;
  variants: Array<{ assetId: string; amount: number; source: string }>;
};

type InventoryRow = {
  assetBase: AssetBase;
  total: number;
  variantSum: number;
  discrepancyPct: number;
  buckets: Map<Venue, VenueBucket>;
  availableVenues: Set<Venue>;
  extras: Array<{ assetId: string; amount: number; source: string }>;
};

type AssetPricing = {
  dexUsd?: number | null;
  nativeUsd?: number | null;
  cexUsd?: number | null;
};

type VenueTotals = {
  evm: { dex: number; native: number };
  native: number;
  cex: number;
  total: number;
};

const ZERO_TOTALS: VenueTotals = {
  evm: { dex: 0, native: 0 },
  native: 0,
  cex: 0,
  total: 0,
};

export function InventorySummarySection({
  inventory,
  pricingByBase,
}: {
  inventory: InventoryApiResponse | null;
  pricingByBase: Partial<Record<AssetBase, AssetPricing>>;
}) {
  if (!inventory) {
    return (
      <ArbSection title="Inventory Snapshot" subtitle="Inventory API unavailable.">
        <div style={{ fontSize: 12, opacity: 0.75 }}>Unable to load inventory balances.</div>
      </ArbSection>
    );
  }

  const rows = inventory.assets.map(buildInventoryRow);
  const venueTotals = calculateVenueTotals(rows, pricingByBase);

  const generatedAtDate = new Date(inventory.generatedAt);
  const generatedLabel = Number.isNaN(generatedAtDate.getTime())
    ? "unknown"
    : generatedAtDate.toLocaleString();

  return (
    <ArbSection title="Inventory Snapshot" subtitle="Aggregated balances across sources.">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ArbBadge
          text={inventory.sources.evm ? "EVM enabled" : "EVM disabled"}
          color={inventory.sources.evm ? "#16c784" : "#f45b69"}
          subtle
        />
        <ArbBadge
          text={inventory.sources.paper.mexc ? "MEXC paper on" : "MEXC paper off"}
          color={inventory.sources.paper.mexc ? "#16c784" : "#f7ad4c"}
          subtle
        />
        <ArbBadge
          text={inventory.sources.paper.zephyr ? "Zephyr paper on" : "Zephyr paper off"}
          color={inventory.sources.paper.zephyr ? "#16c784" : "#f7ad4c"}
          subtle
        />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 780,
            borderCollapse: "separate",
            borderSpacing: 0,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            background: "#101720",
          }}
        >
          <thead>
            <tr style={{ textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11, opacity: 0.65 }}>
              <th style={{ padding: "12px", textAlign: "left" }}>Asset / Total</th>
              {VENUE_SEQUENCE.map((venue) => (
                <th key={venue} style={{ padding: "12px", textAlign: "left" }}>
                  {VENUE_LABELS[venue]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={1 + VENUE_SEQUENCE.length} style={{ padding: 16, fontSize: 12, opacity: 0.7 }}>
                  No balances recorded.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.assetBase}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    opacity: row.assetBase === "ETH" ? 0.6 : 1,
                  }}
                >
                  <td style={{ padding: "12px", verticalAlign: "top" }}>
                    <AssetBadge
                      asset={row.assetBase}
                      labelMode="base"
                      amount={row.total}
                      amountDigits={2}
                      compactAmount
                    />
                    {row.discrepancyPct > DISCREPANCY_ALERT_THRESHOLD ? (
                      <div style={{ marginTop: 8 }}>
                        <ArbBadge
                          text={`Variance ${formatNumber(row.discrepancyPct * 100, 2)}%`}
                          color="#f7ad4c"
                          subtle
                          mono
                        />
                      </div>
                    ) : null}
                    {row.extras.length > 0 ? (
                      <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                        <span style={{ fontSize: 11, opacity: 0.65 }}>Extras</span>
                        <div style={{ display: "grid", gap: 6 }}>
                          {row.extras.map((entry) => (
                            <AssetBadge
                              key={`${entry.assetId}-${entry.source}`}
                              asset={entry.assetId}
                              labelMode="full"
                              amount={entry.amount}
                              amountDigits={2}
                              compactAmount
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </td>
                  {VENUE_SEQUENCE.map((venue) => (
                    <td key={venue} style={{ padding: "12px", verticalAlign: "top" }}>
                      {renderVenueCell(row, venue)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "12px", fontWeight: 600 }}>USD Value</td>
              <td style={{ padding: "12px" }}>
                <VenueTotalDisplay
                  primaryLabel="DEX"
                  primaryValue={venueTotals.evm.dex}
                  secondaryLabel="Native"
                  secondaryValue={venueTotals.evm.native}
                />
              </td>
              <td style={{ padding: "12px" }}>
                <VenueTotalDisplay primaryLabel="Native" primaryValue={venueTotals.native} />
              </td>
              <td style={{ padding: "12px" }}>
                <VenueTotalDisplay primaryLabel="Spot" primaryValue={venueTotals.cex} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ fontSize: 11, opacity: 0.6 }}>Snapshot generated {generatedLabel}</div>
    </ArbSection>
  );
}

function buildInventoryRow(asset: InventoryApiResponse["assets"][number]): InventoryRow {
  const metadata = getAssetMetadataByBase(asset.key as AssetBase);
  const buckets = new Map<Venue, VenueBucket>();
  const availableVenues = new Set<Venue>();

  for (const meta of metadata) {
    availableVenues.add(meta.venue);
    if (!buckets.has(meta.venue)) {
      buckets.set(meta.venue, { total: 0, variants: [] });
    }
  }

  let variantSum = 0;
  const extras: InventoryRow["extras"] = [];

  for (const variant of asset.variants) {
    const amount = Number.isFinite(variant.amount) ? variant.amount : 0;
    variantSum += amount;
    try {
      const meta = getAssetMetadata(variant.assetId as AssetId);
      availableVenues.add(meta.venue);
      const bucket = buckets.get(meta.venue) ?? { total: 0, variants: [] };
      bucket.total += amount;
      bucket.variants.push({ assetId: variant.assetId, amount, source: variant.source });
      buckets.set(meta.venue, bucket);
    } catch {
      extras.push({ assetId: variant.assetId, amount, source: variant.source });
    }
  }

  const total = Number.isFinite(asset.total) ? (asset.total as number) : variantSum;
  const diff = Math.abs(total - variantSum);
  const denom = Math.max(Math.abs(total), Math.abs(variantSum), 1);
  const discrepancyPct = denom === 0 ? 0 : diff / denom;

  return {
    assetBase: asset.key as AssetBase,
    total,
    variantSum,
    discrepancyPct,
    buckets,
    availableVenues,
    extras,
  };
}

function renderVenueCell(row: InventoryRow, venue: Venue): ReactNode {
  const bucket = row.buckets.get(venue);
  if (!bucket || bucket.variants.length === 0) {
    if (!row.availableVenues.has(venue)) {
      return <span style={{ opacity: 0.2 }}>—</span>;
    }
    return <span style={{ opacity: 0.6 }}>—</span>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {bucket.variants.map((variant) => (
        <AssetBadge
          key={`${variant.assetId}-${variant.source}`}
          asset={variant.assetId}
          showLabel
          amount={variant.amount}
          amountDigits={2}
          compactAmount
        />
      ))}
    </div>
  );
}

type VenueTotalDisplayProps = {
  primaryLabel: string;
  primaryValue: number;
  secondaryLabel?: string;
  secondaryValue?: number;
};

function VenueTotalDisplay({ primaryLabel, primaryValue, secondaryLabel, secondaryValue }: VenueTotalDisplayProps) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span>
        {primaryLabel}: {formatCurrency(primaryValue || 0)}
      </span>
      {secondaryLabel ? (
        <span style={{ opacity: 0.75 }}>
          {secondaryLabel}: {formatCurrency(secondaryValue || 0)}
        </span>
      ) : null}
    </div>
  );
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
  return formatNumber(value, abs >= 1 ? 2 : 6);
}

function calculateVenueTotals(
  rows: InventoryRow[],
  pricingByBase: Partial<Record<AssetBase, AssetPricing>>,
): VenueTotals {
  const totals: VenueTotals = JSON.parse(JSON.stringify(ZERO_TOTALS));

  for (const row of rows) {
    const pricing = pricingByBase[row.assetBase];
    const priceDex = pricing?.dexUsd ?? null;
    const priceNative = pricing?.nativeUsd ?? null;
    const priceCex = pricing?.cexUsd ?? null;

    totals.total += (priceDex ?? priceNative ?? priceCex ?? 0) * row.total;

    for (const [venue, bucket] of row.buckets.entries()) {
      if (!bucket) continue;
      const value = bucket.total;
      if (venue === "evm") {
        if (priceDex != null) totals.evm.dex += value * priceDex;
        if (priceNative != null) totals.evm.native += value * priceNative;
      } else if (venue === "native") {
        if (priceNative != null) totals.native += value * priceNative;
        else if (priceDex != null) totals.native += value * priceDex;
      } else if (venue === "cex") {
        if (priceCex != null) totals.cex += value * priceCex;
        else if (priceDex != null) totals.cex += value * priceDex;
      }
    }
  }

  return totals;
}
