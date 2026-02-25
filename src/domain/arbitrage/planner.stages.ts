import type { ArbLegs, LegSegmentKind, SemanticStep } from "@domain/arbitrage/routing";
import type { PathEvaluation } from "@domain/pathing";
import type {
  QuoterAwareCandidate,
  QuoterAwareLegPreparationPlan,
  QuoterAwareStepPreparation,
} from "@domain/pathing/arb";
import type { AssetId } from "@domain/types";

import type { ArbPlan, ArbPlanStage, ArbPlanStep } from "./types.plan";
import type { ClipOption } from "./clip.types";
import {
  pickCandidate,
  collectDisallowReasons,
  collectWarnings,
  formatBalance,
  formatSemanticStep,
} from "./planner.utils";

type StageEntries = Partial<Record<ArbPlanStage, ArbPlan["stages"][ArbPlanStage]>>;

export function buildEmptyStages(overrides?: StageEntries): ArbPlan["stages"] {
  return {
    inventory: overrides?.inventory ?? [],
    preparation: overrides?.preparation ?? [],
    execution: overrides?.execution ?? [],
    settlement: overrides?.settlement ?? [],
    realisation: overrides?.realisation ?? [],
  };
}

export function buildPreparationEntry({
  leg,
  prep,
  stage,
  idSuffix,
  inventoryNotes,
  segment,
}: {
  leg: ArbLegs;
  prep: QuoterAwareStepPreparation;
  stage: ArbPlanStage;
  idSuffix: string;
  inventoryNotes: Set<string>;
  segment: { kind: LegSegmentKind; index: number };
}): {
  step: ArbPlanStep;
  candidate: QuoterAwareCandidate | null;
  inventoryLimited: boolean;
  usageLabel: string;
} {
  const candidate = pickCandidate(prep);
  if (!candidate) {
    return {
      candidate: null,
      inventoryLimited: true,
      step: {
        id: `${leg.asset}-${leg.direction}-${idSuffix}`,
        stage,
        label: `Prepare ${prep.need}`,
        notes: ["No candidate paths available."],
        blocked: true,
        leg,
        prepSegment: segment,
      },
      usageLabel: `Prepare ${prep.need}`,
    };
  }

  const evaluation = candidate.evaluation;
  const blocked = !evaluation.score.allowed;
  const disallowReasons = collectDisallowReasons(evaluation);
  const warnings = collectWarnings(evaluation);

  let inventoryLimited = evaluation.inventory.status === "short";
  if (evaluation.inventory.status === "short") {
    evaluation.inventory.shortfalls.forEach((shortfall) => {
      inventoryNotes.add(
        `Shortfall ${shortfall.asset}: remaining ${formatBalance(shortfall.endingBalance)}.`,
      );
    });
  } else if (evaluation.inventory.status === "unknown") {
    inventoryNotes.add(`Inventory snapshot unavailable for ${prep.need}.`);
  }

  const notes = [
    ...disallowReasons.map((reason) => `Blocked: ${reason}`),
    ...warnings.map((warn) => `Warning: ${warn}`),
  ];

  if (!blocked && notes.length === 0) {
    notes.push("Path allowed.");
  }

  const usageLabel = formatSemanticStep(prep.step);

  return {
    candidate,
    inventoryLimited,
    step: {
      id: `${leg.asset}-${leg.direction}-${idSuffix}`,
      stage,
      label: `Prepare ${prep.need}`,
      description: `${candidate.path.assets.join(" → ")}`,
      path: evaluation,
      notes,
      blocked,
      skip: !inventoryLimited && !blocked,
      leg,
      amountIn: candidate.amountIn,
      prepSegment: segment,
    },
    usageLabel,
  };
}

export function buildCloseVariants(
  leg: ArbLegs,
  close: QuoterAwareLegPreparationPlan["close"],
  inventoryNotes: Set<string>,
  baseAsset: AssetId,
) {
  const variants: Array<{
    flavor: "native" | "cex";
    steps: Array<{
      step: ArbPlanStep;
      candidate: QuoterAwareCandidate | null;
      inventoryLimited: boolean;
    }>;
    semanticSteps: SemanticStep[];
    finalAsset: AssetId;
    blocked: boolean;
    inventoryLimited: boolean;
    blockReasons: string[];
  }> = [];

  const nativeSteps = close.native ?? [];
  if (nativeSteps.length > 0) {
    const results = nativeSteps.map((prep, index) =>
      buildPreparationEntry({
        leg,
        prep,
        stage: "preparation",
        idSuffix: `close-native-${index}`,
        inventoryNotes,
        segment: { kind: "close_native", index },
      }),
    );
    variants.push({
      flavor: "native",
      steps: results.map((result) => ({
        step: result.step,
        candidate: result.candidate,
        inventoryLimited: result.inventoryLimited,
      })),
      semanticSteps: leg.close.native,
      finalAsset: leg.close.native[leg.close.native.length - 1]?.to ?? baseAsset,
      blocked: results.some((result) => result.step.blocked),
      inventoryLimited: results.some((result) => result.inventoryLimited),
      blockReasons: results
        .flatMap((result) => result.step.notes ?? [])
        .filter((note) => note.startsWith("Blocked")),
    });
  }

  if (close.cex && close.cex.length > 0) {
    const results = close.cex.map((prep, index) =>
      buildPreparationEntry({
        leg,
        prep,
        stage: "preparation",
        idSuffix: `close-cex-${index}`,
        inventoryNotes,
        segment: { kind: "close_cex", index },
      }),
    );
    variants.push({
      flavor: "cex",
      steps: results.map((result) => ({
        step: result.step,
        candidate: result.candidate,
        inventoryLimited: result.inventoryLimited,
      })),
      semanticSteps: leg.close.cex ?? [],
      finalAsset: leg.close.cex?.[leg.close.cex.length - 1]?.to ?? baseAsset,
      blocked: results.some((result) => result.step.blocked),
      inventoryLimited: results.some((result) => result.inventoryLimited),
      blockReasons: results
        .flatMap((result) => result.step.notes ?? [])
        .filter((note) => note.startsWith("Blocked")),
    });
  }

  return variants;
}

export function buildExecutionStep({
  idSuffix,
  labelPrefix,
  steps,
  amount,
  blocked,
}: {
  idSuffix: string;
  labelPrefix: string;
  steps: SemanticStep[];
  amount: bigint;
  blocked: boolean;
}): ArbPlanStep | null {
  if (!steps || steps.length === 0) return null;
  const descriptions = steps.map((step) => formatSemanticStep(step));
  return {
    id: `${steps[0]!.from}-${steps[steps.length - 1]!.to}-${idSuffix}`,
    stage: "execution",
    label: labelPrefix,
    description: descriptions.join(" → "),
    amountIn: amount,
    notes: blocked ? ["Prerequisite preparation steps blocked."] : ["Ready when prerequisites satisfied."],
    blocked,
  };
}

export function selectClipOption(options: ClipOption[]): ClipOption | null {
  if (!options || options.length === 0) return null;
  const ranked = [...options].sort((a, b) => {
    const aNet = a.summary.netUsdChange ?? Number.NEGATIVE_INFINITY;
    const bNet = b.summary.netUsdChange ?? Number.NEGATIVE_INFINITY;
    if (aNet === bNet) {
      const aUsd = a.clip.amountUsd ?? 0;
      const bUsd = b.clip.amountUsd ?? 0;
      return Number(bUsd) - Number(aUsd);
    }
    return Number(bNet) - Number(aNet);
  });
  const positive = ranked.find((option) => (option.summary.netUsdChange ?? Number.NEGATIVE_INFINITY) > 0);
  return positive ?? ranked[0] ?? null;
}

export function sumCosts(evaluations: Array<PathEvaluation | QuoterAwareCandidate["evaluation"] | null | undefined>): number {
  let total = 0;
  for (const evaluation of evaluations) {
    if (!evaluation) continue;
    const cost = evaluation.score.totalCostUsd ?? evaluation.totalCostUsd ?? null;
    if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
  }
  return total;
}
