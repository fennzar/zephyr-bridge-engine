import { ClipExplorer } from "../quoters/ClipExplorer";
import { buildGlobalState } from "@domain/state/state.builder";
import { ARB_DEFS } from "@domain/arbitrage/routing";
import { buildClipScenario } from "@domain/arbitrage/clip";
import type { ClipExecutionVariant } from "@domain/arbitrage/clip.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClipResponseClip = {
  asset: string;
  amount: string;
  amountDecimal: number;
  amountUsd: number | null;
};

type ClipExecutionInitial = {
  flavor: "open" | "native" | "cex";
  fromAsset: string;
  toAsset: string;
  amountInDecimal?: number;
  amountOutDecimal?: number;
  poolPriceBefore?: number;
  poolPriceAfter?: number;
  poolBaseBefore?: number;
  poolQuoteBefore?: number;
  poolBaseAfter?: number;
  poolQuoteAfter?: number;
  onchainAmountOutDecimal?: number;
  onchainPoolPriceAfter?: number;
  onchainPoolBaseAfter?: number;
  onchainPoolQuoteAfter?: number;
  onchainSqrtPriceAfter?: string;
  onchainBaseDelta?: number;
  onchainQuoteDelta?: number;
  referencePriceBefore?: number;
  predictedPriceAfter?: number;
  onchainPriceAfter?: number;
  priceDiffBps?: number;
  referenceLabel?: string;
  effectivePrice?: number;
  onchainWarnings?: string[];
  baseSymbol?: string;
  quoteSymbol?: string;
  nativeRateMode?: "mint" | "redeem";
  nativeRateBasis?: "spot" | "moving_average" | "spot_equals_ma";
  nativeRateBasisLabel?: string;
  nativeRateSpot?: number;
  nativeRateMovingAverage?: number;
  nativeRateMintPrice?: number;
  nativeRateRedeemPrice?: number;
  nativeRateStableAsset?: string | null;
  nativeRateReferenceAsset?: string | null;
  nativeRatePairBase?: string | null;
  nativeRatePairQuote?: string | null;
  nativeReferenceUsdBase?: string | null;
  nativeReferenceUsdQuote?: string | null;
  nativeReferenceSpotUsd?: number | null;
  nativeReferenceMovingAverageUsd?: number | null;
  evaluation?: Record<string, unknown> | null;
};

type ClipSearchIterationInitial = {
  iteration: number;
  amountDecimal: number;
  openAmountOutDecimal: number | null;
  closeAmountOutDecimal: number | null;
  poolPriceAfter: number | null;
  validatedPriceAfter: number | null;
  counterPriceAfter: number | null;
  targetPrice: number | null;
  targetDiffBps: number | null;
  priceDiffBps: number | null;
  priceGap?: number | null;
};

type ClipOptionInitial = {
  flavor: "native" | "cex";
  clip: ClipResponseClip;
  open: {
    candidate: Record<string, unknown> | null;
    execution: ClipExecutionInitial | null;
    searchLog: ClipSearchIterationInitial[];
  };
  close: {
    candidate: Record<string, unknown> | null;
    execution: ClipExecutionInitial | null;
  };
  summary: {
    netUsdChange: number | null;
    totalCostUsd: number | null;
    notes: string[];
  };
  initialPrice: number | null;
  referencePrice: number | null;
  targetPrice: number | null;
};

type ClipExplorerData = {
  generatedAt: string;
  asset: string;
  direction: string;
  pool: Record<string, unknown> | null;
  zephSpotUsd: number | null;
  options: ClipOptionInitial[];
  error?: string;
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[]>>;
};

export default async function ClipExplorerPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const state = await buildGlobalState();

  const assetParam = normalizeAsset(readSearchParam(resolvedSearchParams, "asset"));
  const directionParam = normalizeDirection(readSearchParam(resolvedSearchParams, "direction"));
  const flavorParam = normalizeFlavor(readSearchParam(resolvedSearchParams, "flavor"));

  const defaultLeg = ARB_DEFS.find((entry) => entry.asset === "ZEPH" && entry.direction === "evm_discount") ?? null;
  const requestedLeg =
    assetParam && directionParam
      ? ARB_DEFS.find(
          (entry) => entry.asset.toUpperCase() === assetParam && entry.direction === directionParam,
        ) ?? null
      : null;

  const leg = requestedLeg ?? defaultLeg;

  let initialData: ClipExplorerData | null = null;
  if (leg) {
    let scenario: Awaited<ReturnType<typeof buildClipScenario>> | null = null;
    try {
      scenario = await buildClipScenario(leg, state, { pathLimit: 3 });
    } catch (error) {
      scenario = null;
    }

    const mappedOptions = scenario
      ? scenario.options.map<ClipOptionInitial>((option) => ({
          flavor: option.flavor,
          clip: {
            asset: option.clip.asset,
            amount: option.clip.amount.toString(),
            amountDecimal: option.clip.amountDecimal,
            amountUsd: option.clip.amountUsd,
          },
          open: {
            candidate: serializeValue(option.open.candidate) as Record<string, unknown> | null,
            execution: option.open.execution ? serializeExecution(option.open.execution) : null,
            searchLog: option.open.searchLog.map((entry) => ({
              iteration: entry.iteration,
              amountDecimal: entry.amountDecimal,
              openAmountOutDecimal: entry.openAmountOutDecimal ?? null,
              closeAmountOutDecimal: entry.closeAmountOutDecimal ?? null,
              poolPriceAfter: entry.poolPriceAfter,
              validatedPriceAfter: entry.validatedPriceAfter,
              counterPriceAfter: entry.counterPriceAfter,
              targetPrice: entry.targetPrice ?? null,
              targetDiffBps: entry.targetDiffBps ?? null,
              priceDiffBps: entry.priceDiffBps,
              priceGap: entry.priceGap ?? null,
            })),
          },
          close: {
            candidate: serializeValue(option.close.candidate) as Record<string, unknown> | null,
            execution: option.close.execution ? serializeExecution(option.close.execution) : null,
          },
          summary: {
            netUsdChange: option.summary.netUsdChange,
            totalCostUsd: option.summary.totalCostUsd,
            notes: option.summary.notes,
          },
          initialPrice: option.initialPrice ?? null,
          referencePrice: option.referencePrice ?? null,
          targetPrice: option.targetPrice ?? null,
        }))
      : [];

    initialData = {
      generatedAt: new Date().toISOString(),
      asset: leg.asset,
      direction: leg.direction,
      pool: scenario?.pool ? (serializeValue(scenario.pool) as Record<string, unknown>) : null,
      zephSpotUsd: state.zephyr?.reserve?.rates.zeph?.spot ?? null,
      options: sortClipOptionsRaw(mappedOptions, flavorParam),
    };

    if (!scenario) {
      initialData.error = "Clip scenario unavailable";
    }
  }

  return (
    <main style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Clip Explorer</h1>
        <p style={{ margin: 0, opacity: 0.75, lineHeight: 1.55 }}>
          Probe the arbitrage legs with the planner&apos;s clip sizing. Inspect pool depth, expected fills, and inventory
          deltas for open and close variants.
        </p>
      </header>

      <ClipExplorer initialData={initialData} />
    </main>
  );
}

async function resolveSearchParams(
  input?: Promise<Record<string, string | string[]>>,
): Promise<Record<string, string | string[]>> {
  if (!input) return {};
  const resolved = await input;
  return resolved ?? {};
}

function readSearchParam(params: Record<string, string | string[]>, key: string): string | null {
  if (!params) return null;
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function normalizeAsset(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDirection(value: string | null): "evm_discount" | "evm_premium" | null {
  if (!value) return null;
  if (value === "evm_discount" || value === "evm_premium") return value;
  return null;
}

function normalizeFlavor(value: string | null): "native" | "cex" | null {
  if (!value) return null;
  if (value === "native" || value === "cex") return value;
  return null;
}

function sortClipOptionsRaw(options: ClipOptionInitial[], preferredFlavor: "native" | "cex" | null): ClipOptionInitial[] {
  if (!preferredFlavor || options.length <= 1) return options;
  const sorted = [...options];
  sorted.sort((a, b) => {
    const aPreferred = a.flavor === preferredFlavor;
    const bPreferred = b.flavor === preferredFlavor;
    if (aPreferred && !bPreferred) return -1;
    if (bPreferred && !aPreferred) return 1;
    return 0;
  });
  return sorted;
}

function serializeValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => serializeValue(entry));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = serializeValue(entry);
    }
    return result;
  }
  return value;
}

function serializeExecution(execution: ClipExecutionVariant): ClipExecutionInitial {
  const payload: ClipExecutionInitial = {
    flavor: execution.flavor,
    fromAsset: execution.fromAsset,
    toAsset: execution.toAsset,
  };

  assignIfPresent(payload, "amountInDecimal", execution.amountInDecimal);
  assignIfPresent(payload, "amountOutDecimal", execution.amountOutDecimal);
  assignIfPresent(payload, "poolPriceBefore", execution.poolPriceBefore);
  assignIfPresent(payload, "poolPriceAfter", execution.poolPriceAfter);
  assignIfPresent(payload, "poolBaseBefore", execution.poolBaseBefore);
  assignIfPresent(payload, "poolQuoteBefore", execution.poolQuoteBefore);
  assignIfPresent(payload, "poolBaseAfter", execution.poolBaseAfter);
  assignIfPresent(payload, "poolQuoteAfter", execution.poolQuoteAfter);
  assignIfPresent(payload, "onchainAmountOutDecimal", execution.onchainAmountOutDecimal);
  assignIfPresent(payload, "onchainPoolPriceAfter", execution.onchainPoolPriceAfter);
  assignIfPresent(payload, "onchainPoolBaseAfter", execution.onchainPoolBaseAfter);
  assignIfPresent(payload, "onchainPoolQuoteAfter", execution.onchainPoolQuoteAfter);
  if (execution.onchainSqrtPriceAfter != null) {
    payload.onchainSqrtPriceAfter = execution.onchainSqrtPriceAfter.toString();
  }
  assignIfPresent(payload, "onchainBaseDelta", execution.onchainBaseDelta);
  assignIfPresent(payload, "onchainQuoteDelta", execution.onchainQuoteDelta);
  assignIfPresent(payload, "referencePriceBefore", execution.referencePriceBefore);
  assignIfPresent(payload, "predictedPriceAfter", execution.predictedPriceAfter);
  assignIfPresent(payload, "onchainPriceAfter", execution.onchainPriceAfter);
  assignIfPresent(payload, "priceDiffBps", execution.priceDiffBps);
  if (execution.referenceLabel) {
    payload.referenceLabel = execution.referenceLabel;
  }
  assignIfPresent(payload, "effectivePrice", execution.effectivePrice);
  if (execution.onchainWarnings && execution.onchainWarnings.length > 0) {
    payload.onchainWarnings = execution.onchainWarnings;
  }
  if (execution.baseSymbol) payload.baseSymbol = execution.baseSymbol;
  if (execution.quoteSymbol) payload.quoteSymbol = execution.quoteSymbol;
  if (execution.nativeRateMode) payload.nativeRateMode = execution.nativeRateMode;
  if (execution.nativeRateBasis) payload.nativeRateBasis = execution.nativeRateBasis;
  if (execution.nativeRateBasisLabel) payload.nativeRateBasisLabel = execution.nativeRateBasisLabel;
  assignIfPresent(payload, "nativeRateSpot", execution.nativeRateSpot);
  assignIfPresent(payload, "nativeRateMovingAverage", execution.nativeRateMovingAverage);
  assignIfPresent(payload, "nativeRateMintPrice", execution.nativeRateMintPrice);
  assignIfPresent(payload, "nativeRateRedeemPrice", execution.nativeRateRedeemPrice);
  assignIfPresent(payload, "nativeRateStableAsset", execution.nativeRateStableAsset);
  assignIfPresent(payload, "nativeRateReferenceAsset", execution.nativeRateReferenceAsset);
  assignIfPresent(payload, "nativeRatePairBase", execution.nativeRatePairBase);
  assignIfPresent(payload, "nativeRatePairQuote", execution.nativeRatePairQuote);
  assignIfPresent(payload, "nativeReferenceUsdBase", execution.nativeReferenceUsdBase);
  assignIfPresent(payload, "nativeReferenceUsdQuote", execution.nativeReferenceUsdQuote);
  assignIfPresent(payload, "nativeReferenceSpotUsd", execution.nativeReferenceSpotUsd);
  assignIfPresent(payload, "nativeReferenceMovingAverageUsd", execution.nativeReferenceMovingAverageUsd);
  const evaluation = serializeValue(execution.evaluation) as Record<string, unknown> | null;
  if (evaluation) payload.evaluation = evaluation;

  return payload;
}

function assignIfPresent<K extends keyof ClipExecutionInitial>(
  target: ClipExecutionInitial,
  key: K,
  value: ClipExecutionInitial[K] | null | undefined,
) {
  if (value === null || value === undefined) return;
  target[key] = value;
}
