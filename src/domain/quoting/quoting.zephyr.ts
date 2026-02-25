import type { GlobalState } from "@domain/state/types";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
import type { OperationQuoteRequest, OperationQuoteResponse } from "./types";
import { RATE_SCALE, applyBps, mulDiv } from "@shared/math";
import { computeNativeNetworkEffect } from "./networkEffect";

type NativeOp = Extract<OperationQuoteRequest["op"], "nativeMint" | "nativeRedeem">;

const NATIVE_OPS: ReadonlySet<NativeOp> = new Set(["nativeMint", "nativeRedeem"]);

export function quoteNativeOperation(
  request: OperationQuoteRequest,
  state: GlobalState,
  options?: { bypassAvailability?: boolean },
): OperationQuoteResponse | null {
  if (!NATIVE_OPS.has(request.op as NativeOp)) return null;

  const runtime = getNativeRuntime(request.op as NativeOp);
  if (!runtime) return null;

  const enabled = runtime.enabled(request.from, request.to, state);

  const context = runtime.buildContext(request.from, request.to, state);
  if (!context) return null;

  if (!enabled && !options?.bypassAvailability) return null;

  return buildNativeQuote(request, context, state, enabled);
}

function getNativeRuntime(op: NativeOp): OperationRuntime<NativeOperationContext> | undefined {
  switch (op) {
    case "nativeMint":
      return OP_RUNTIME.nativeMint as OperationRuntime<NativeOperationContext> | undefined;
    case "nativeRedeem":
      return OP_RUNTIME.nativeRedeem as OperationRuntime<NativeOperationContext> | undefined;
    default:
      return undefined;
  }
}

const BPS_SCALE = 10_000n;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function buildNativeQuote(
  request: OperationQuoteRequest,
  context: NativeOperationContext,
  state: GlobalState,
  runtimeEnabled: boolean,
): OperationQuoteResponse | null {
  const warnings: string[] = [];

  if (context.rate <= 0n) {
    warnings.push("rate<=0");
    return createNativeResponse(request, 0n, 0n, warnings);
  }

  let grossOut: bigint | null = null;
  let netOut: bigint | null = null;
  let amountInUsed: bigint | null = null;
  let feePaid: bigint | null = null;

  const amountIn = request.amountIn ?? null;
  const amountOutTarget = request.amountOut ?? null;

  const feeBps = BigInt(Math.max(0, Math.min(10_000, Math.floor(context.feeBps))));
  if (feeBps >= BPS_SCALE) {
    warnings.push("fee configuration invalid");
    return createNativeResponse(request, 0n, 0n, warnings);
  }

  if (amountIn != null && amountIn > 0n) {
    amountInUsed = amountIn;
    grossOut =
      context.kind === "mint"
        ? mulDiv(amountIn, RATE_SCALE, context.rate)
        : mulDiv(amountIn, context.rate, RATE_SCALE);
    if (grossOut <= 0n) {
      warnings.push("conversion produced zero output");
      return createNativeResponse(request, 0n, 0n, warnings);
    }
    netOut = applyBps(grossOut, context.feeBps);
    feePaid = grossOut - netOut;
  } else if (amountOutTarget != null && amountOutTarget > 0n) {
    if (context.kind === "mint") {
      const netOutTarget = amountOutTarget;
      const grossRequired = ceilDiv(netOutTarget * BPS_SCALE, BPS_SCALE - feeBps);
      const amountInRequired = ceilDiv(grossRequired * context.rate, RATE_SCALE);
      amountInUsed = amountInRequired;
      grossOut = grossRequired;
      netOut = netOutTarget;
      feePaid = grossRequired - netOutTarget;
    } else {
      const netOutTarget = amountOutTarget;
      const grossRequired = ceilDiv(netOutTarget * BPS_SCALE, BPS_SCALE - feeBps);
      const amountInRequired = ceilDiv(grossRequired * RATE_SCALE, context.rate);
      amountInUsed = amountInRequired;
      grossOut = grossRequired;
      netOut = netOutTarget;
      feePaid = grossRequired - netOutTarget;
    }
  } else {
    warnings.push("amountIn or amountOut is required and must be positive");
    return createNativeResponse(request, 0n, 0n, warnings);
  }

  if (amountInUsed != null && amountInUsed <= 0n) {
    warnings.push("amountIn<=0");
    return createNativeResponse(request, 0n, 0n, warnings);
  }

  if (grossOut == null || netOut == null || netOut <= 0n) {
    warnings.push("conversion produced zero output");
    return createNativeResponse(request, 0n, 0n, warnings);
  }

  if (context.reserveRatio != null && Number.isFinite(context.reserveRatio) && context.reserveRatio < 4) {
    warnings.push(`reserve ratio ≈${context.reserveRatio.toFixed(2)}x (<4x)`);
  }

  const normalizedRequest: OperationQuoteRequest = {
    ...request,
    amountIn: amountInUsed ?? undefined,
    amountOut: amountOutTarget ?? undefined,
  };

  const response = createNativeResponse(normalizedRequest, netOut, feePaid ?? 0n, warnings, grossOut);
  const { effect, allowed, reasons } = computeNativeNetworkEffect(normalizedRequest, response, context, state);
  const combinedAllowed = runtimeEnabled && allowed;
  const combinedReasons = [] as string[];
  if (!runtimeEnabled) {
    combinedReasons.push("Runtime policy currently disables this conversion");
  }
  if (!allowed) {
    combinedReasons.push(...reasons);
  }

  response.networkEffect = effect ?? undefined;
  response.policy = {
    native: {
      allowed: combinedAllowed,
      reasons: combinedReasons.length > 0 ? combinedReasons : undefined,
    },
  };
  return response;
}

function createNativeResponse(
  request: OperationQuoteRequest,
  amountOut: bigint,
  feePaid: bigint,
  notes: string[],
  grossAmountOut?: bigint,
): OperationQuoteResponse {
  const uniqueNotes = notes.length > 0 ? Array.from(new Set(notes)) : undefined;
  const hasGross = grossAmountOut != null && grossAmountOut > 0n;
  return {
    request,
    grossAmountOut: hasGross ? grossAmountOut : undefined,
    amountOut,
    feePaid: feePaid > 0n ? feePaid : undefined,
    feeAsset: "to",
    warnings: uniqueNotes,
  };
}
