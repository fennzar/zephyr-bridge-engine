import { headers } from "next/headers";
import { ArbSection, ArbBadge, ArbStat } from "./components/ArbLayout";
import { AssetOverviewTable } from "./components/AssetOverviewTable";
import { InventorySummarySection } from "./components/InventorySummarySection";
import { AssetIndexNav } from "./components/AssetIndexNav";
import { AssetDetailSection } from "./components/AssetDetailSection";
import { SubNav } from "@/components/AppShell";

import {
  type ArbPlan,
  type ArbPlanStage,
  type ArbPlanStep,
} from "@domain/arbitrage";
import type { AssetStatus } from "@domain/arbitrage";
import { formatCurrency, formatNumber } from "@shared/format";
import type { InventoryRequirement, ArbPlanView, ArbPlanLegPrepView } from "@domain/arbitrage/types.plan";
import type { ClipOption, ClipSearchIteration, ClipExecutionVariant } from "@domain/arbitrage/clip.types";
import type { InventoryApiResponse } from "@domain/inventory/types.api";
import type { ArbitrageSnapshot, ArbAsset, ArbitragePlanReport, SerializedArbPlan } from "@services";
import type { ArbMarketAnalysis, MarketPricingBundle } from "@domain/arbitrage/analysis";
import type { AssetBase, AssetId } from "@domain/types";

export const runtime = "nodejs";

type ArbMarketAnalysisResponse = {
  generatedAt: string;
  assets: ArbMarketAnalysis[];
  pricing: Record<string, MarketPricingBundle>;
  error?: string;
};



/* ------------------------------
 * Balance & Pools (tightened copy)
 * ------------------------------ */

function convertAnalysisToStatus(analysis: ArbMarketAnalysis): AssetStatus {
  const mode: AssetStatus["mode"] =
    analysis.direction === "aligned" ? "aligned" : analysis.direction === "evm_premium" ? "premium" : "discount";
  return {
    mode,
    gapBps: analysis.gapBps ?? Number.NaN,
    referenceLabel: analysis.reference.label,
    referencePrice: analysis.reference.price ?? Number.NaN,
    referencePriceUsd: analysis.reference.priceUsd ?? Number.NaN,
    referenceDescription: analysis.reference.description ?? "",
    caseType: mode === "aligned" ? undefined : (mode as "premium" | "discount"),
  };
}






/* ------------------------------
 * Asset detail (side-by-side rates, routes)
 * ------------------------------ */

/* ------------------------------
 * Page (server component)
 * ------------------------------ */

export default async function ArbitragePage() {
  const headerList = await headers();
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) {
    throw new Error("Unable to resolve host for arbitrage snapshot request");
  }
  const origin = `${protocol}://${host}`;

  const response = await fetch(`${origin}/api/arbitrage/overview`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch arbitrage snapshot (${response.status})`);
  }

  const { generatedAt, pools, mexcMarket, reserveState, assets: snapshotAssets } =
    (await response.json()) as ArbitrageSnapshot;

  const [inventoryResult, analysisResult, plannerResult] = await Promise.all([
    fetchInventorySnapshot(origin),
    fetchMarketAnalysisBundle(origin),
    fetchPlannerPlans(origin),
  ]);

  const inventorySnapshot = inventoryResult.data;
  const marketAnalysis = analysisResult.assets;
  const pricingByAsset = analysisResult.pricing;
  const analysisError = analysisResult.error;
  const plannerPlans = plannerResult.plans;
  const plannerError = plannerResult.error;

  const analysisByAsset = new Map(marketAnalysis.map((entry) => [entry.asset, entry]));

  const assets: ArbAsset[] = snapshotAssets.map((asset) => {
    const analysis = analysisByAsset.get(asset.asset as ArbMarketAnalysis["asset"]);
    if (!analysis) {
      return {
        ...asset,
        pricing: pricingByAsset[asset.asset] ?? asset.pricing,
      };
    }

    const normalizedPricing = pricingByAsset[asset.asset] ?? toAssetPricing(analysis.pricing);

    return {
      ...asset,
      thresholdBps: analysis.triggerBps,
      status: convertAnalysisToStatus(analysis),
      pricing: normalizedPricing ?? asset.pricing,
    };
  });

  const plansByAsset = new Map<string, ArbPlan[]>();
  for (const plan of plannerPlans) {
    const list = plansByAsset.get(plan.asset) ?? [];
    list.push(plan);
    plansByAsset.set(plan.asset, list);
  }
  for (const list of plansByAsset.values()) {
    list.sort((a, b) => a.direction.localeCompare(b.direction));
  }

  // Top KPIs
  const rr = reserveState?.rrPercent ?? null;
  const rrColor =
    rr == null ? "#9AA0AA" : rr >= 800 ? "#16c784" : rr >= 400 ? "#61a0ff" : rr >= 200 ? "#f7ad4c" : "#f45b69";
  const mexcColor = mexcMarket ? "#16c784" : "#f7ad4c";
  const capturedDate = new Date(generatedAt);
  const capturedDisplay = Number.isNaN(capturedDate.getTime())
    ? "n/a"
    : capturedDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

  return (
    <main style={{ maxWidth: 980, margin: "48px auto", padding: 24, display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Arbitrage Monitor</h1>
        <div style={{ fontSize: 14, opacity: 0.75 }}>
          Keep EVM prices aligned with native and CEX references. Thin, repeatable edges; safe clips; clear inventory
          gates.
        </div>
        <SubNav
          links={[
            { href: "/arbitrage/leg-prep", label: "Leg Prep" },
            { href: "/clip-explorer", label: "Clip Explorer" },
            { href: "/quoters", label: "Quoters" },
            { href: "/pathing", label: "Pathing" },
          ]}
        />
      </header>

      {/* KPI strip */}
      <ArbSection title="Snapshot">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <ArbStat
            label="Reserve Ratio"
            value={<span style={{ color: rrColor }}>{rr == null ? "unknown" : `${formatNumber(rr, 2)}%`}</span>}
            hint={
              reserveState?.yieldHalted ? (
                <ArbBadge text="ZYS yield halted (RR < 200%)" color="#f7ad4c" subtle mono />
              ) : (
                "RR windows gate mint/redeem & ZYS behavior"
              )
            }
          />
          <ArbStat
            label="MEXC (ZEPH/USDT)"
            value={mexcMarket ? formatCurrency(mexcMarket.mid) : "offline"}
            hint={<ArbBadge text={mexcMarket ? "online" : "offline"} color={mexcColor} subtle />}
          />
          <ArbStat label="Pools tracked" value={pools.length} />
          <ArbStat
            label="Assumed fees"
            value="WZEPH 0.30% · WZSD 0.03% · WZYS 0.05% · CEX 0.10%"
            hint="Wrap/unwrap overhead ~0.05%"
          />
          <ArbStat label="Captured" value={capturedDisplay} />
        </div>
      </ArbSection>

      {/* Asset index chips */}
      <ArbSection title="Assets" subtitle="Jump to an asset below, or scan the table for gap vs trigger.">
        <AssetIndexNav assets={assets} />
        {analysisError ? (
          <div style={{ fontSize: 12, marginTop: 8, color: "#f45b69" }}>{analysisError}</div>
        ) : null}
      </ArbSection>

      <AssetOverviewTable assets={assets} />

      <InventorySummarySection inventory={inventorySnapshot} pricingByBase={buildAssetPricingMap(assets)} />

      {/* Asset details */}
      <section style={{ display: "grid", gap: 24 }}>
        {assets.map((asset) => (
          <AssetDetailSection
            key={asset.asset}
            overview={asset}
            plans={plansByAsset.get(asset.wrappedSymbol) ?? plansByAsset.get(asset.asset) ?? []}
            plannerError={plannerError}
            inventorySnapshot={inventorySnapshot}
          />
        ))}
      </section>
    </main>
  );
}

type InventoryFetchResult = { data: InventoryApiResponse | null; error: string | null };
type AnalysisFetchResult = {
  assets: ArbMarketAnalysis[];
  pricing: Record<string, ArbAsset["pricing"]>;
  error: string | null;
};
type PlannerFetchResult = { plans: ArbPlan[]; error: string | null };

async function fetchInventorySnapshot(origin: string): Promise<InventoryFetchResult> {
  try {
    const response = await fetch(`${origin}/api/inventory/balances`, { cache: "no-store" });
    if (!response.ok) {
      return {
        data: null,
        error: `Failed to fetch inventory balances (${response.status})`,
      };
    }
    const payload = (await response.json()) as InventoryApiResponse;
    return { data: payload, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to fetch inventory balances",
    };
  }
}

async function fetchMarketAnalysisBundle(origin: string): Promise<AnalysisFetchResult> {
  try {
    const response = await fetch(`${origin}/api/arbitrage/analysis`, { cache: "no-store" });
    if (!response.ok) {
      let message = `Failed to fetch arbitrage analysis (${response.status})`;
      try {
        const payload = (await response.json()) as Partial<ArbMarketAnalysisResponse>;
        if (payload?.error) {
          message = `${message}: ${payload.error}`;
        }
      } catch {
        // ignore secondary parse errors
      }
      return { assets: [], pricing: {}, error: message };
    }

    const payload = (await response.json()) as ArbMarketAnalysisResponse;
    const sanitizedAssets = (payload.assets ?? []).map((entry) => ({
      ...entry,
      pricing: sanitizeMarketPricingBundle(entry.pricing),
    }));
    const pricingMap = normalizePricingMap(payload.pricing ?? {});
    const error = payload.error ?? null;
    return { assets: sanitizedAssets, pricing: pricingMap, error };
  } catch (error) {
    return {
      assets: [],
      pricing: {},
      error: error instanceof Error ? error.message : "Failed to fetch arbitrage analysis",
    };
  }
}

async function fetchPlannerPlans(origin: string): Promise<PlannerFetchResult> {
  try {
    const response = await fetch(`${origin}/api/arbitrage/plans`, { cache: "no-store" });
    if (!response.ok) {
      let message = `Failed to fetch arbitrage plans (${response.status})`;
      try {
        const payload = (await response.json()) as Partial<ArbitragePlanReport>;
        if (payload?.error) {
          message = `${message}: ${payload.error}`;
        }
      } catch {
        // ignore JSON parsing issues
      }
      return { plans: [], error: message };
    }

    const payload = (await response.json()) as ArbitragePlanReport;
    const rawPlans = Array.isArray(payload.plans) ? (payload.plans as SerializedArbPlan[]) : [];
    const plans = rawPlans.map((plan) => rehydrateArbPlan(plan));
    const error = payload.error ?? null;
    return { plans, error };
  } catch (error) {
    return {
      plans: [],
      error: error instanceof Error ? error.message : "Failed to fetch arbitrage plans",
    };
  }
}

function normalizePricingMap(source: Record<string, unknown>): Record<string, ArbAsset["pricing"]> {
  const entries = Object.entries(source ?? {}).map(([key, value]) => {
    const sanitized = sanitizeMarketPricingBundle(value);
    return [key, toAssetPricing(sanitized)];
  });
  return Object.fromEntries(entries);
}

function sanitizeMarketPricingBundle(bundle: unknown): MarketPricingBundle {
  const value = isPlainObject(bundle) ? bundle : {};
  const dexRaw = isPlainObject(value.dex) ? value.dex : {};
  const nativeRaw = isPlainObject(value.native) ? value.native : null;
  const cexRaw = isPlainObject(value.cex) ? value.cex : null;

  const dex = {
    base: typeof dexRaw.base === "string" ? dexRaw.base : "",
    quote: typeof dexRaw.quote === "string" ? dexRaw.quote : "",
    price: toNullableNumber(dexRaw.price),
    priceUsd: toNullableNumber(dexRaw.priceUsd),
  };

  const native = nativeRaw
    ? {
        base: typeof nativeRaw.base === "string" ? nativeRaw.base : "",
        quote: typeof nativeRaw.quote === "string" ? nativeRaw.quote : "",
        spot: toNullableNumber(nativeRaw.spot),
        spotUsd: toNullableNumber(nativeRaw.spotUsd),
        movingAverage: toNullableNumber(nativeRaw.movingAverage),
        movingAverageUsd: toNullableNumber(nativeRaw.movingAverageUsd),
      }
    : null;

  const cex = cexRaw
    ? {
        base: typeof cexRaw.base === "string" ? cexRaw.base : "",
        quote: typeof cexRaw.quote === "string" ? cexRaw.quote : "",
        price: toNullableNumber(cexRaw.price),
        priceUsd: toNullableNumber(cexRaw.priceUsd),
      }
    : null;

  return {
    dex,
    native,
    cex,
  };
}

function buildAssetPricingMap(
  assets: ArbAsset[],
): Partial<Record<AssetBase, { dexUsd?: number | null; nativeUsd?: number | null; cexUsd?: number | null }>> {
  const map: Partial<Record<AssetBase, { dexUsd?: number | null; nativeUsd?: number | null; cexUsd?: number | null }>> =
    {};
  for (const asset of assets) {
    const base = asset.asset as AssetBase;
    map[base] = {
      dexUsd: asset.pricing.dex?.priceUsd ?? null,
      nativeUsd: asset.pricing.native?.spotUsd ?? asset.pricing.native?.movingAverageUsd ?? null,
      cexUsd: asset.pricing.cex?.priceUsd ?? null,
    };
  }
  if (!map.USDT) {
    map.USDT = { dexUsd: 1, nativeUsd: 1, cexUsd: 1 };
  }
  return map;
}

function toAssetPricing(bundle: MarketPricingBundle): ArbAsset["pricing"] {
  return {
    dex: bundle.dex,
    native: bundle.native
      ? {
          base: bundle.native.base,
          quote: bundle.native.quote,
          spot: bundle.native.spot,
          spotUsd: bundle.native.spotUsd,
          movingAverage: bundle.native.movingAverage,
          movingAverageUsd: bundle.native.movingAverageUsd,
        }
      : null,
    cex: bundle.cex
      ? {
          base: bundle.cex.base,
          quote: bundle.cex.quote,
          price: bundle.cex.price,
          priceUsd: bundle.cex.priceUsd,
        }
      : null,
  };
}

function rehydrateArbPlan(raw: SerializedArbPlan): ArbPlan {
  const value = raw as unknown as Record<string, unknown>;
  const stagesRaw = (value.stages as Record<string, unknown>) ?? {};

  const summary = rehydratePlanSummary(value.summary ?? {});

  const stages: Record<ArbPlanStage, ArbPlanStep[]> = {
    inventory: rehydratePlanSteps(stagesRaw.inventory),
    preparation: rehydratePlanSteps(stagesRaw.preparation),
    execution: rehydratePlanSteps(stagesRaw.execution),
    settlement: rehydratePlanSteps(stagesRaw.settlement),
    realisation: rehydratePlanSteps(stagesRaw.realisation),
  };

  return {
    asset: value.asset as ArbPlan["asset"],
    direction: value.direction as ArbPlan["direction"],
    stages,
    summary,
    view: rehydratePlanView(value.view),
  };
}

function rehydratePlanView(input: unknown): ArbPlanView | null {
  if (!isPlainObject(input)) return null;
  const clipOptionsRaw = Array.isArray((input as any).clipOptions) ? (input as any).clipOptions : [];
  const clipOptions = clipOptionsRaw
    .map((entry: unknown) => rehydratePlanViewClipOption(entry))
    .filter(
      (entry: ReturnType<typeof rehydratePlanViewClipOption>): entry is NonNullable<typeof entry> =>
        Boolean(entry),
    );
  return clipOptions.length > 0 ? { clipOptions } : null;
}

function rehydratePlanViewClipOption(input: unknown) {
  if (!isPlainObject(input)) return null;
  const optionRaw = (input as any).option ?? input;
  const option = rehydrateClipOption(optionRaw);
  if (!option) return null;
  const prep = isPlainObject((input as any).prep) ? ((input as any).prep as Record<string, unknown>) : {};
  return {
    option,
    prep: {
      open: rehydrateLegPrepView(prep.open),
      close: rehydrateLegPrepView(prep.close),
    },
  };
}

function rehydrateLegPrepView(input: unknown): ArbPlanLegPrepView | null {
  if (!isPlainObject(input)) return null;
  return {
    need: typeof (input as any).need === "string" ? ((input as any).need as AssetId) : null,
    amountIn: parseBigIntValue((input as any).amountIn) ?? null,
    candidate: isPlainObject((input as any).candidate) ? ((input as any).candidate as any) : null,
    evaluation: isPlainObject((input as any).evaluation) ? ((input as any).evaluation as any) : null,
    candidates: Array.isArray((input as any).candidates) ? ((input as any).candidates as any[]) : [],
  };
}

function rehydratePlanSummary(input: unknown): ArbPlan["summary"] {
  const summary = isPlainObject(input) ? input : {};
  const clipOptionRaw = summary.clipOption;
  const clipOptionsRaw = Array.isArray(summary.clipOptions) ? summary.clipOptions : null;

  const clipOption = clipOptionRaw ? rehydrateClipOption(clipOptionRaw) : null;
  const clipOptions = clipOptionsRaw ? clipOptionsRaw.map((option) => rehydrateClipOption(option)) : null;
  const clipAsset =
    typeof summary.clipAsset === "string" ? (summary.clipAsset as ClipOption["clip"]["asset"]) : undefined;

  return {
    estimatedProfitUsd: toNullableNumber(summary.estimatedProfitUsd),
    estimatedCostUsd: toNullableNumber(summary.estimatedCostUsd),
    inventoryLimited: typeof summary.inventoryLimited === "boolean" ? summary.inventoryLimited : undefined,
    notes: Array.isArray(summary.notes) ? summary.notes.map((note) => String(note)) : [],
    blocked: typeof summary.blocked === "boolean" ? summary.blocked : undefined,
    closeFlavor: summary.closeFlavor === "native" || summary.closeFlavor === "cex" ? summary.closeFlavor : null,
    clipAsset,
    clipAmount: parseBigIntValue(summary.clipAmount),
    clipAmountDecimal: toNullableNumber(summary.clipAmountDecimal),
    clipAmountUsd: toNullableNumber(summary.clipAmountUsd),
    clipOption,
    clipOptions: clipOptions && clipOptions.length > 0 ? clipOptions : null,
    clipScenarioError: typeof summary.clipScenarioError === "string" ? summary.clipScenarioError : null,
  };
}

function rehydratePlanSteps(input: unknown): ArbPlanStep[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => rehydratePlanStep(entry));
}

function rehydratePlanStep(input: unknown): ArbPlanStep {
  const step = isPlainObject(input) ? input : {};
  const inventoryDetailsRaw = Array.isArray(step.inventoryDetails) ? step.inventoryDetails : null;

  const assetId =
    typeof step.asset === "string" ? (step.asset as ArbPlanStep["asset"]) : undefined;

  return {
    id: typeof step.id === "string" ? step.id : "",
    stage: (step.stage as ArbPlanStage) ?? "inventory",
    label: typeof step.label === "string" ? step.label : "",
    description: typeof step.description === "string" ? step.description : undefined,
    asset: assetId,
    amountIn: parseBigIntValue(step.amountIn) ?? undefined,
    leg: step.leg as ArbPlanStep["leg"],
    preparation: step.preparation as ArbPlanStep["preparation"],
    path: step.path as ArbPlanStep["path"],
    notes: Array.isArray(step.notes) ? step.notes.map((note) => String(note)) : [],
    blocked: typeof step.blocked === "boolean" ? step.blocked : undefined,
    flavor: step.flavor === "native" || step.flavor === "cex" || step.flavor === "bridge" ? step.flavor : undefined,
    inventoryDetails: inventoryDetailsRaw ? inventoryDetailsRaw.map((entry) => rehydrateInventoryRequirement(entry)) : undefined,
    skip: typeof step.skip === "boolean" ? step.skip : undefined,
  };
}

function rehydrateInventoryRequirement(input: unknown): InventoryRequirement {
  const detail = isPlainObject(input) ? input : {};
  return {
    asset: coerceAssetId(detail.asset),
    required: toNullableNumber(detail.required) ?? 0,
    available: toNullableNumber(detail.available),
    remaining: toNullableNumber(detail.remaining),
    ok: Boolean(detail.ok),
    label: typeof detail.label === "string" ? detail.label : undefined,
  };
}

function rehydrateClipOption(input: unknown): ClipOption {
  const option = isPlainObject(input) ? input : {};
  const clip = isPlainObject(option.clip) ? option.clip : {};
  const open = isPlainObject(option.open) ? option.open : {};
  const close = isPlainObject(option.close) ? option.close : {};
  const summary = isPlainObject(option.summary) ? option.summary : {};

  const searchLogRaw = Array.isArray(open.searchLog) ? open.searchLog : [];
  const baseFlavor: ClipOption["flavor"] = option.flavor === "native" || option.flavor === "cex" ? option.flavor : "native";
  const summaryFlavor: ClipOption["flavor"] =
    summary.flavor === "native" || summary.flavor === "cex" ? summary.flavor : baseFlavor;

  return {
    flavor: baseFlavor,
    clip: {
      asset: coerceAssetId(clip.asset),
      amount: parseBigIntValue(clip.amount) ?? 0n,
      amountDecimal: toNullableNumber(clip.amountDecimal) ?? 0,
      amountUsd: toNullableNumber(clip.amountUsd),
      pool: (clip.pool ?? null) as ClipOption["clip"]["pool"],
    },
    open: {
      candidate: (open.candidate ?? null) as ClipOption["open"]["candidate"],
      execution: open.execution ? rehydrateClipExecutionVariant(open.execution) : null,
      searchLog: searchLogRaw.map((entry) => rehydrateClipSearchIteration(entry)),
    },
    close: {
      candidate: (close.candidate ?? null) as ClipOption["close"]["candidate"],
      execution: close.execution ? rehydrateClipExecutionVariant(close.execution) : null,
    },
    summary: {
      flavor: summaryFlavor,
      openLeg: summary.openLeg ? rehydrateClipExecutionVariant(summary.openLeg) : null,
      closeLeg: summary.closeLeg ? rehydrateClipExecutionVariant(summary.closeLeg) : null,
      netUsdChange: toNullableNumber(summary.netUsdChange),
      totalCostUsd: toNullableNumber(summary.totalCostUsd),
      notes: Array.isArray(summary.notes) ? summary.notes.map((note) => String(note)) : [],
    },
    initialPrice: toNullableNumber(option.initialPrice),
    referencePrice: toNullableNumber(option.referencePrice),
    targetPrice: toNullableNumber(option.targetPrice),
  };
}

function rehydrateClipExecutionVariant(input: unknown): ClipExecutionVariant {
  const execution = isPlainObject(input) ? input : {};
  return {
    flavor: execution.flavor === "native" || execution.flavor === "cex" || execution.flavor === "open" ? execution.flavor : "open",
    evaluation: (execution.evaluation as ClipExecutionVariant["evaluation"]) ?? null,
    amountInDecimal: toNullableNumber(execution.amountInDecimal),
    amountOutDecimal: toNullableNumber(execution.amountOutDecimal),
    poolPriceBefore: toNullableNumber(execution.poolPriceBefore),
    poolPriceAfter: toNullableNumber(execution.poolPriceAfter),
    onchainAmountOutDecimal: toNullableNumber(execution.onchainAmountOutDecimal),
    onchainPoolPriceAfter: toNullableNumber(execution.onchainPoolPriceAfter),
    onchainWarnings: Array.isArray(execution.onchainWarnings) ? execution.onchainWarnings.map((note) => String(note)) : undefined,
    fromAsset: coerceAssetId(execution.fromAsset) as ClipExecutionVariant["fromAsset"],
    toAsset: coerceAssetId(execution.toAsset) as ClipExecutionVariant["toAsset"],
    baseSymbol: typeof execution.baseSymbol === "string" ? execution.baseSymbol : undefined,
    quoteSymbol: typeof execution.quoteSymbol === "string" ? execution.quoteSymbol : undefined,
    poolBaseBefore: toNullableNumber(execution.poolBaseBefore),
    poolQuoteBefore: toNullableNumber(execution.poolQuoteBefore),
    poolBaseAfter: toNullableNumber(execution.poolBaseAfter),
    poolQuoteAfter: toNullableNumber(execution.poolQuoteAfter),
    onchainPoolBaseAfter: toNullableNumber(execution.onchainPoolBaseAfter),
    onchainPoolQuoteAfter: toNullableNumber(execution.onchainPoolQuoteAfter),
    onchainSqrtPriceAfter: parseBigIntValue(execution.onchainSqrtPriceAfter),
    onchainBaseDelta: toNullableNumber(execution.onchainBaseDelta),
    onchainQuoteDelta: toNullableNumber(execution.onchainQuoteDelta),
    referencePriceBefore: toNullableNumber(execution.referencePriceBefore),
    predictedPriceAfter: toNullableNumber(execution.predictedPriceAfter),
    onchainPriceAfter: toNullableNumber(execution.onchainPriceAfter),
    priceDiffBps: toNullableNumber(execution.priceDiffBps),
    referenceLabel: typeof execution.referenceLabel === "string" ? execution.referenceLabel : undefined,
    effectivePrice: toNullableNumber(execution.effectivePrice),
    nativeRateMode: execution.nativeRateMode === "mint" || execution.nativeRateMode === "redeem" ? execution.nativeRateMode : undefined,
    nativeRateBasis:
      execution.nativeRateBasis === "spot" ||
      execution.nativeRateBasis === "moving_average" ||
      execution.nativeRateBasis === "spot_equals_ma"
        ? execution.nativeRateBasis
        : undefined,
    nativeRateBasisLabel: typeof execution.nativeRateBasisLabel === "string" ? execution.nativeRateBasisLabel : undefined,
    nativeRateSpot: toNullableNumber(execution.nativeRateSpot),
    nativeRateMovingAverage: toNullableNumber(execution.nativeRateMovingAverage),
    nativeRateMintPrice: toNullableNumber(execution.nativeRateMintPrice),
    nativeRateRedeemPrice: toNullableNumber(execution.nativeRateRedeemPrice),
    nativeRateStableAsset: typeof execution.nativeRateStableAsset === "string" ? execution.nativeRateStableAsset : null,
    nativeRateReferenceAsset: typeof execution.nativeRateReferenceAsset === "string" ? execution.nativeRateReferenceAsset : null,
    nativeRatePairBase: typeof execution.nativeRatePairBase === "string" ? execution.nativeRatePairBase : null,
    nativeRatePairQuote: typeof execution.nativeRatePairQuote === "string" ? execution.nativeRatePairQuote : null,
    nativeReferenceUsdBase: typeof execution.nativeReferenceUsdBase === "string" ? execution.nativeReferenceUsdBase : null,
    nativeReferenceUsdQuote: typeof execution.nativeReferenceUsdQuote === "string" ? execution.nativeReferenceUsdQuote : null,
    nativeReferenceSpotUsd: toNullableNumber(execution.nativeReferenceSpotUsd),
    nativeReferenceMovingAverageUsd: toNullableNumber(execution.nativeReferenceMovingAverageUsd),
  };
}

function rehydrateClipSearchIteration(input: unknown): ClipSearchIteration {
  const entry = isPlainObject(input) ? input : {};
  return {
    iteration: toInteger(entry.iteration) ?? 0,
    amountDecimal: toNullableNumber(entry.amountDecimal) ?? 0,
    openAmountOutDecimal: toNullableNumber(entry.openAmountOutDecimal),
    closeAmountOutDecimal: toNullableNumber(entry.closeAmountOutDecimal),
    poolPriceAfter: toNullableNumber(entry.poolPriceAfter),
    validatedPriceAfter: toNullableNumber(entry.validatedPriceAfter),
    counterPriceAfter: toNullableNumber(entry.counterPriceAfter),
    targetPrice: toNullableNumber(entry.targetPrice),
    targetDiffBps: toNullableNumber(entry.targetDiffBps),
    priceDiffBps: toNullableNumber(entry.priceDiffBps),
    priceGap: toNullableNumber(entry.priceGap),
  };
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceAssetId(value: unknown): AssetId {
  return (typeof value === "string" ? value : "") as AssetId;
}

function parseBigIntValue(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
