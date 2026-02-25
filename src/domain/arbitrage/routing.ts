import { findPathsToAsset, type AssetPathToTarget } from "@domain/inventory/graph";
import type { AssetId, OpType } from "@domain/types";

/////////////////////////
// Arb Legs (Open/Close)
/////////////////////////

/**
 * Leg semantics:
 * - open: always an EVM swap that creates exposure in the mispriced wrapped asset.
 * - close (native): the minimal native conversion that neutralizes exposure per pair.
 * - close (cex): only relevant for WZEPH (optional).
 *
 * Steps list uses semantic hops between "economy" nodes;
 * helper `materializeLeg` will insert implied wrap/unwrap/deposit/withdraw as needed.
 */
export type ArbDirection = "evm_discount" | "evm_premium";
export type CloseFlavor = "native" | "cex";

export interface SemanticStep {
  from: AssetId;
  to: AssetId;
  op: OpType[];
}

export interface ArbLegs {
  asset: "ZEPH" | "ZSD" | "ZRS" | "ZYS";
  direction: ArbDirection;
  open: SemanticStep[]; // EVM swap step(s)
  close: { native: SemanticStep[]; cex?: SemanticStep[] }; // close variants
}

export interface StepPreparation {
  step: SemanticStep;
  need: AssetId;
  candidates: AssetPathToTarget[];
}

export interface ClosePreparation {
  native: StepPreparation[];
  cex?: StepPreparation[];
}

export interface LegPreparationPlan {
  asset: ArbLegs["asset"];
  direction: ArbDirection;
  open: StepPreparation[];
  close: ClosePreparation;
}

export type LegSegmentKind = "open" | "close_native" | "close_cex";

export interface ArbLegSegment {
  asset: ArbLegs["asset"];
  direction: ArbDirection;
  kind: LegSegmentKind;
  index: number;
  step: SemanticStep;
}

export interface PreparationOptions {
  maxDepth?: number;
}

type EdgeSignature = `${AssetId}::${OpType}::${AssetId}`;

export const ARB_DEFS: ArbLegs[] = [
  // -----------------------
  // WZEPH
  // -----------------------
  {
    asset: "ZEPH",
    direction: "evm_discount",
    open: [{ from: "WZSD.e", to: "WZEPH.e", op: ["swapEVM"] }],
    close: {
      native: [{ from: "ZEPH.n", to: "ZSD.n", op: ["nativeMint"] }],
      cex: [{ from: "ZEPH.x", to: "USDT.x", op: ["tradeCEX"] }],
    },
  },
  {
    asset: "ZEPH",
    direction: "evm_premium",
    open: [{ from: "WZEPH.e", to: "WZSD.e", op: ["swapEVM"] }],
    close: {
      native: [{ from: "ZSD.n", to: "ZEPH.n", op: ["nativeRedeem"] }],
      cex: [{ from: "USDT.x", to: "ZEPH.x", op: ["tradeCEX"] }],
    },
  },

  // -----------------------
  // WZSD (vs USDT on EVM)
  // -----------------------
  {
    asset: "ZSD",
    direction: "evm_discount",
    open: [{ from: "USDT.e", to: "WZSD.e", op: ["swapEVM"] }],
    close: { native: [{ from: "WZSD.e", to: "ZSD.n", op: ["unwrap"] }] },
  },
  {
    asset: "ZSD",
    direction: "evm_premium",
    open: [{ from: "WZSD.e", to: "USDT.e", op: ["swapEVM"] }],
    // close here is "replenish ZSD", pick one based on inventory policy
    close: {
      native: [
        // You can pick either of these in execution-time policy:
        { from: "ZEPH.n", to: "ZSD.n", op: ["nativeMint"] },
        // or { from:'ZYS.n',  to:'ZSD.n', op:['nativeRedeem'] },
      ],
    },
  },

  // -----------------------
  // WZRS (paired with WZEPH on EVM) – Close is native only
  // -----------------------
  {
    asset: "ZRS",
    direction: "evm_discount",
    open: [{ from: "WZEPH.e", to: "WZRS.e", op: ["swapEVM"] }],
    close: { native: [{ from: "ZRS.n", to: "ZEPH.n", op: ["nativeRedeem"] }] },
  },
  {
    asset: "ZRS",
    direction: "evm_premium",
    open: [{ from: "WZRS.e", to: "WZEPH.e", op: ["swapEVM"] }],
    close: { native: [{ from: "ZEPH.n", to: "ZRS.n", op: ["nativeRedeem"] }] },
  },

  // -----------------------
  // WZYS (paired with WZSD on EVM) – Close is native only
  // -----------------------
  {
    asset: "ZYS",
    direction: "evm_discount",
    open: [{ from: "WZSD.e", to: "WZYS.e", op: ["swapEVM"] }],
    close: { native: [{ from: "ZYS.n", to: "ZSD.n", op: ["nativeRedeem"] }] },
  },
  {
    asset: "ZYS",
    direction: "evm_premium",
    open: [{ from: "WZYS.e", to: "WZSD.e", op: ["swapEVM"] }],
    close: { native: [{ from: "ZSD.n", to: "ZYS.n", op: ["nativeMint"] }] },
  },
];

function buildForbiddenEdges(leg: ArbLegs): Set<EdgeSignature> {
  const signatures = new Set<EdgeSignature>();

  const addStep = (step: SemanticStep) => {
    for (const op of step.op) {
      signatures.add(`${step.from}::${op}::${step.to}`);
      signatures.add(`${step.to}::${op}::${step.from}`);
    }
  };

  for (const step of leg.open) addStep(step);
  for (const step of leg.close.native) addStep(step);
  if (leg.close.cex) {
    for (const step of leg.close.cex) addStep(step);
  }

  return signatures;
}

function buildStepPreparations(
  steps: SemanticStep[],
  forbidden: Set<EdgeSignature>,
  options?: PreparationOptions,
): StepPreparation[] {
  const maxDepth = options?.maxDepth;
  return steps.map((step) => ({
    step,
    need: step.from,
    candidates: findPathsToAsset(step.from, maxDepth).filter(({ path }) =>
      path.steps.every((hop) => !forbidden.has(`${hop.from}::${hop.op}::${hop.to}`)),
    ),
  }));
}

export function buildLegPreparationPlan(leg: ArbLegs, options?: PreparationOptions): LegPreparationPlan {
  const forbidden = buildForbiddenEdges(leg);

  return {
    asset: leg.asset,
    direction: leg.direction,
    open: buildStepPreparations(leg.open, forbidden, options),
    close: {
      native: buildStepPreparations(leg.close.native, forbidden, options),
      ...(leg.close.cex ? { cex: buildStepPreparations(leg.close.cex, forbidden, options) } : {}),
    },
  };
}

export function buildAllPreparationPlans(options?: PreparationOptions): LegPreparationPlan[] {
  return ARB_DEFS.map((leg) => buildLegPreparationPlan(leg, options));
}

export function findArbLeg(asset: ArbLegs["asset"], direction: ArbDirection): ArbLegs | null {
  return ARB_DEFS.find((entry) => entry.asset === asset && entry.direction === direction) ?? null;
}

export function listLegSegments(leg: ArbLegs): ArbLegSegment[] {
  const segments: ArbLegSegment[] = [];
  leg.open.forEach((step, index) => {
    segments.push({ asset: leg.asset, direction: leg.direction, kind: "open", index, step });
  });
  leg.close.native.forEach((step, index) => {
    segments.push({ asset: leg.asset, direction: leg.direction, kind: "close_native", index, step });
  });
  (leg.close.cex ?? []).forEach((step, index) => {
    segments.push({ asset: leg.asset, direction: leg.direction, kind: "close_cex", index, step });
  });
  return segments;
}

export function listSegmentsFor(asset: ArbLegs["asset"], direction: ArbDirection): ArbLegSegment[] {
  const leg = findArbLeg(asset, direction);
  return leg ? listLegSegments(leg) : [];
}

export function encodeLegSegmentKey(kind: LegSegmentKind, index: number): string {
  return `${kind}:${index}`;
}

export function decodeLegSegmentKey(
  raw: string | null | undefined,
): { kind: LegSegmentKind; index: number } | null {
  if (!raw) return null;
  const [kind, idx] = raw.split(":");
  if (!kind || idx == null) return null;
  if (kind !== "open" && kind !== "close_native" && kind !== "close_cex") return null;
  const parsed = Number.parseInt(idx, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return { kind, index: parsed };
}
