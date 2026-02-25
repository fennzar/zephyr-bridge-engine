import {
  buildLegPreparationPlan,
  ARB_DEFS,
  findArbLeg,
  type ArbDirection,
  type ArbLegs,
  type LegPreparationPlan,
  type LegSegmentKind,
  type StepPreparation,
} from "@domain/arbitrage/routing";
import type { AssetId } from "@domain/types";
import type { GlobalState } from "@domain/state/types";
import { assetDecimals } from "@domain/assets/decimals";
import type { AssetPathToTarget } from "@domain/inventory/graph";
import { evaluatePath, compareScores } from "./evaluator";
import type { InventoryBalances, PathEvaluation } from "./types";

export interface QuoterAwareCandidate {
  source: AssetId;
  amountIn: bigint;
  path: AssetPathToTarget["path"];
  evaluation: PathEvaluation;
}

export interface QuoterAwareStepPreparation {
  step: StepPreparation["step"];
  need: StepPreparation["need"];
  candidates: QuoterAwareCandidate[];
}

export interface QuoterAwareClosePreparation {
  native: QuoterAwareStepPreparation[];
  cex?: QuoterAwareStepPreparation[];
}

export interface QuoterAwareLegPreparationPlan {
  asset: LegPreparationPlan["asset"];
  direction: LegPreparationPlan["direction"];
  open: QuoterAwareStepPreparation[];
  close: QuoterAwareClosePreparation;
}

export interface QuoterAwareLegOptions {
  maxDepth?: number;
  pathLimit?: number;
  amountOverrides?: Partial<Record<AssetId, bigint>>;
  inventoryBalances?: InventoryBalances;
}

export interface QuoterAwareLegSegmentRequest {
  asset: ArbLegs["asset"];
  direction: ArbDirection;
  kind: LegSegmentKind;
  stepIndex?: number;
}

export interface QuoterAwareSegmentPlan {
  asset: LegPreparationPlan["asset"];
  direction: LegPreparationPlan["direction"];
  kind: LegSegmentKind;
  stepIndex: number;
  step: QuoterAwareStepPreparation;
}

export async function buildQuoterAwareLegPreparationPlan(
  leg: ArbLegs,
  state: GlobalState,
  options?: QuoterAwareLegOptions,
): Promise<QuoterAwareLegPreparationPlan> {
  const base = buildLegPreparationPlan(leg, { maxDepth: options?.maxDepth });

  const open = await Promise.all(
    base.open.map((step) => evaluateStepPreparation(step, state, options)),
  );
  const nativeClose = await Promise.all(
    base.close.native.map((step) => evaluateStepPreparation(step, state, options)),
  );
  const cexClose = base.close.cex
    ? await Promise.all(base.close.cex.map((step) => evaluateStepPreparation(step, state, options)))
    : undefined;

  return {
    asset: base.asset,
    direction: base.direction,
    open,
    close: {
      native: nativeClose,
      ...(cexClose ? { cex: cexClose } : {}),
    },
  };
}

export async function buildAllQuoterAwareLegPreparationPlans(
  state: GlobalState,
  options?: QuoterAwareLegOptions,
): Promise<QuoterAwareLegPreparationPlan[]> {
  const plans = await Promise.all(ARB_DEFS.map((leg) => buildQuoterAwareLegPreparationPlan(leg, state, options)));
  return plans;
}

export async function buildQuoterAwareSegmentPreparation(
  selector: QuoterAwareLegSegmentRequest,
  state: GlobalState,
  options?: QuoterAwareLegOptions,
): Promise<QuoterAwareSegmentPlan> {
  const leg = findArbLeg(selector.asset, selector.direction);
  if (!leg) {
    throw new Error(`Unknown arbitrage leg for ${selector.asset} (${selector.direction})`);
  }

  const basePlan = buildLegPreparationPlan(leg, { maxDepth: options?.maxDepth });
  const steps = selectStepsForKind(basePlan, selector.kind);
  const stepIndex = selector.stepIndex ?? 0;
  const targetStep = steps[stepIndex];
  if (!targetStep) {
    throw new Error(`No ${selector.kind} step #${stepIndex + 1} for ${leg.asset} (${leg.direction})`);
  }

  const evaluated = await evaluateStepPreparation(targetStep, state, options);

  return {
    asset: leg.asset,
    direction: leg.direction,
    kind: selector.kind,
    stepIndex,
    step: evaluated,
  };
}

async function evaluateStepPreparation(
  step: StepPreparation,
  state: GlobalState,
  options?: QuoterAwareLegOptions,
): Promise<QuoterAwareStepPreparation> {
  const pathLimit = options?.pathLimit;
  const trimmed = typeof pathLimit === "number" && pathLimit > 0 ? step.candidates.slice(0, pathLimit) : step.candidates;

  const evaluated: QuoterAwareCandidate[] = [];

  for (const candidate of trimmed) {
    const amountIn = probeAmountForCandidate(candidate, step.need, options?.amountOverrides);
    if (amountIn <= 0n) continue;
    const evaluation = await evaluatePath(candidate.path, state, amountIn, options?.inventoryBalances);
    const enriched: QuoterAwareCandidate = {
      source: candidate.source,
      amountIn,
      path: candidate.path,
      evaluation,
    };
    adjustDirectInventoryStatus(enriched, step.need, options?.inventoryBalances);
    evaluated.push(enriched);
  }

  evaluated.sort((a, b) => compareScores(a.evaluation.score, b.evaluation.score));

  return {
    step: step.step,
    need: step.need,
    candidates: evaluated,
  };
}

function probeAmountForCandidate(
  candidate: AssetPathToTarget,
  need: AssetId,
  overrides?: Partial<Record<AssetId, bigint>>,
): bigint {
  const directOverride = overrides?.[candidate.source];
  if (directOverride && directOverride > 0n) return directOverride;

  const needOverride = overrides?.[need];
  if (needOverride && needOverride > 0n) {
    if (candidate.source === need) return needOverride;
    return convertAmountBetweenAssets(needOverride, need, candidate.source);
  }

  return defaultProbeAmount(candidate.source);
}

function defaultProbeAmount(asset: AssetId): bigint {
  const decimals = assetDecimals(asset);
  if (decimals <= 0) return 1n;
  try {
    const scale = 10n ** BigInt(decimals);
    return scale;
  } catch {
    return 1n;
  }
}

function selectStepsForKind(
  plan: LegPreparationPlan,
  kind: LegSegmentKind,
): StepPreparation[] {
  if (kind === "open") return plan.open;
  if (kind === "close_native") return plan.close.native;
  if (kind === "close_cex") return plan.close.cex ?? [];
  return [];
}

function convertAmountBetweenAssets(amount: bigint, from: AssetId, to: AssetId): bigint {
  if (from === to) return amount;
  const fromDecimals = assetDecimals(from);
  const toDecimals = assetDecimals(to);
  const diff = toDecimals - fromDecimals;
  if (diff === 0) return amount;
  if (diff > 0) {
    return amount * 10n ** BigInt(diff);
  }
  const divisor = 10n ** BigInt(-diff);
  if (divisor === 0n) return amount;
  return amount / divisor;
}

function adjustDirectInventoryStatus(
  candidate: QuoterAwareCandidate,
  need: AssetId,
  inventoryBalances?: InventoryBalances,
) {
  if (!inventoryBalances) return;
  if (candidate.path.steps.length > 0) return;

  const available = inventoryBalances[need];
  if (available == null) return;

  const required = amountToDecimal(candidate.amountIn, need);
  if (!Number.isFinite(required)) return;

  if (available < required) {
    candidate.evaluation.inventory = {
      status: "short",
      shortfalls: [
        {
          asset: need,
          shortfall: required - available,
          startingBalance: available,
          endingBalance: available - required,
        },
      ],
    };
  } else {
    candidate.evaluation.inventory = {
      status: "prepped",
      shortfalls: [],
    };
  }
}

function amountToDecimal(amount: bigint, asset: AssetId): number {
  const decimals = assetDecimals(asset);
  const scale = 10n ** BigInt(decimals);
  return Number(amount) / Number(scale);
}
