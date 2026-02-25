import { assetDecimals } from "@domain/assets/decimals";
import { buildClipScenario, buildClipPriceMap } from "@domain/arbitrage/clip";
import type { ClipOption, ClipExecutionVariant } from "@domain/arbitrage/clip.types";
import { ARB_DEFS, type ArbLegs, type LegSegmentKind } from "@domain/arbitrage/routing";
import type {
  ArbPlan,
  ArbPlanLegPrepView,
  ArbPlanView,
  ArbPlanViewClipOption,
} from "@domain/arbitrage/types.plan";
import { buildQuoterAwareSegmentPreparation } from "@domain/pathing/arb";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import type { InventoryBalances } from "@domain/pathing";
import type { GlobalState } from "@domain/state/types";
import type { AssetId } from "@domain/types";

export async function buildArbPlanView(
  plan: ArbPlan,
  state: GlobalState,
  inventory?: InventoryBalances,
): Promise<ArbPlanView | null> {
  const leg = ARB_DEFS.find(
    (entry) => entry.asset === plan.asset && entry.direction === plan.direction,
  );
  if (!leg) return null;

  const amountOverride = plan.summary.clipAmount;

  const priceMap = buildClipPriceMap(state);

  const clipScenario = await buildClipScenario(
    leg,
    state,
    amountOverride ? { amountOverride } : undefined,
  ).catch(() => null);
  if (!clipScenario) return null;

  const clips: ArbPlanViewClipOption[] = [];
  for (const option of clipScenario.options) {
    const enrichedOption = cloneClipOption(option);
    const prepOpen = await evaluateSegmentPrep(
      plan,
      leg,
      enrichedOption,
      "open",
      0,
      state,
      inventory,
    );
    const closeKind: LegSegmentKind =
      option.flavor === "native" ? "close_native" : "close_cex";
    const prepClose = await evaluateSegmentPrep(
      plan,
      leg,
      enrichedOption,
      closeKind,
      0,
      state,
      inventory,
    );

    hydrateOptionLeg(enrichedOption.open, prepOpen);
    hydrateOptionLeg(enrichedOption.close, prepClose);
    ensureRouteEconomics(enrichedOption, priceMap);

    clips.push({
      option: enrichedOption,
      prep: {
        open: prepOpen,
        close: prepClose,
      },
    });
  }

  return { clipOptions: clips };
}

function cloneClipOption(option: ClipOption): ClipOption {
  return {
    ...option,
    clip: { ...option.clip },
    open: {
      ...option.open,
      searchLog: option.open.searchLog.map((entry) => ({ ...entry })),
      candidate: option.open.candidate ? { ...option.open.candidate } : null,
      execution: option.open.execution ? { ...option.open.execution } : null,
    },
    close: {
      ...option.close,
      candidate: option.close.candidate ? { ...option.close.candidate } : null,
      execution: option.close.execution ? { ...option.close.execution } : null,
    },
    summary: { ...option.summary, notes: [...option.summary.notes] },
  };
}

function hydrateOptionLeg(
  leg: ClipOption["open"] | ClipOption["close"],
  prep: ArbPlanLegPrepView | null,
) {
  if (!leg || !prep?.candidate) return;
  leg.candidate = prep.candidate;
}

async function evaluateSegmentPrep(
  plan: ArbPlan,
  leg: ArbLegs,
  option: ClipOption,
  kind: LegSegmentKind,
  index: number,
  state: GlobalState,
  inventory?: InventoryBalances,
): Promise<ArbPlanLegPrepView | null> {
  const targetStep =
    kind === "open"
      ? leg.open[index]
      : kind === "close_native"
        ? leg.close.native[index]
        : leg.close.cex?.[index];
  if (!targetStep) return null;

  const amountOverride = deriveAmountOverride(kind, option);
  const overrideMap =
    amountOverride && amountOverride > 0n
      ? { [targetStep.from as AssetId]: amountOverride }
      : undefined;

  const prep = await buildQuoterAwareSegmentPreparation(
    {
      asset: plan.asset,
      direction: plan.direction,
      kind,
      stepIndex: index,
    },
    state,
    {
      amountOverrides: overrideMap,
      inventoryBalances: inventory,
    },
  );

  const candidate = selectPreferredCandidate(prep.step.candidates);

  if (candidate && amountOverride && amountOverride > 0n) {
    candidate.amountIn = amountOverride;
  }

  return {
    need: prep.step.need,
    amountIn: amountOverride ?? candidate?.amountIn ?? null,
    candidate,
    evaluation: candidate?.evaluation ?? null,
    candidates: prep.step.candidates,
  };
}

function selectPreferredCandidate(candidates: QuoterAwareCandidate[]): QuoterAwareCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const preferred = candidates.find(
    (candidate) =>
      candidate.evaluation.inventory?.status !== "short" &&
      candidate.evaluation.score?.inventoryStatus !== "short",
  );
  return preferred ?? candidates[0] ?? null;
}

function deriveAmountOverride(kind: LegSegmentKind, option: ClipOption): bigint | null {
  if (kind === "open") {
    return decimalToUnits(option.open?.execution?.amountInDecimal, option.open?.execution?.fromAsset);
  }

  const closeExecution = option.close?.execution;
  if (!closeExecution) return null;
  return decimalToUnits(closeExecution.amountInDecimal, closeExecution.fromAsset);
}

function decimalToUnits(amount: number | null | undefined, asset: AssetId | null | undefined): bigint | null {
  if (amount == null || asset == null || !Number.isFinite(amount) || amount <= 0) return null;
  const decimals = assetDecimals(asset);
  const fixed = amount.toFixed(decimals > 12 ? 12 : decimals);
  const normalized = fixed.replace(".", "");
  try {
    const value = BigInt(normalized);
    if (decimals > 12) {
      const scale = BigInt(10) ** BigInt(decimals - 12);
      return value * scale;
    }
    return value;
  } catch {
    return null;
  }
}

function ensureRouteEconomics(
  option: ClipOption,
  priceMap: Partial<Record<AssetId, number>>,
) {
  const openNet =
    option.open?.execution?.evaluation?.score?.netUsdChangeUsd ??
    computeExecutionNet(option.open?.execution ?? null, priceMap);
  const closeNet =
    option.close?.execution?.evaluation?.score?.netUsdChangeUsd ??
    computeExecutionNet(option.close?.execution ?? null, priceMap);
  if (option.summary.netUsdChange == null && openNet != null && closeNet != null) {
    option.summary.netUsdChange = openNet + closeNet;
  }

  const openCost =
    option.open?.execution?.evaluation?.score?.totalCostUsd ??
    (openNet != null ? -openNet : null);
  const closeCost =
    option.close?.execution?.evaluation?.score?.totalCostUsd ??
    (closeNet != null ? -closeNet : null);
  if (option.summary.totalCostUsd == null && openCost != null && closeCost != null) {
    option.summary.totalCostUsd = openCost + closeCost;
  }
}

function computeExecutionNet(
  execution: ClipExecutionVariant | null,
  priceMap: Partial<Record<AssetId, number>>,
): number | null {
  if (!execution) return null;
  const fromPrice = resolveUsdPrice(execution.fromAsset, priceMap);
  const toPrice = resolveUsdPrice(execution.toAsset, priceMap);
  if (execution.amountInDecimal == null || execution.amountOutDecimal == null) return null;
  const amountInUsd = fromPrice != null ? execution.amountInDecimal * fromPrice : null;
  const amountOutUsd = toPrice != null ? execution.amountOutDecimal * toPrice : null;
  if (amountInUsd == null || amountOutUsd == null) return null;
  return amountOutUsd - amountInUsd;
}

function resolveUsdPrice(asset: AssetId, priceMap: Partial<Record<AssetId, number>>): number | null {
  const direct = priceMap[asset];
  if (direct != null && Number.isFinite(direct)) return direct;
  if (asset.endsWith(".x") || asset.endsWith(".e") || asset.endsWith(".n")) {
    const symbol = asset.toUpperCase();
    if (symbol.includes("USDT") || symbol.includes("ZSD")) {
      return 1;
    }
  }
  return null;
}
