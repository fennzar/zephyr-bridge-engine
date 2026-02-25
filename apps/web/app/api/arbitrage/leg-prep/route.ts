import { NextRequest, NextResponse } from "next/server";

import { buildGlobalState } from "@domain/state/state.builder";
import { loadInventoryBalances } from "@domain/pathing";
import {
  buildQuoterAwareSegmentPreparation,
  type QuoterAwareCandidate,
} from "@domain/pathing/arb";
import {
  decodeLegSegmentKey,
  listSegmentsFor,
  type ArbLegs,
  type ArbDirection,
  type LegSegmentKind,
} from "@domain/arbitrage/routing";
import type { AssetId } from "@domain/types";
import { assetDecimals } from "@domain/assets/decimals";
import { parseDecimalToUnits } from "@/app/quoters/quoteHelpers";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface LegPrepResponse {
  generatedAt: string;
  asset: ArbLegs["asset"];
  direction: ArbDirection;
  kind: LegSegmentKind;
  stepIndex: number;
  need: AssetId;
  candidate: SerializedCandidate | null;
  error?: string;
}

interface SerializedCandidate {
  source: AssetId;
  amountIn: string;
  path: QuoterAwareCandidate["path"];
  evaluation: JsonValue;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const assetParam = params.get("asset");
  const directionParam = params.get("direction");
  const legParam = params.get("leg");

  if (!assetParam || !directionParam || !legParam) {
    return NextResponse.json({ error: "asset, direction, and leg are required" }, { status: 400 });
  }

  const asset = assetParam as ArbLegs["asset"];
  const direction = directionParam as ArbDirection;

  const decodedLeg = decodeLegSegmentKey(legParam);
  if (!decodedLeg) {
    return NextResponse.json({ error: "Invalid leg parameter" }, { status: 400 });
  }

  const segments = listSegmentsFor(asset, direction);
  const targetSegment = segments.find(
    (segment) => segment.kind === decodedLeg.kind && segment.index === decodedLeg.index,
  );

  if (!targetSegment) {
    return NextResponse.json({ error: "Leg segment not found for asset/direction" }, { status: 404 });
  }

  const amountOverride = parseAmountOverride(params, targetSegment.step.from as AssetId);
  if ("error" in amountOverride) {
    return NextResponse.json({ error: amountOverride.error }, { status: 400 });
  }

  const { value: maxDepth, error: depthError } = parsePositiveInt(params.get("maxDepth"), "maxDepth");
  if (depthError) {
    return NextResponse.json({ error: depthError }, { status: 400 });
  }

  const { value: pathLimit, error: limitError } = parsePositiveInt(params.get("pathLimit"), "pathLimit");
  if (limitError) {
    return NextResponse.json({ error: limitError }, { status: 400 });
  }

  try {
    const [state, inventoryBalances] = await Promise.all([buildGlobalState(), loadInventoryBalances()]);
    const plan = await buildQuoterAwareSegmentPreparation(
      {
        asset,
        direction,
        kind: decodedLeg.kind,
        stepIndex: decodedLeg.index,
      },
      state,
      {
        maxDepth,
        pathLimit,
        amountOverrides: amountOverride.value,
        inventoryBalances,
      },
    );

    const candidate = plan.step.candidates[0] ?? null;

    const payload: LegPrepResponse = {
      generatedAt: new Date().toISOString(),
      asset: plan.asset,
      direction: plan.direction,
      kind: plan.kind,
      stepIndex: plan.stepIndex,
      need: plan.step.need,
      candidate: candidate ? serializeCandidate(candidate) : null,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to evaluate leg preparation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseAmountOverride(params: URLSearchParams, need: AssetId):
  | { value?: Partial<Record<AssetId, bigint>> }
  | { error: string } {
  const amountWei = params.get("amountWei");
  if (amountWei) {
    try {
      const parsed = BigInt(amountWei);
      return parsed > 0n ? { value: { [need]: parsed } } : { error: "amountWei must be greater than zero" };
    } catch {
      return { error: "amountWei must be an integer string" };
    }
  }

  const amountParam = params.get("amount");
  if (!amountParam) return {};

  const decimals = assetDecimals(need);
  const parsed = parseDecimalToUnits(amountParam, decimals);
  if (!parsed.ok) {
    return { error: parsed.error };
  }
  if (parsed.value <= 0n) {
    return { error: "amount must be greater than zero" };
  }
  return { value: { [need]: parsed.value } };
}

function parsePositiveInt(value: string | null, label: string): { value?: number; error?: string } {
  if (!value) return {};
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${label} must be a positive integer` };
  }
  return { value: parsed };
}

function serializeCandidate(candidate: QuoterAwareCandidate): SerializedCandidate {
  return {
    source: candidate.source,
    amountIn: candidate.amountIn.toString(),
    path: candidate.path,
    evaluation: serializeValue(candidate.evaluation),
  };
}

function serializeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = serializeValue(entry);
    }
    return result;
  }
  return null;
}
