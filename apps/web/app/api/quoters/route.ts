import { type NextRequest } from "next/server";

import type { AssetId, OpType } from "@domain/types";
import { buildGlobalState } from "@domain/state/state.builder";
import type { OperationQuoteRequest, OperationQuoteResponse } from "@domain/quoting/types";
import { quoteSwapOnchain, type OnchainSwapQuote } from "@domain/quoting/quoting.onchain.swap";
import { quoteSwapState } from "@domain/quoting/quoting.state.swap";
import { quoteNativeOperation } from "@domain/quoting/quoting.zephyr";
import { quoteCexTrade } from "@domain/quoting/quoting.cex";
import { quoteBridgeOperation } from "@domain/quoting/quoting.bridge";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";

import {
  QUOTER_ASSETS,
  QUOTER_OPERATION_CHOICES,
  QUOTER_OPERATIONS_MATRIX,
  QUOTER_SUPPORTED_OPS,
} from "../../quoters/config";
import { buildQuoteDisplay, parseDecimalToUnits } from "../../quoters/quoteHelpers";
import { deriveRateDisplays, isSwapContext, type RuntimeContext } from "../../quoters/rateHelpers";
import { operationsToAsset, type OperationSelection } from "../../shared/operations";
import { jsonResponse } from "../../shared/json";
import { getAssetDecimals } from "../../shared/assetMetadata";

type SearchParams = Record<string, string | string[] | undefined>;

const ASSETS = QUOTER_ASSETS;
const SUPPORTED_OPS = QUOTER_SUPPORTED_OPS;
const OPERATION_CHOICES = QUOTER_OPERATION_CHOICES;
const OPERATIONS_MATRIX = QUOTER_OPERATIONS_MATRIX;

function normalizeParam(value: string | string[] | null): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isAssetId(value: string | null): value is AssetId {
  return value != null && (ASSETS as string[]).includes(value);
}

function resolveDecimals(
  op: OpType,
  context: RuntimeContext,
  from: AssetId,
  to: AssetId,
): { from: number; to: number | undefined } {
  if (op === "swapEVM" && isSwapContext(context)) {
    const fromDecimals =
      context.direction === "baseToQuote" ? context.pool.baseDecimals : context.pool.quoteDecimals;
    const toDecimals =
      context.direction === "baseToQuote" ? context.pool.quoteDecimals : context.pool.baseDecimals;
    return { from: fromDecimals, to: toDecimals };
  }

  if ((op === "wrap" || op === "unwrap") && context && typeof context === "object" && "fromDecimals" in context) {
    const bridge = context as BridgeOperationContext;
    return {
      from: bridge.fromDecimals,
      to: bridge.toDecimals,
    };
  }

  return {
    from: getAssetDecimals(from),
    to: getAssetDecimals(to),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries()) as SearchParams;

  const opParam = normalizeParam(params.op ?? null);
  const fromParam = normalizeParam(params.from ?? null);
  const toParam = normalizeParam(params.to ?? null);
  const amountParam = normalizeParam(params.amount ?? null);
  const amountOutParam = normalizeParam(params.amountOut ?? null);
  const sideParam = normalizeParam(params.side ?? null);

  const amountMode: "in" | "out" = sideParam === "out" || (!amountParam && amountOutParam) ? "out" : "in";
  const primaryAmountParam = amountMode === "in" ? amountParam : amountOutParam ?? amountParam;

  const selectedOperation: OperationSelection =
    opParam === "auto" ? "auto" : SUPPORTED_OPS.includes(opParam as OpType) ? (opParam as OpType) : "auto";
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
      amount: primaryAmountParam,
      side: amountMode,
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
        error: "No supported operation for the provided asset pair.",
      },
      { status: 404 },
    );
  }

  if (!SUPPORTED_OPS.includes(effectiveOp)) {
    return jsonResponse(
      {
        selection,
        error: `Operation ${effectiveOp} is not supported by the quoter.`,
      },
      { status: 400 },
    );
  }

  if (!primaryAmountParam) {
    return jsonResponse(
      {
        selection,
        error:
          amountMode === "in"
            ? "Query parameter `amount` is required."
            : "Specify `amountOut` (or `amount` with side=out) for exact-out quotes.",
      },
      { status: 400 },
    );
  }

  const state = await buildGlobalState();
  const runtimeEntry = OP_RUNTIME[effectiveOp] as OperationRuntime<RuntimeContext> | undefined;
  if (!runtimeEntry) {
    return jsonResponse(
      {
        selection,
        error: `Runtime ${effectiveOp} is not registered.`,
      },
      { status: 503 },
    );
  }

  let runtimeEnabled: boolean | null = null;
  let runtimeContext: RuntimeContext | null = null;

  try {
    runtimeEnabled = runtimeEntry.enabled(selectedFrom, selectedTo, state);
    runtimeContext = runtimeEntry.buildContext(selectedFrom, selectedTo, state);
  } catch (error) {
    return jsonResponse(
      {
        selection,
        error: (error as Error).message ?? "Runtime threw an unexpected error.",
      },
      { status: 500 },
    );
  }

  if (!runtimeContext) {
    const workerHint = effectiveOp === "swapEVM"
      ? " Is the EVM watcher running?"
      : effectiveOp === "tradeCEX"
        ? " Is the CEX watcher running?"
        : "";
    return jsonResponse(
      {
        selection,
        runtime: { enabled: runtimeEnabled, context: runtimeContext },
        error: `${effectiveOp} runtime is unavailable for the provided assets.${workerHint}`,
      },
      { status: 502 },
    );
  }

  const { from: fromDecimals, to: toDecimals } = resolveDecimals(effectiveOp, runtimeContext, selectedFrom, selectedTo);

  const parseDecimals = amountMode === "in" ? fromDecimals : toDecimals ?? fromDecimals;
  if (parseDecimals == null) {
    return jsonResponse(
      {
        selection,
        runtime: { enabled: runtimeEnabled, context: runtimeContext },
        error: "Decimal metadata unavailable for the selected pair.",
      },
      { status: 400 },
    );
  }

  const parsedAmount = parseDecimalToUnits(primaryAmountParam, parseDecimals);
  if (!parsedAmount.ok) {
    return jsonResponse(
      {
        selection,
        runtime: { enabled: runtimeEnabled, context: runtimeContext },
        error: parsedAmount.error,
      },
      { status: 400 },
    );
  }

  const quoteRequest: OperationQuoteRequest = {
    op: effectiveOp,
    from: selectedFrom,
    to: selectedTo,
  };

  let amountInUnits: bigint | null = null;
  let amountOutUnits: bigint | null = null;
  if (amountMode === "in") {
    amountInUnits = parsedAmount.value;
    quoteRequest.amountIn = amountInUnits;
  } else {
    amountOutUnits = parsedAmount.value;
    quoteRequest.amountOut = amountOutUnits;
  }

  let quoteResponse: OperationQuoteResponse | null = null;
  let onchainQuote: OnchainSwapQuote | null = null;
  let zeroForOne: boolean | undefined;
  let quoteError: string | null = null;

  if (effectiveOp === "swapEVM") {
    if (amountMode === "in") {
      try {
        onchainQuote = await quoteSwapOnchain(quoteRequest, state);
        if (onchainQuote) {
          quoteResponse = {
            request: quoteRequest,
            amountOut: onchainQuote.amountOut,
            estGasWei: onchainQuote.estGasWei,
            warnings: onchainQuote.warnings,
            poolImpact: onchainQuote.poolImpact,
          };
          zeroForOne = onchainQuote.zeroForOne;
        }
      } catch (error) {
        quoteError = (error as Error).message ?? "On-chain quoter error";
      }
    }

    if (!quoteResponse) {
      const stateQuote = quoteSwapState(quoteRequest, state);
      if (stateQuote) {
        quoteResponse = stateQuote;
      } else if (!quoteError) {
        quoteError = "State quoter returned null for the provided request.";
      }
    }
  } else if (effectiveOp === "tradeCEX") {
    const cexContext =
      runtimeContext &&
      typeof runtimeContext === "object" &&
      "direction" in runtimeContext &&
      (runtimeContext as CexOperationContext).direction === "tradeCEX"
        ? (runtimeContext as CexOperationContext)
        : null;
    quoteResponse = quoteCexTrade(quoteRequest, state, cexContext);
    if (!quoteResponse) {
      quoteError = "CEX trade quoter returned null for the provided request.";
    }
  } else if (effectiveOp === "wrap" || effectiveOp === "unwrap") {
    const bridgeContext =
      runtimeContext &&
      typeof runtimeContext === "object" &&
      "direction" in runtimeContext &&
      (runtimeContext as BridgeOperationContext).direction === effectiveOp
        ? (runtimeContext as BridgeOperationContext)
        : null;
    quoteResponse = quoteBridgeOperation(quoteRequest, state, bridgeContext);
    if (!quoteResponse) {
      quoteError = "Bridge quoter returned null for the provided request.";
    }
  } else {
    quoteResponse = quoteNativeOperation(quoteRequest, state, { bypassAvailability: true });
    if (!quoteResponse) {
      quoteError = "Native quoter returned null for the provided request.";
    }
  }

  const rateDisplays = deriveRateDisplays(
    effectiveOp,
    runtimeContext,
    selectedFrom,
    selectedTo,
    state.zephyr.reserve,
  );

  if (!quoteResponse) {
    return jsonResponse(
      {
        selection,
        runtime: { enabled: runtimeEnabled, context: runtimeContext },
        amount: {
          mode: amountMode,
          input: primaryAmountParam,
          parsed: parsedAmount.value.toString(),
          decimals: parseDecimals,
        },
        quote: null,
        error: quoteError ?? "Quoter returned null for the provided request.",
      },
      { status: quoteError ? 500 : 200 },
    );
  }

  const display = buildQuoteDisplay({
    quote: quoteResponse,
    fromDecimals,
    toDecimals,
    rates: rateDisplays.length > 0 ? rateDisplays : undefined,
  });

  return jsonResponse({
    timestamp: new Date().toISOString(),
    selection,
    runtime: { enabled: runtimeEnabled, context: runtimeContext },
    amount: {
      mode: amountMode,
      input: primaryAmountParam,
      parsed: parsedAmount.value.toString(),
      decimals: parseDecimals,
    },
    quote: display,
    rawQuote: {
      grossAmountOut: quoteResponse.grossAmountOut,
      amountOut: quoteResponse.amountOut,
      feePaid: quoteResponse.feePaid,
      feeAsset: quoteResponse.feeAsset,
      estGasWei: quoteResponse.estGasWei,
      warnings: quoteResponse.warnings,
      networkEffect: quoteResponse.networkEffect ?? null,
      policy: quoteResponse.policy ?? null,
      poolImpact: quoteResponse.poolImpact ?? null,
      cexImpact: quoteResponse.cexImpact ?? null,
    },
    metadata: {
      operation: effectiveOp,
      zeroForOne,
      rates: rateDisplays,
      networkEffect: quoteResponse.networkEffect ?? null,
      policy: quoteResponse.policy ?? null,
      poolImpact: quoteResponse.poolImpact ?? null,
      cexImpact: quoteResponse.cexImpact ?? null,
    },
    poolImpact: quoteResponse.poolImpact ?? null,
    cexImpact: quoteResponse.cexImpact ?? null,
    error: quoteError ?? undefined,
  });
}
