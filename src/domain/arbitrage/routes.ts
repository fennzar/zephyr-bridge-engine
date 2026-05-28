// src/domain/arbitrage/routes.ts
import type { MexcDepthSummary } from "@services/mexc/market";
import { getEvmBalanceForSymbol } from "@domain/inventory/balances";
import type { BalanceSnapshot } from "@domain/inventory/types";
import { formatNumber, formatCurrency } from "@shared/format";

import { THRESHOLDS_BPS, MAX_POOL_SHARE } from "./constants";
import type {
  CaseType,
  AssetOverview,
  PriceComparison,
  CaseRoute,
  RouteInventoryLeg,
  RouteInventoryPlan,
  RouteInventorySummary,
  RouteInventorySummaryRow,
} from "./types";
import { edgeStableRail, edgeZephCex, edgeZysBridge, pickClip } from "./edge";

export function estimateUsdPriceForAsset(
  asset: string,
  denomination: "usd" | "token",
  overview: AssetOverview,
  comparison: PriceComparison,
  fallbackToDex = false
): number | null {
  if (denomination === "usd") return 1;
  const upper = asset.toUpperCase();
  if (upper === "USDT" || upper === "WZSD" || upper === "ZSD") return 1;
  if (upper === "WZEPH" || upper === "ZEPH") {
    if (Number.isFinite(overview.status.referencePriceUsd ?? Number.NaN)) {
      return overview.status.referencePriceUsd as number;
    }
    if (fallbackToDex && Number.isFinite(comparison.dexPriceUsd ?? Number.NaN)) {
      return comparison.dexPriceUsd as number;
    }
    return null;
  }
  if (upper === "WZYS" || upper === "ZYS") {
    if (Number.isFinite(overview.status.referencePrice ?? Number.NaN)) {
      // referencePrice is ZYS per ZSD, with ZSD assumed ~$1
      return overview.status.referencePrice as number;
    }
    if (fallbackToDex && Number.isFinite(comparison.dexPrice ?? Number.NaN)) {
      return comparison.dexPrice as number;
    }
    return null;
  }
  return null;
}

export function buildInventorySummary(
  plan: RouteInventoryPlan,
  balances: BalanceSnapshot | null,
  overview: AssetOverview,
  comparison: PriceComparison,
  fallbackToDex: boolean
): RouteInventorySummary | undefined {
  if (!plan) return undefined;

  const rowsMap = new Map<
    string,
    {
      denomination: "usd" | "token";
      change: number;
    }
  >();

  const accumulate = (leg: RouteInventoryLeg, factor: 1 | -1) => {
    const key = leg.asset.toUpperCase();
    const existing = rowsMap.get(key);
    if (existing) {
      existing.change += factor * leg.amount;
    } else {
      rowsMap.set(key, { denomination: leg.denomination, change: factor * leg.amount });
    }
  };

  for (const leg of plan.inputs) {
    accumulate(leg, -1);
  }
  for (const leg of plan.outputs) {
    accumulate(leg, 1);
  }

  const rows: RouteInventorySummaryRow[] = [];
  let totalUsdChange: number | null = 0;

  rowsMap.forEach((value, assetKey) => {
    const before = getEvmBalanceForSymbol(balances, assetKey);
    const change = value.change;
    const after = before == null ? null : before + change;

    const price = estimateUsdPriceForAsset(assetKey, value.denomination, overview, comparison, fallbackToDex);
    const usdBefore = before == null || price == null ? null : before * price;
    const usdChange = price == null ? (value.denomination === "usd" ? change : null) : change * price;
    const usdAfter = usdBefore == null || usdChange == null ? null : usdBefore + usdChange;

    if (usdChange != null) {
      totalUsdChange = totalUsdChange == null ? usdChange : totalUsdChange + usdChange;
    }

    rows.push({
      asset: assetKey,
      denomination: value.denomination,
      before,
      change,
      after,
      usdBefore,
      usdChange,
      usdAfter,
    });
  });

  return {
    rows,
    totalUsdChange: rows.length === 0 ? null : totalUsdChange,
  };
}
