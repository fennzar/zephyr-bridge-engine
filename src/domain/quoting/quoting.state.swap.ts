import type { GlobalState } from "@domain/state/types";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { OperationQuoteRequest, OperationQuoteResponse } from "./types";

const FEE_SCALE = 1_000_000n;

export function quoteSwapState(request: OperationQuoteRequest, state: GlobalState): OperationQuoteResponse | null {
  if (request.op !== "swapEVM") return null;

  const runtime = OP_RUNTIME.swapEVM as OperationRuntime<SwapEvmContext> | undefined;

  if (!runtime?.enabled(request.from, request.to, state)) return null;

  const context = runtime.buildContext(request.from, request.to, state);
  if (!context) return null;

  return buildSwapQuote(request, context);
}

function buildSwapQuote(request: OperationQuoteRequest, context: SwapEvmContext): OperationQuoteResponse {
  const hasAmountIn = request.amountIn != null && request.amountIn > 0n;
  const hasAmountOut = request.amountOut != null && request.amountOut > 0n;

  const notes: string[] = [];
  if (!hasAmountIn && !hasAmountOut) {
    notes.push("amountIn or amountOut is required");
    return createResponse(request, context, 0n, 0n, notes);
  }
  if (hasAmountIn && hasAmountOut) {
    notes.push("specify either amountIn or amountOut, not both");
    return createResponse(request, context, 0n, 0n, notes);
  }

  if (context.watcherStale) {
    notes.push("watcher data stale");
  }

  const mode: "exactIn" | "exactOut" = hasAmountOut ? "exactOut" : "exactIn";

  const feeBps = BigInt(Math.max(0, Math.min(1_000_000, context.pool.feeBps ?? 0)));
  const feeFactor = FEE_SCALE - feeBps;
  if (feeFactor <= 0n) {
    notes.push("fee configuration invalid");
    return createResponse(request, context, 0n, 0n, notes);
  }

  const fromDecimals = context.direction === "baseToQuote" ? context.pool.baseDecimals : context.pool.quoteDecimals;
  const toDecimals = context.direction === "baseToQuote" ? context.pool.quoteDecimals : context.pool.baseDecimals;

  let reserves = context.reserves;
  if (!reserves) {
    const fallback = computeReservesFromTotals(context);
    if (fallback) reserves = fallback;
  }

  const priceValue = context.direction === "baseToQuote" ? context.pool.price : context.pool.priceInverse;
  const priceQuoted = priceValue && Number.isFinite(priceValue) && priceValue > 0 ? (priceValue as number) : null;

  let amountInRequired: bigint | null = hasAmountIn ? request.amountIn ?? 0n : null;
  let amountInAfterFee: bigint | null = null;
  let feePaid: bigint = 0n;
  let amountOutResult: bigint | null = null;
  let usingReserves = false;
  let slipNote: string | null = null;

  if (mode === "exactIn") {
    amountInRequired = request.amountIn!;
    if (amountInRequired <= 0n) {
      return createResponse(request, context, 0n, 0n, ["amountIn<=0"]);
    }

    feePaid = (amountInRequired * feeBps) / FEE_SCALE;
    amountInAfterFee = amountInRequired - feePaid;
    if (amountInAfterFee <= 0n) {
      notes.push("trade exhausted by fees");
      return createResponse(request, context, 0n, feePaid, notes, amountInRequired);
    }

    if (reserves && reserves.reserveIn > 0n && reserves.reserveOut > 0n) {
      const denominator = reserves.reserveIn + amountInAfterFee;
      const amountOutFromReserves = denominator === 0n ? 0n : (amountInAfterFee * reserves.reserveOut) / denominator;
      if (amountOutFromReserves > 0n) {
        usingReserves = true;
        amountOutResult = amountOutFromReserves;
        const slipBps = computeSlipBps(amountInAfterFee, reserves.reserveIn);
        if (slipBps > 0n) slipNote = `slip≈${(Number(slipBps) / 100).toFixed(2)}%`;
        if (amountInAfterFee > reserves.reserveIn) notes.push("trade larger than available inventory");
      } else {
        notes.push("swap produced zero output");
      }
    }

    if (priceQuoted != null) {
      const amountOutFromPrice = computeAmountOutFromPrice(amountInAfterFee, priceQuoted, fromDecimals, toDecimals);

      if (amountOutResult == null && amountOutFromPrice != null) {
        notes.push("liquidity snapshot unavailable");
        amountOutResult = amountOutFromPrice;
        usingReserves = false;
        slipNote = null;
      } else if (amountOutResult != null && usingReserves) {
        const reservePrice = computeReservePrice(context.reserves ?? null, fromDecimals, toDecimals);
        if (reservePrice != null) {
          const divergence = Math.abs(reservePrice - priceQuoted) / priceQuoted;
          if (divergence > 0.05 && amountOutFromPrice != null && amountOutFromPrice > 0n) {
            notes.push(`reserves deviate from price≈${(divergence * 100).toFixed(2)}%`);
            amountOutResult = amountOutFromPrice;
            usingReserves = false;
            slipNote = null;
          }
        }
      }
    }
  } else {
    const targetOut = request.amountOut!;
    if (targetOut <= 0n) {
      return createResponse(request, context, 0n, 0n, ["amountOut<=0"]);
    }

    if (reserves && reserves.reserveIn > 0n && reserves.reserveOut > targetOut) {
      const denominator = reserves.reserveOut - targetOut;
      if (denominator <= 0n) {
        notes.push("requested output exceeds available liquidity");
      } else {
        let amountInAfterFeeCandidate = ceilDiv(targetOut * reserves.reserveIn, denominator);
        if (amountInAfterFeeCandidate <= 0n) {
          amountInAfterFeeCandidate = 1n;
        }
        let amountInCandidate = ceilDiv(amountInAfterFeeCandidate * FEE_SCALE, feeFactor);
        if (amountInCandidate <= 0n) amountInCandidate = 1n;

        let feeCandidate = (amountInCandidate * feeBps) / FEE_SCALE;
        let actualInAfterFee = amountInCandidate - feeCandidate;
        let actualOut = (actualInAfterFee * reserves.reserveOut) / (reserves.reserveIn + actualInAfterFee);

        while (actualOut < targetOut) {
          amountInCandidate += 1n;
          feeCandidate = (amountInCandidate * feeBps) / FEE_SCALE;
          actualInAfterFee = amountInCandidate - feeCandidate;
          actualOut = (actualInAfterFee * reserves.reserveOut) / (reserves.reserveIn + actualInAfterFee);
          if (amountInCandidate > reserves.reserveIn * 1000n) break;
        }

        if (actualOut >= targetOut) {
          usingReserves = true;
          amountInRequired = amountInCandidate;
          amountInAfterFee = actualInAfterFee;
          feePaid = feeCandidate;
          amountOutResult = actualOut;
          if (actualInAfterFee > reserves.reserveIn) notes.push("trade larger than available inventory");
          const slipBps = computeSlipBps(actualInAfterFee, reserves.reserveIn);
          if (slipBps > 0n) slipNote = `slip≈${(Number(slipBps) / 100).toFixed(2)}%`;
        } else {
          notes.push("requested output exceeds available liquidity");
        }
      }
    }

    if (amountOutResult == null && priceQuoted != null) {
      const amountInAfterFeeApprox = computeAmountInFromPrice(targetOut, priceQuoted, fromDecimals, toDecimals);
      if (amountInAfterFeeApprox != null) {
        let amountInCandidate = ceilDiv(amountInAfterFeeApprox * FEE_SCALE, feeFactor);
        if (amountInCandidate <= 0n) amountInCandidate = 1n;
        let feeCandidate = (amountInCandidate * feeBps) / FEE_SCALE;
        let actualInAfterFee = amountInCandidate - feeCandidate;
        let amountOutApprox = computeAmountOutFromPrice(actualInAfterFee, priceQuoted, fromDecimals, toDecimals);
        while (amountOutApprox != null && amountOutApprox < targetOut) {
          amountInCandidate += 1n;
          feeCandidate = (amountInCandidate * feeBps) / FEE_SCALE;
          actualInAfterFee = amountInCandidate - feeCandidate;
          amountOutApprox = computeAmountOutFromPrice(actualInAfterFee, priceQuoted, fromDecimals, toDecimals);
        }
        amountInRequired = amountInCandidate;
        amountInAfterFee = actualInAfterFee;
        feePaid = feeCandidate;
        amountOutResult = amountOutApprox ?? targetOut;
        notes.push("liquidity snapshot unavailable");
      }
    }

    if (amountOutResult == null) {
      notes.push("unable to satisfy requested output");
      amountInRequired = amountInRequired ?? 0n;
      feePaid = 0n;
      amountOutResult = 0n;
    }
  }

  if (slipNote) {
    notes.push(slipNote);
  }

  const normalizedAmountIn = amountInRequired ?? request.amountIn ?? 0n;
  const normalizedAmountOut = mode === "exactOut" ? request.amountOut ?? amountOutResult ?? 0n : request.amountOut;
  return createResponse(
    request,
    context,
    amountOutResult ?? 0n,
    feePaid,
    notes,
    normalizedAmountIn,
    normalizedAmountOut ?? undefined,
  );
}

function computeReservesFromTotals(context: SwapEvmContext): { reserveIn: bigint; reserveOut: bigint } | null {
  const pool = context.pool;
  const fromDecimals = context.direction === "baseToQuote" ? pool.baseDecimals : pool.quoteDecimals;
  const toDecimals = context.direction === "baseToQuote" ? pool.quoteDecimals : pool.baseDecimals;
  const totalIn = context.direction === "baseToQuote" ? toTokenUnits(pool.totalBase, fromDecimals) : toTokenUnits(pool.totalQuote, fromDecimals);
  const totalOut = context.direction === "baseToQuote" ? toTokenUnits(pool.totalQuote, toDecimals) : toTokenUnits(pool.totalBase, toDecimals);
  if (totalIn == null || totalOut == null || totalIn <= 0n || totalOut <= 0n) return null;
  return { reserveIn: totalIn, reserveOut: totalOut };
}

function computeSlipBps(amountInAfterFee: bigint, reserveIn: bigint): bigint {
  if (amountInAfterFee <= 0n || reserveIn <= 0n) return 0n;
  return (amountInAfterFee * 10_000n) / (reserveIn + amountInAfterFee);
}

function computeAmountOutFromPrice(amountInAfterFee: bigint | null, priceValue: number, fromDecimals: number, toDecimals: number): bigint | null {
  if (amountInAfterFee == null) return null;
  const amountInNumber = safeNumber(amountInAfterFee);
  if (amountInNumber == null) return null;

  const amountInFloat = amountInNumber / 10 ** fromDecimals;
  const amountOutFloat = amountInFloat * priceValue;
  if (!Number.isFinite(amountOutFloat) || amountOutFloat <= 0) return null;
  const scaled = Math.round(amountOutFloat * 10 ** toDecimals);
  if (!Number.isFinite(scaled)) return null;
  const result = BigInt(Math.max(0, scaled));
  return result;
}

function computeAmountInFromPrice(targetOut: bigint, priceValue: number, fromDecimals: number, toDecimals: number): bigint | null {
  const amountOutNumber = safeNumber(targetOut);
  if (amountOutNumber == null) return null;
  const amountOutFloat = amountOutNumber / 10 ** toDecimals;
  if (amountOutFloat <= 0) return null;
  const amountInFloat = amountOutFloat / priceValue;
  if (!Number.isFinite(amountInFloat) || amountInFloat <= 0) return null;
  const scaled = Math.ceil(amountInFloat * 10 ** fromDecimals);
  if (!Number.isFinite(scaled)) return null;
  return BigInt(Math.max(0, scaled));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function computeReservePrice(reserves: { reserveIn: bigint; reserveOut: bigint } | null | undefined, fromDecimals: number, toDecimals: number): number | null {
  if (!reserves) return null;
  if (reserves.reserveIn <= 0n || reserves.reserveOut <= 0n) return null;
  const reserveInFloat = Number(reserves.reserveIn) / 10 ** fromDecimals;
  const reserveOutFloat = Number(reserves.reserveOut) / 10 ** toDecimals;
  if (!Number.isFinite(reserveInFloat) || !Number.isFinite(reserveOutFloat) || reserveInFloat <= 0 || reserveOutFloat <= 0) return null;
  return reserveOutFloat / reserveInFloat;
}

function createResponse(
  request: OperationQuoteRequest,
  context: SwapEvmContext,
  amountOut: bigint,
  feePaid: bigint,
  notes: string[],
  normalizedAmountIn?: bigint,
  normalizedAmountOut?: bigint,
): OperationQuoteResponse {
  const warnings = notes.length > 0 ? [...new Set(notes)] : undefined;
  const normalizedRequest: OperationQuoteRequest = { ...request };
  if (normalizedAmountIn != null) normalizedRequest.amountIn = normalizedAmountIn;
  if (normalizedAmountOut != null) normalizedRequest.amountOut = normalizedAmountOut;
  return {
    request: normalizedRequest,
    amountOut,
    feePaid: feePaid > 0n ? feePaid : undefined,
    feeAsset: feePaid > 0n ? "from" : undefined,
    estGasWei: context.gasEstimateWei,
    warnings,
  };
}

function toTokenUnits(total: number | null | undefined, decimals: number): bigint | null {
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  try {
    const fixed = total.toFixed(decimals);
    const [intPartRaw, fracPartRaw = ""] = fixed.split(".");
    const fraction = fracPartRaw.padEnd(decimals, "0");
    const digits = `${intPartRaw.replace(/[^0-9-]/g, "")}${fraction}`;
    return BigInt(digits);
  } catch {
    return null;
  }
}

function safeNumber(value: bigint): number | null {
  const abs = value < 0n ? -value : value;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
