import { type NextRequest } from "next/server";

import type { AssetId, OpType } from "@domain/types";
import { buildGlobalState } from "@domain/state/state.builder";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import { sanitizeRuntimeContext, type RuntimeContext } from "../../shared/runtimeUtils";

import {
  RUNTIME_ASSETS,
  RUNTIME_OPERATION_CHOICES,
  RUNTIME_OPERATIONS,
  RUNTIME_OPERATIONS_MATRIX,
} from "../../runtime/config";
import { operationsToAsset, type OperationSelection } from "../../shared/operations";
import { jsonResponse } from "../../shared/json";

type SearchParams = Record<string, string | string[] | undefined>;

const ASSETS = RUNTIME_ASSETS;
const OPERATIONS = RUNTIME_OPERATIONS;
const OPERATION_CHOICES = RUNTIME_OPERATION_CHOICES;
const OPERATIONS_MATRIX = RUNTIME_OPERATIONS_MATRIX;

function normalizeParam(value: string | string[] | null): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isAssetId(value: string | null): value is AssetId {
  return value != null && (ASSETS as string[]).includes(value);
}

function isOpType(value: string | null): value is OpType {
  return value != null && (OPERATIONS as string[]).includes(value);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries()) as SearchParams;

  const opParam = normalizeParam(params.op ?? null);
  const fromParam = normalizeParam(params.from ?? null);
  const toParam = normalizeParam(params.to ?? null);

  const selectedOperation: OperationSelection = opParam === "auto" ? "auto" : isOpType(opParam) ? opParam : "auto";
  const selectedFrom: AssetId | null = isAssetId(fromParam) ? fromParam : null;
  const toCandidate: AssetId | null = isAssetId(toParam) ? toParam : null;
  const selectedTo: AssetId | null = (() => {
    if (!selectedFrom || !toCandidate) return null;
    const ops = operationsToAsset(OPERATIONS_MATRIX, selectedFrom, toCandidate);
    if (ops.length === 0) return null;
    if (selectedOperation === "auto") return toCandidate;
    return ops.includes(selectedOperation) ? toCandidate : null;
  })();

  const impliedOps = selectedFrom && selectedTo ? operationsToAsset(OPERATIONS_MATRIX, selectedFrom, selectedTo) : [];
  const effectiveOp: OpType | null = selectedOperation === "auto" ? impliedOps[0] ?? null : selectedOperation;

  const selection = {
    requested: {
      op: opParam ?? "auto",
      from: fromParam,
      to: toParam,
    },
    resolved: {
      operation: selectedOperation,
      effectiveOperation: effectiveOp,
      from: selectedFrom,
      to: selectedTo,
    },
  };

  if (!selectedFrom) {
    return jsonResponse(
      {
        selection,
        error: "Invalid or missing `from` asset.",
        allowed: { assets: ASSETS, operations: OPERATION_CHOICES },
      },
      { status: 400 },
    );
  }

  if (!selectedTo) {
    return jsonResponse(
      {
        selection,
        error: "Invalid or unsupported `to` asset for the selected operation.",
        allowed: { assets: ASSETS, operations: OPERATION_CHOICES },
      },
      { status: 400 },
    );
  }

  if (!effectiveOp) {
    return jsonResponse(
      {
        selection,
        error: "No runtime available for the provided `from` / `to` combination.",
      },
      { status: 404 },
    );
  }

  const runtimeEntry = OP_RUNTIME[effectiveOp] as OperationRuntime<RuntimeContext> | undefined;
  if (!runtimeEntry) {
    return jsonResponse(
      {
        selection,
        error: `Runtime ${effectiveOp} is not registered.`,
      },
      { status: 501 },
    );
  }

  const state = await buildGlobalState();

  let enabled: boolean | null = null;
  let context: RuntimeContext | null = null;

  try {
    enabled = runtimeEntry.enabled(selectedFrom, selectedTo, state);
    context = runtimeEntry.buildContext(selectedFrom, selectedTo, state);
  } catch (error) {
    return jsonResponse(
      {
        selection,
        error: (error as Error).message ?? "Runtime threw an unexpected error.",
      },
      { status: 500 },
    );
  }

  const sanitizedContext = sanitizeRuntimeContext(effectiveOp, context);

  return jsonResponse({
    timestamp: new Date().toISOString(),
    selection,
    runtime: {
      operation: effectiveOp,
      enabled,
      context: sanitizedContext,
    },
  });
}
