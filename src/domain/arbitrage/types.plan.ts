import type { AssetId } from "@domain/types";
import type { ArbDirection, ArbLegs, LegSegmentKind } from "./routing";
import type { ClipOption } from "./clip.types";
import type { QuoterAwareLegPreparationPlan, QuoterAwareCandidate } from "@domain/pathing/arb";
import type { PathEvaluation } from "@domain/pathing";

export type ArbPlanStage = "inventory" | "preparation" | "execution" | "settlement" | "realisation";

export interface ArbPlanStep {
  id: string;
  stage: ArbPlanStage;
  label: string;
  description?: string;
  asset?: AssetId;
  amountIn?: bigint;
  leg?: ArbLegs;
  preparation?: QuoterAwareLegPreparationPlan;
  path?: PathEvaluation;
  notes?: string[];
  blocked?: boolean;
  flavor?: "native" | "cex" | "bridge";
  inventoryDetails?: InventoryRequirement[];
  skip?: boolean;
  prepSegment?: { kind: LegSegmentKind; index: number };
}

export interface ArbPlanSummary {
  estimatedProfitUsd?: number | null;
  estimatedCostUsd?: number | null;
  inventoryLimited?: boolean;
  notes: string[];
  blocked?: boolean;
  closeFlavor?: "native" | "cex" | null;
  clipAsset?: AssetId;
  clipAmount?: bigint | null;
  clipAmountDecimal?: number | null;
  clipAmountUsd?: number | null;
  clipOption?: ClipOption | null;
  clipOptions?: ClipOption[] | null;
  clipScenarioError?: string | null;
}

export interface ArbPlan {
  asset: ArbLegs["asset"];
  direction: ArbDirection;
  stages: Record<ArbPlanStage, ArbPlanStep[]>;
  summary: ArbPlanSummary;
  view?: ArbPlanView | null;
}

export interface ArbPlannerOptions {
  amountOverride?: bigint;
  maxDepth?: number;
  pathLimit?: number;
}

export interface ArbPlanContext {
  legs: ArbLegs[];
}

export interface InventoryRequirement {
  asset: AssetId;
  required: number;
  available: number | null;
  remaining: number | null;
  ok: boolean;
  label?: string;
}

export interface ArbPlanView {
  clipOptions: ArbPlanViewClipOption[];
}

export interface ArbPlanViewClipOption {
  option: ClipOption;
  prep: {
    open: ArbPlanLegPrepView | null;
    close: ArbPlanLegPrepView | null;
  };
}

export interface ArbPlanLegPrepView {
  need: AssetId | null;
  amountIn?: bigint | null;
  candidate: QuoterAwareCandidate | null;
  evaluation: PathEvaluation | null;
  candidates: QuoterAwareCandidate[];
}
