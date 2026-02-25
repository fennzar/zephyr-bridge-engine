import { ARB_DEFS, type ArbLegs } from "@domain/arbitrage/routing";
import type { InventoryBalances, PathEvaluation } from "@domain/pathing";
import { evaluatePaths } from "@domain/pathing";
import {
  buildQuoterAwareLegPreparationPlan,
} from "@domain/pathing/arb";
import type { GlobalState } from "@domain/state/types";
import type { AssetId } from "@domain/types";

import type { ArbPlan, ArbPlanStep, ArbPlannerOptions } from "./types.plan";
import { buildClipScenario, estimateClipAmount } from "./clip";
import type { ClipEstimate, ClipOption } from "./clip.types";

import {
  uniqueStrings,
  defaultProbeAmount,
  firstNonZero,
  formatUsd,
  formatBalance,
  inferLegBaseAsset,
  toDecimal,
  appendNote,
  collectDisallowReasons,
  collectWarnings,
} from "./planner.utils";

import {
  annotatePreparationInventory,
  buildInventorySteps,
} from "./planner.inventory";

import {
  buildEmptyStages,
  buildPreparationEntry,
  buildCloseVariants,
  buildExecutionStep,
  selectClipOption,
  sumCosts,
} from "./planner.stages";

// Re-export everything that was previously accessible from this module
export {
  pickCandidate,
  uniqueStrings,
  defaultProbeAmount,
  firstNonZero,
  formatUsd,
  formatBalance,
  formatSemanticStep,
  inferLegBaseAsset,
  toDecimal,
  appendNote,
  collectDisallowReasons,
  collectWarnings,
} from "./planner.utils";

export {
  annotatePreparationInventory,
  buildInventorySteps,
  buildInventoryEntries,
} from "./planner.inventory";

export {
  buildEmptyStages,
  buildPreparationEntry,
  buildCloseVariants,
  buildExecutionStep,
  selectClipOption,
  sumCosts,
} from "./planner.stages";

export interface BuildArbPlanArgs {
  state: GlobalState;
  inventory?: InventoryBalances;
  options?: ArbPlannerOptions;
}

export interface BuildArbPlansArgs extends BuildArbPlanArgs {
  legs?: ArbLegs[];
}

const STABLE_ASSETS: ReadonlySet<AssetId> = new Set<AssetId>(["WZSD.e", "ZSD.n", "USDT.e", "USDT.x"]);

export async function buildArbPlan(leg: ArbLegs, args: BuildArbPlanArgs): Promise<ArbPlan> {
  const baseAsset = inferLegBaseAsset(leg);
  const openAsset = leg.open[0]?.from as AssetId | undefined;

  let clipScenarioError: string | null = null;
  let clipOptions: ClipOption[] = [];
  let clipOption: ClipOption | null = null;

  if (openAsset) {
    try {
      const scenario = await buildClipScenario(leg, args.state, {
        amountOverride: args.options?.amountOverride,
        pathLimit: args.options?.pathLimit,
      });
      clipOptions = scenario?.options ?? [];
      clipOption = selectClipOption(clipOptions);
    } catch (error) {
      clipScenarioError = error instanceof Error ? error.message : String(error);
    }
  }

  let clipEstimate: ClipEstimate | null = clipOption?.clip ?? null;
  if (!clipEstimate && openAsset) {
    clipEstimate = estimateClipAmount(leg, args.state, { amountOverride: args.options?.amountOverride });
  }

  const amountOverrides: Partial<Record<AssetId, bigint>> | undefined = (() => {
    if (openAsset && args.options?.amountOverride != null) {
      return { [openAsset]: args.options.amountOverride };
    }
    if (openAsset && clipEstimate?.amount) {
      return { [openAsset]: clipEstimate.amount };
    }
    return undefined;
  })();

  const preparation = await buildQuoterAwareLegPreparationPlan(leg, args.state, {
    maxDepth: args.options?.maxDepth,
    pathLimit: args.options?.pathLimit,
    amountOverrides,
    inventoryBalances: args.inventory,
  });

  const stages = buildEmptyStages();
  const summaryNotes: string[] = [];
  if (clipScenarioError) {
    summaryNotes.push(`Clip sizing failed: ${clipScenarioError}`);
  }
  if (clipOption && clipEstimate) {
    const amountDescription = `${formatBalance(clipEstimate.amountDecimal)} ${clipEstimate.asset}`;
    const usdText = clipEstimate.amountUsd != null && Number.isFinite(clipEstimate.amountUsd)
      ? ` (~${formatUsd(clipEstimate.amountUsd)})`
      : "";
    summaryNotes.push(`Clip sized at ${amountDescription}${usdText} via ${clipOption.flavor.toUpperCase()} close.`);
    if (clipOption.summary.netUsdChange != null && Number.isFinite(clipOption.summary.netUsdChange)) {
      summaryNotes.push(`Projected net Δ USD ${formatUsd(clipOption.summary.netUsdChange)} (open + close).`);
    }
    if (clipOption.summary.totalCostUsd != null && Number.isFinite(clipOption.summary.totalCostUsd)) {
      summaryNotes.push(`Estimated execution cost ${formatUsd(clipOption.summary.totalCostUsd)}.`);
    }
    if (clipOption.summary.notes.length > 0) {
      summaryNotes.push(...clipOption.summary.notes);
    }
  } else if (clipEstimate && !clipScenarioError) {
    summaryNotes.push("Clip sized via heuristic pool estimate; calibration unavailable.");
  } else if (!clipEstimate && !clipScenarioError) {
    summaryNotes.push("Unable to determine clip size; using default probe amount.");
  }
  const inventoryNotes = new Set<string>();

  let inventoryLimited = false;
  let planBlocked = false;

  const openPrepResults = preparation.open.map((prep, index) =>
    buildPreparationEntry({
      leg,
      prep,
      stage: "preparation",
      idSuffix: `open-${index}`,
      inventoryNotes,
      segment: { kind: "open", index },
    }),
  );

  openPrepResults.forEach((result) => {
    stages.preparation.push(result.step);
    if (result.inventoryLimited) inventoryLimited = true;
    if (result.step.blocked) planBlocked = true;
  });

  const closeVariants = buildCloseVariants(leg, preparation.close, inventoryNotes, baseAsset);
  closeVariants.forEach((variant) => {
    if (variant.inventoryLimited) inventoryLimited = true;
  });

  let chosenClose = clipOption?.flavor
    ? closeVariants.find((variant) => variant.flavor === clipOption.flavor && variant.steps.length > 0) ?? null
    : null;
  if (!chosenClose) {
    chosenClose =
      closeVariants.find((variant) => !variant.blocked && variant.steps.length > 0) ??
      closeVariants.find((variant) => variant.steps.length > 0) ??
      null;
  }

  summaryNotes.push(
    ...closeVariants
      .filter((variant) => variant.steps.length > 0)
      .map((variant) =>
        variant.blocked
          ? `Close leg (${variant.flavor}) currently blocked: ${variant.blockReasons.join("; ")}`
          : `Close leg (${variant.flavor}) available.`,
      ),
  );

  closeVariants.forEach((variant) => {
    variant.steps.forEach((result, index) => {
      const isChosen = chosenClose === variant;
      const extraNotes = isChosen ? ["Selected close path"] : ["Alternative close path"];
      const step = result.step;
      step.id = `${step.id}-${variant.flavor}-${index}`;
      step.label = `Close prep (${variant.flavor}) · Step ${index + 1}${isChosen ? " [selected]" : ""}`;
      extraNotes.forEach((message) => {
        step.notes = appendNote(step.notes, message);
      });
      step.flavor = variant.flavor;
      stages.preparation.push(step);
      if (isChosen && step.blocked) planBlocked = true;
    });
  });

  if (!chosenClose) {
    planBlocked = true;
    summaryNotes.push("No close leg variant available.");
  }

  const baseAmount =
    args.options?.amountOverride ??
    clipEstimate?.amount ??
    firstNonZero(openPrepResults.map((result) => result.candidate?.amountIn)) ??
    defaultProbeAmount(leg.open[0]?.from ?? leg.open[0]?.to ?? baseAsset);

  const openExecutionStep = buildExecutionStep({
    idSuffix: "open",
    labelPrefix: "Execute open leg",
    steps: leg.open,
    amount: baseAmount,
    blocked: openPrepResults.some((result) => result.step.blocked),
  });
  if (openExecutionStep) stages.execution.push(openExecutionStep);

  closeVariants.forEach((variant) => {
    const executionStep = buildExecutionStep({
      idSuffix: `close-${variant.flavor}`,
      labelPrefix: `Execute close (${variant.flavor})${variant === chosenClose ? " [selected]" : " [alt]"}`,
      steps: variant.semanticSteps,
      amount: baseAmount,
      blocked: variant.blocked,
    });
    if (executionStep) {
      executionStep.flavor = variant.flavor;
      const selectionNote = variant === chosenClose ? "Chosen execution path." : "Alternative execution path.";
      executionStep.notes = [...(executionStep.notes ?? []), selectionNote];
      executionStep.notes.push(...variant.blockReasons.map((reason) => `Close ${variant.flavor}: ${reason}`));
      stages.execution.push(executionStep);
      if (variant === chosenClose && executionStep.blocked) planBlocked = true;
    }
  });

  let currentAsset: AssetId | null = chosenClose?.finalAsset ?? leg.open[leg.open.length - 1]?.to ?? baseAsset;

  const settlementSteps = await buildSettlementSteps({
    leg,
    currentAsset,
    amount: baseAmount,
    state: args.state,
    inventory: args.inventory,
    options: args.options,
  });

  settlementSteps.settlement?.forEach((step) => {
    stages.settlement.push(step);
    if (step.blocked) planBlocked = true;
  });
  settlementSteps.realisation?.forEach((step) => {
    stages.realisation.push(step);
    if (step.blocked) planBlocked = true;
  });

  currentAsset = settlementSteps.finalAsset ?? currentAsset;

  const estimatedCostUsd =
    sumCosts(openPrepResults.map((entry) => entry.candidate?.evaluation)) +
    sumCosts(chosenClose?.steps.map((entry) => entry.candidate?.evaluation) ?? []) +
    sumCosts(settlementSteps.settlement?.map((step) => step.path) ?? []) +
    sumCosts(settlementSteps.realisation?.map((step) => step.path) ?? []);

  if (!planBlocked) {
    summaryNotes.push("Plan ready for execution once approvals are in place.");
  } else {
    summaryNotes.push("Plan currently blocked; resolve highlighted issues before execution.");
  }

  const openNeedAsset = leg.open[0]?.from ?? baseAsset;
  const baseAmountDecimal = toDecimal(baseAmount, openNeedAsset);
  if (
    annotatePreparationInventory(openPrepResults, openNeedAsset, baseAmountDecimal, args.inventory, inventoryNotes)
  ) {
    inventoryLimited = true;
  }

  closeVariants.forEach((variant) => {
    const needAsset = variant.semanticSteps[0]?.from ?? null;
    if (
      annotatePreparationInventory(
        variant.steps,
        needAsset as AssetId | undefined,
        baseAmountDecimal,
        args.inventory,
        inventoryNotes,
      )
    ) {
      variant.inventoryLimited = true;
      if (variant === chosenClose) inventoryLimited = true;
    }
  });
  const inventoryStepsResult = buildInventorySteps({
    leg,
    inventory: args.inventory,
    openAsset: openNeedAsset,
    openAmount: baseAmountDecimal,
    inventoryNotes,
    closeVariants,
    chosenClose,
  });
  if (inventoryStepsResult.length > 0) {
    stages.inventory = [...inventoryStepsResult, ...stages.inventory];
    const inventoryBlocked = inventoryStepsResult.some((step) => step.inventoryDetails?.some((entry) => !entry.ok));
    if (!inventoryLimited && inventoryBlocked) inventoryLimited = true;
    if (inventoryLimited && !summaryNotes.includes("Inventory shortfall detected; additional preparation required.")) {
      summaryNotes.push("Inventory shortfall detected; additional preparation required.");
    }
  }

  const clipNetUsd = clipOption?.summary.netUsdChange ?? null;
  const clipCostUsd = clipOption?.summary.totalCostUsd ?? null;

  const finalNotes = uniqueStrings(summaryNotes);

  return {
    asset: leg.asset,
    direction: leg.direction,
    stages,
    summary: {
      estimatedProfitUsd: clipNetUsd,
      estimatedCostUsd: clipCostUsd ?? (estimatedCostUsd === 0 ? null : estimatedCostUsd),
      inventoryLimited,
      notes: finalNotes,
      blocked: planBlocked,
      closeFlavor: clipOption?.flavor ?? chosenClose?.flavor ?? null,
      clipAsset: clipEstimate?.asset,
      clipAmount: clipEstimate?.amount ?? null,
      clipAmountDecimal: clipEstimate?.amountDecimal ?? null,
      clipAmountUsd: clipEstimate?.amountUsd ?? null,
      clipOption: clipOption ?? null,
      clipOptions: clipOptions.length > 0 ? clipOptions : null,
      clipScenarioError,
    },
  };
}

export async function buildArbPlans(args: BuildArbPlansArgs): Promise<ArbPlan[]> {
  const legs = args.legs ?? ARB_DEFS;
  const plans: ArbPlan[] = [];
  for (const leg of legs) {
    plans.push(
      await buildArbPlan(leg, {
        state: args.state,
        inventory: args.inventory,
        options: args.options,
      }),
    );
  }
  return plans;
}

export async function buildSettlementSteps({
  leg,
  currentAsset,
  amount,
  state,
  inventory,
  options,
}: {
  leg: ArbLegs;
  currentAsset: AssetId | null;
  amount: bigint;
  state: GlobalState;
  inventory?: InventoryBalances;
  options?: ArbPlannerOptions;
}): Promise<{
  settlement?: ArbPlanStep[];
  realisation?: ArbPlanStep[];
  finalAsset?: AssetId | null;
}> {
  const settlementSteps: ArbPlanStep[] = [];
  const realisationSteps: ArbPlanStep[] = [];
  let assetCursor = currentAsset;

  if (assetCursor && !STABLE_ASSETS.has(assetCursor)) {
    const settlementTarget: AssetId = "WZSD.e";
    const evaluation = await evaluateBestPath(assetCursor, settlementTarget, amount, state, inventory, options);
    if (evaluation) {
      settlementSteps.push({
        id: `${leg.asset}-${leg.direction}-settlement`,
        stage: "settlement",
        label: `Settle ${assetCursor} → ${settlementTarget}`,
        description: evaluation.path.assets.join(" → "),
        amountIn: amount,
        path: evaluation,
        blocked: !evaluation.score.allowed,
        notes: buildPathNotes(evaluation),
      });
      assetCursor = settlementTarget;
    } else {
      settlementSteps.push({
        id: `${leg.asset}-${leg.direction}-settlement`,
        stage: "settlement",
        label: `Settle ${assetCursor}`,
        notes: ["Unable to derive settlement path to WZSD.e."],
        blocked: true,
      });
      assetCursor = null;
    }
  }

  if (assetCursor && assetCursor !== "USDT.e") {
    const realisationTarget: AssetId = "USDT.e";
    const evaluation = await evaluateBestPath(assetCursor, realisationTarget, amount, state, inventory, options);
    if (evaluation) {
      realisationSteps.push({
        id: `${leg.asset}-${leg.direction}-realisation`,
        stage: "realisation",
        label: `Realise profit in ${realisationTarget}`,
        description: evaluation.path.assets.join(" → "),
        amountIn: amount,
        path: evaluation,
        blocked: !evaluation.score.allowed,
        notes: buildPathNotes(evaluation),
      });
      assetCursor = realisationTarget;
    } else {
      realisationSteps.push({
        id: `${leg.asset}-${leg.direction}-realisation`,
        stage: "realisation",
        label: `Realise profit`,
        notes: ["Unable to derive path to USDT.e."],
        blocked: true,
      });
      assetCursor = null;
    }
  }

  return {
    settlement: settlementSteps.length > 0 ? settlementSteps : undefined,
    realisation: realisationSteps.length > 0 ? realisationSteps : undefined,
    finalAsset: assetCursor,
  };
}

export async function evaluateBestPath(
  from: AssetId,
  to: AssetId,
  amountIn: bigint,
  state: GlobalState,
  inventory?: InventoryBalances,
  options?: ArbPlannerOptions,
): Promise<PathEvaluation | null> {
  if (amountIn <= 0n) return null;
  const result = await evaluatePaths(
    {
      from,
      to,
      amountIn,
      maxDepth: options?.maxDepth,
      limit: options?.pathLimit ?? 5,
      inventory,
    },
    state,
  );
  return result.paths[0] ?? null;
}

export function buildPathNotes(evaluation: PathEvaluation): string[] {
  const notes: string[] = [];
  if (!evaluation.score.allowed) {
    notes.push(...collectDisallowReasons(evaluation).map((reason) => `Blocked: ${reason}`));
  }
  const warnings = collectWarnings(evaluation);
  if (warnings.length > 0) {
    warnings.forEach((warning) => notes.push(`Warning: ${warning}`));
  }
  if (notes.length === 0) {
    notes.push("Path allowed.");
  }
  return notes;
}
