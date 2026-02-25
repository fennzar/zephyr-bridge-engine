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

// Bridge-only route (pure bridge or EVM tidy-up), per-asset
export function buildBridgeRoute(
  caseType: CaseType,
  overview: AssetOverview,
  comparison: PriceComparison,
  balances: BalanceSnapshot | null
): CaseRoute {
  const gasUsd = 20; // keep simple & conservative
  const pool = comparison.pool;
  const poolUsd = pool?.tvlUsd ? pool.tvlUsd / 2 : 0; // half TVL as rough depth
  const unit = comparison.unitSymbol;

  // When balances are unknown, keep routes "available" but warn in the note.
  const unknownInventory = !balances;

  if (overview.asset === "ZSD") {
    // Stable rail tidy-up on USDT/WZSD
    const clipUsd = pickClip(poolUsd, /* maxInvUsd */ null);
    const e = edgeStableRail(comparison.dexPrice, gasUsd, Math.max(clipUsd, 1000));
    const meets = Math.abs(e) >= THRESHOLDS_BPS.STABLE;
    return {
      label: "Stable rail tidy-up (USDT↔WZSD)",
      available: meets || unknownInventory,
      note: meets ? undefined : "Below trigger",
      availabilityNote: unknownInventory ? "Inventory snapshot unavailable — showing theoretical route." : undefined,
      edgeBps: e,
      unitEdge: `${formatCurrency((e / 10_000) * 1_000)} per $1,000`,
      recommendedSize: clipUsd ? formatCurrency(clipUsd) : undefined,
      estimatedProfit: clipUsd ? formatCurrency((e / 10_000) * clipUsd) : undefined,
      clipSummary: `Clip limited to ~${Math.round(MAX_POOL_SHARE * 100)}% of pool depth.`,
      footnotes: ["Fees: 0.03% stable + gas."],
      stepDetails: [
        {
          title: "Swap on EVM",
          lines: [
            `Execute ${caseType === "premium" ? "sell WZSD → USDT" : "buy WZSD ← USDT"} at current mid.`,
            "Small clips, repeat as needed; target is ~1.0000.",
          ],
        },
      ],
    };
  }

  if (overview.asset === "ZYS") {
    // Pure bridge vs native ZYS:ZSD
    const clipUsd = pickClip(poolUsd, /* maxInvUsd */ null);
    const unitPrice = Number(comparison.dexPrice ?? Number.NaN);
    const clipTokens = Number.isFinite(unitPrice) && unitPrice > 0 ? clipUsd / unitPrice : 0;
    const rawEdge = edgeZysBridge(
      comparison.dexPrice,
      overview.status.referencePrice,
      Math.max(gasUsd, 20),
      Math.max(clipUsd, 2000)
    );
    const edgeSign = caseType === "discount" ? -1 : 1;
    const e = rawEdge * edgeSign;
    const meets = Math.abs(e) >= THRESHOLDS_BPS.ZYS;
    const yieldNote = overview.yieldHalted
      ? "ZYS yield halted (RR < 200%): do not assume upward drift; trade only actual mispricing."
      : undefined;

    const availableWZSD = getEvmBalanceForSymbol(balances, "WZSD");
    const availableUSDT = getEvmBalanceForSymbol(balances, "USDT");
    const availableWZYS = getEvmBalanceForSymbol(balances, "WZYS");
    const wzsdShortfall = availableWZSD == null ? 0 : Math.max(clipUsd - availableWZSD, 0);
    const usdtShortfall = availableUSDT == null ? wzsdShortfall : Math.max(wzsdShortfall - availableUSDT, 0);
    const wzysShortfall = availableWZYS == null ? 0 : Math.max(clipTokens - availableWZYS, 0);

    return {
      label: "Pure bridge (wZYS ⇄ native ZYS)",
      available: meets || unknownInventory,
      note: meets ? undefined : "Below trigger",
      availabilityNote: unknownInventory ? "Inventory snapshot unavailable — showing theoretical route." : yieldNote,
      edgeBps: e,
      unitEdge: `${formatCurrency((e / 10_000) * 1_000)} per $1,000`,
      recommendedSize: clipUsd ? formatCurrency(clipUsd) : undefined,
      estimatedProfit: clipUsd ? formatCurrency((e / 10_000) * clipUsd) : undefined,
      clipSummary: `Execute on WZYS/WZSD, then unwrap/convert/wrap on native.`,
      footnotes: ["Fees: 0.05% WZYS/WZSD + ~0.05% wrap/unwrap + gas."],
      stepDetails: [
        {
          title: caseType === "premium" ? "Sell wZYS on EVM" : "Buy wZYS on EVM",
          lines: [
            `${caseType === "premium" ? "Swap wZYS→WZSD" : "Swap WZSD→wZYS"} at current EVM price (${formatNumber(
              comparison.dexPrice,
              6
            )} ${unit}).`,
          ],
        },
        {
          title: "Bridge legs",
          lines: [
            "Unwrap to native.",
            `Native convert at oracle (${formatNumber(overview.status.referencePrice, 6)} ZYS per ZSD).`,
            "Re-wrap to restore inventory on the side that's short.",
          ],
        },
      ],
      inventory: (() => {
        const plan: RouteInventoryPlan =
          caseType === "discount"
            ? {
                inputs: [
                  {
                    asset: "WZSD",
                    amount: clipUsd,
                    denomination: "usd" as const,
                    available: availableWZSD,
                    shortfall: availableWZSD == null ? 0 : wzsdShortfall,
                  },
                  ...(clipUsd <= 0 || wzsdShortfall <= 0
                    ? []
                    : [
                        {
                          asset: "USDT",
                          amount: wzsdShortfall,
                          denomination: "usd" as const,
                          available: availableUSDT,
                          shortfall: usdtShortfall,
                          note: "Swap to WZSD to cover shortfall",
                        },
                      ]),
                ],
                outputs: [
                  {
                    asset: "WZYS",
                    amount: clipTokens,
                    denomination: "token" as const,
                    available: availableWZYS,
                    shortfall: 0,
                  },
                ],
              }
            : {
                inputs: [
                  {
                    asset: "WZYS",
                    amount: clipTokens,
                    denomination: "token" as const,
                    available: availableWZYS,
                    shortfall: availableWZYS == null ? 0 : wzysShortfall,
                  },
                ],
                outputs: [
                  {
                    asset: "WZSD",
                    amount: clipUsd,
                    denomination: "usd" as const,
                    available: availableWZSD,
                    shortfall: 0,
                    note: "Redeem a portion to USDT as needed",
                  },
                ],
              };
        plan.summary = buildInventorySummary(plan, balances, overview, comparison, false);
        return plan;
      })(),
    };
  }

  if (overview.asset === "ZEPH") {
    const pool = comparison.pool;
    const poolUsd = pool?.tvlUsd ? pool.tvlUsd / 2 : 0;
    const clipUsd = pickClip(poolUsd, /* maxInvUsd */ null);
    const dexUsd = Number(comparison.dexPriceUsd ?? Number.NaN);
    const refUsd = Number(overview.status.referencePriceUsd ?? Number.NaN);
    const unknownInventory = !balances;

    if (!Number.isFinite(dexUsd) || !Number.isFinite(refUsd)) {
      return {
        label: "LP accumulation (wZEPH)",
        available: false,
        note: "Insufficient pricing data.",
        stepDetails: [],
        footnotes: ["Reference comes from CEX for ZEPH/USDT."],
      };
    }

    const spreadUsd = refUsd - dexUsd;
    const spreadBps = refUsd !== 0 ? Math.round((spreadUsd / refUsd) * 10_000) : 0;
    const edgeBps = caseType === "premium" ? -spreadBps : spreadBps;
    const clipTokens = dexUsd > 0 ? clipUsd / dexUsd : 0;
    const unitEdgeUsd = caseType === "premium" ? dexUsd - refUsd : spreadUsd;
    const estProfitUsd = clipTokens * unitEdgeUsd;

    const availableWZSD = getEvmBalanceForSymbol(balances, "WZSD");
    const availableUSDT = getEvmBalanceForSymbol(balances, "USDT");
    const availableWZEPH = getEvmBalanceForSymbol(balances, "WZEPH");
    const wzsdShortfall = availableWZSD == null ? 0 : Math.max(clipUsd - availableWZSD, 0);
    const usdtShortfall = availableUSDT == null ? wzsdShortfall : Math.max(wzsdShortfall - availableUSDT, 0);
    const wzephShortfall = availableWZEPH == null ? 0 : Math.max(clipTokens - availableWZEPH, 0);

    const commonFootnotes =
      caseType === "discount"
        ? [
            "Partial loop — accumulate wZEPH on EVM; unwind via CEX once rails are open.",
            "Fees: 0.30% WZEPH/WZSD + 0.03% WZSD/USDT.",
          ]
        : [
            "Leaves proceeds on EVM as WZSD/USDT; bridge or redeploy when needed.",
            "Fees: 0.30% WZEPH/WZSD + 0.03% WZSD/USDT.",
          ];

    if (caseType === "discount") {
      return {
        label: "LP accumulation (wZEPH)",
        available: clipUsd > 0 || unknownInventory,
        edgeBps,
        unitEdge: formatCurrency(unitEdgeUsd),
        recommendedSize: clipUsd ? formatCurrency(clipUsd) : undefined,
        estimatedProfit: clipUsd ? formatCurrency(estProfitUsd) : undefined,
        clipSummary: clipUsd ? `Clip limited to ~${Math.round(MAX_POOL_SHARE * 100)}% of pool depth.` : undefined,
        availabilityNote: unknownInventory ? "Inventory snapshot unavailable — showing theoretical route." : undefined,
        footnotes: commonFootnotes,
        stepDetails: [
          {
            title: "Acquire wZEPH on EVM",
            lines: [
              `Swap USDT→WZSD→wZEPH at ${formatCurrency(dexUsd)} per ZEPH (current pool mid).`,
              "Work the order in clips to respect pool depth and gas budget.",
            ],
          },
          {
            title: "Hold & stage",
            lines: [
              "Increase wrapped/native ZEPH inventory on EVM.",
              "Plan for later CEX unwind once withdrawal rails are live.",
            ],
          },
        ],
        inventory: (() => {
          const plan: RouteInventoryPlan = {
            inputs: [
              {
                asset: "WZSD",
                amount: clipUsd,
                denomination: "usd" as const,
                available: availableWZSD,
                shortfall: availableWZSD == null ? 0 : wzsdShortfall,
              },
              ...(clipUsd <= 0 || wzsdShortfall <= 0
                ? []
                : [
                    {
                      asset: "USDT",
                      amount: wzsdShortfall,
                      denomination: "usd" as const,
                      available: availableUSDT,
                      shortfall: usdtShortfall,
                      note: "Swap to WZSD to cover shortfall",
                    },
                  ]),
            ],
            outputs: [
              {
                asset: "WZEPH",
                amount: clipTokens,
                denomination: "token" as const,
                available: availableWZEPH,
                shortfall: 0,
              },
            ],
          };
          plan.summary = buildInventorySummary(plan, balances, overview, comparison, false);
          return plan;
        })(),
      };
    }

    return {
      label: "LP unwind (wZEPH → stable)",
      available: clipUsd > 0 || unknownInventory,
      edgeBps,
      unitEdge: formatCurrency(unitEdgeUsd),
      recommendedSize: clipUsd ? formatCurrency(clipUsd) : undefined,
      estimatedProfit: clipUsd ? formatCurrency(estProfitUsd) : undefined,
      clipSummary: clipUsd ? `Clip limited to ~${Math.round(MAX_POOL_SHARE * 100)}% of pool depth.` : undefined,
      availabilityNote: unknownInventory ? "Inventory snapshot unavailable — showing theoretical route." : undefined,
      footnotes: commonFootnotes,
      stepDetails: [
        {
          title: "Swap out of wZEPH",
          lines: ["Sell wZEPH→WZSD at current pool price.", "Optionally convert WZSD→USDT to raise stables on EVM."],
        },
        {
          title: "Rebalance inventory",
          lines: [
            "Bridge or re-wrap when native flows resume.",
            "Keep clips within pool depth to avoid excess slippage.",
          ],
        },
      ],
      inventory: (() => {
        const plan: RouteInventoryPlan = {
          inputs: [
            {
              asset: "WZEPH",
              amount: clipTokens,
              denomination: "token" as const,
              available: availableWZEPH,
              shortfall: availableWZEPH == null ? 0 : wzephShortfall,
            },
          ],
          outputs: [
            {
              asset: "WZSD",
              amount: clipUsd,
              denomination: "usd" as const,
              available: availableWZSD,
              shortfall: 0,
              note: "Convert to USDT if desired",
            },
          ],
        };
        plan.summary = buildInventorySummary(plan, balances, overview, comparison, true);
        return plan;
      })(),
    };
  }

  // ZRS: show info-only bridge card (RR windows matter, execution logic omitted here)
  if (overview.asset === "ZRS") {
    return {
      label: "Pure bridge (wZRS ⇄ native ZRS)",
      available: false,
      note: "RR-window aware mint/redeem required; enable after inventory wiring.",
      stepDetails: [],
      footnotes: ["ZRS mint disabled RR > 800%; redeem disabled RR < 400%."],
    };
  }

  return {
    label: "Bridge",
    available: false,
    stepDetails: [],
  };
}

// CEX route (only makes sense for ZEPH today)
export function buildCexRoute(
  caseType: CaseType,
  overview: AssetOverview,
  comparison: PriceComparison,
  mexcMarket: MexcDepthSummary | null,
  balances: BalanceSnapshot | null
): CaseRoute | null {
  if (overview.asset !== "ZEPH") return null;

  const pool = comparison.pool;
  const poolUsd = pool?.tvlUsd ? pool.tvlUsd / 2 : 0;
  const gasUsd = 25;

  if (!mexcMarket || !Number.isFinite(mexcMarket.mid) || !Number.isFinite(comparison.dexPriceUsd)) {
    return {
      label: "CEX path (MEXC ↔ EVM)",
      available: false,
      note: "MEXC offline or insufficient quotes.",
      stepDetails: [],
      footnotes: ["Needs CEX ZEPH/USDT mid for reference."],
    };
  }

  const rawEdge = edgeZephCex(comparison.dexPriceUsd, mexcMarket.mid, gasUsd, 3000);
  const edgeSign = caseType === "discount" ? -1 : 1;
  const e = rawEdge * edgeSign;
  const meets = Math.abs(e) >= THRESHOLDS_BPS.ZEPH;
  const clipUsd = pickClip(poolUsd, /* inv */ null);
  const unknownInventory = !balances;

  const direction =
    caseType === "premium"
      ? "EVM rich vs CEX — sell wZEPH on EVM, source on CEX"
      : "EVM cheap vs CEX — buy wZEPH on EVM, sell on CEX";

  const stepsPremium = [
    "Buy ZEPH on MEXC (taker).",
    "Withdraw to native wallet; wrap to wZEPH.",
    "Swap wZEPH→WZSD on EVM; WZSD→USDT if realizing P&L.",
  ];
  const stepsDiscount = [
    "Swap USDT→WZSD→wZEPH on EVM.",
    "Unwrap to ZEPH; deposit to MEXC.",
    "Sell ZEPH on MEXC (taker).",
  ];

  return {
    label: "CEX path (MEXC ↔ EVM)",
    available: meets || unknownInventory,
    note: meets ? undefined : "Below trigger",
    availabilityNote: unknownInventory ? "Inventory snapshot unavailable — showing theoretical route." : undefined,
    edgeBps: e,
    unitEdge: `${formatCurrency((e / 10_000) * 1_000)} per $1,000`,
    recommendedSize: clipUsd ? formatCurrency(clipUsd) : undefined,
    estimatedProfit: clipUsd ? formatCurrency((e / 10_000) * clipUsd) : undefined,
    clipSummary: `Clip limited to ~${Math.round(MAX_POOL_SHARE * 100)}% of pool depth.`,
    footnotes: ["Fees: 0.30% WZEPH/WZSD + 0.03% WZSD/USDT + 0.10% CEX + gas."],
    stepDetails: [
      {
        title: direction,
        lines: caseType === "premium" ? stepsPremium : stepsDiscount,
      },
    ],
  };
}
