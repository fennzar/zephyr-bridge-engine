import type { GlobalState } from "@domain/state/types";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import { assetDecimals } from "@domain/assets/decimals";

import type { OperationQuoteRequest, OperationQuoteResponse } from "./types";

type Direction = "wrap" | "unwrap";

export function quoteBridgeOperation(
  request: OperationQuoteRequest,
  state: GlobalState,
  context?: BridgeOperationContext | null,
): OperationQuoteResponse | null {
  if (request.op !== "wrap" && request.op !== "unwrap") return null;

  if (!state.bridge) return null;
  const bridgeContext = context && context.direction === request.op ? context : null;
  if (!bridgeContext) return null;

  const fromDecimals = bridgeContext.fromDecimals ?? assetDecimals(request.from);
  const toDecimals = bridgeContext.toDecimals ?? assetDecimals(request.to);
  const amountIn = request.amountIn ?? null;
  const amountOutTarget = request.amountOut ?? null;

  if ((amountIn == null || amountIn <= 0n) && (amountOutTarget == null || amountOutTarget <= 0n)) {
    return buildBridgeResponse(request, 0n, 0n, {
      warnings: ["Amount in or amount out must be provided"],
      allowed: false,
      direction: request.op,
    });
  }

  if (request.op === "wrap") {
    return quoteWrap(request, bridgeContext, fromDecimals, toDecimals, amountIn, amountOutTarget);
  }

  return quoteUnwrap(request, bridgeContext, fromDecimals, toDecimals, amountIn, amountOutTarget);
}

function quoteWrap(
  request: OperationQuoteRequest,
  context: BridgeOperationContext,
  fromDecimals: number,
  toDecimals: number,
  amountIn: bigint | null,
  amountOutTarget: bigint | null,
): OperationQuoteResponse {
  const minFrom = context.minAmountFrom ?? 0n;
  const flatFeeFrom = context.flatFeeFrom ?? 0n;

  let usedAmountIn: bigint | null = null;
  let grossOut = 0n;
  let netOut = 0n;
  const warnings: string[] = [];

  if (amountIn != null && amountIn > 0n) {
    usedAmountIn = amountIn;
  } else if (amountOutTarget != null && amountOutTarget > 0n) {
    const grossRequiredTo = amountOutTarget + scaleAmount(flatFeeFrom, fromDecimals, toDecimals);
    usedAmountIn = scaleAmount(grossRequiredTo, toDecimals, fromDecimals, "ceil");
  }

  if (usedAmountIn == null) {
    return buildBridgeResponse(request, 0n, 0n, {
      warnings: ["Unable to derive amount in for wrap request"],
      allowed: false,
      direction: "wrap",
    });
  }

  if (usedAmountIn < minFrom) {
    warnings.push("Amount is below bridge minimum");
  }

  const grossOutTo = scaleAmount(usedAmountIn, fromDecimals, toDecimals);
  const feeTo = scaleAmount(flatFeeFrom, fromDecimals, toDecimals);
  grossOut = grossOutTo;
  netOut = grossOutTo > feeTo ? grossOutTo - feeTo : 0n;
  if (netOut === 0n) {
    warnings.push("Wrap fee exceeds amount");
  }

  const allowed = warnings.length === 0;

  return buildBridgeResponse(
    { ...request, amountIn: usedAmountIn, amountOut: request.amountOut ?? undefined },
    grossOut,
    netOut,
    {
      feePaid: flatFeeFrom,
      feeAsset: "from",
      warnings,
      allowed,
      direction: "wrap",
    },
  );
}

function quoteUnwrap(
  request: OperationQuoteRequest,
  context: BridgeOperationContext,
  fromDecimals: number,
  toDecimals: number,
  amountIn: bigint | null,
  amountOutTarget: bigint | null,
): OperationQuoteResponse {
  const minFrom = context.minAmountFrom ?? 0n;
  const flatFeeTo = context.flatFeeTo ?? numberToUnits(context.bridge.unwrap.bridgeFee, toDecimals);

  let usedAmountIn: bigint | null = null;
  let grossOut = 0n;
  let netOut = 0n;
  const warnings: string[] = [];

  if (amountIn != null && amountIn > 0n) {
    usedAmountIn = amountIn;
  } else if (amountOutTarget != null && amountOutTarget > 0n) {
    const grossRequiredTo = amountOutTarget + flatFeeTo;
    usedAmountIn = scaleAmount(grossRequiredTo, toDecimals, fromDecimals, "ceil");
  }

  if (usedAmountIn == null) {
    return buildBridgeResponse(request, 0n, 0n, {
      warnings: ["Unable to derive amount in for unwrap request"],
      allowed: false,
      direction: "unwrap",
    });
  }

  if (usedAmountIn < minFrom) {
    warnings.push("Amount is below bridge minimum");
  }

  const grossOutTo = scaleAmount(usedAmountIn, fromDecimals, toDecimals);
  grossOut = grossOutTo;
  const feeTo = grossOutTo > flatFeeTo ? flatFeeTo : grossOutTo;
  netOut = grossOutTo > flatFeeTo ? grossOutTo - flatFeeTo : 0n;
  if (netOut === 0n) {
    warnings.push("Bridge fee exceeds amount");
  }

  const allowed = warnings.length === 0;

  return buildBridgeResponse(
    { ...request, amountIn: usedAmountIn, amountOut: request.amountOut ?? undefined },
    grossOut,
    netOut,
    {
      feePaid: feeTo,
      feeAsset: "to",
      warnings,
      allowed,
      direction: "unwrap",
    },
  );
}

type BridgeResponseExtras = {
  feePaid?: bigint;
  feeAsset?: "from" | "to";
  warnings?: string[];
  allowed: boolean;
  direction: Direction;
};

function buildBridgeResponse(
  request: OperationQuoteRequest,
  grossAmountOut: bigint,
  amountOut: bigint,
  extras: BridgeResponseExtras,
): OperationQuoteResponse {
  return {
    request,
    grossAmountOut,
    amountOut,
    feePaid: extras.feePaid,
    feeAsset: extras.feeAsset,
    warnings: extras.warnings && extras.warnings.length > 0 ? extras.warnings : undefined,
    policy: {
      bridge: {
        allowed: extras.allowed && amountOut > 0n,
        reasons:
          !extras.allowed || amountOut === 0n
            ? extras.warnings && extras.warnings.length > 0
              ? extras.warnings
              : ["Bridge operation unavailable"]
            : undefined,
      },
    },
  };
}

function scaleAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
  mode: "floor" | "ceil" = "floor",
): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals > toDecimals) {
    const factor = 10n ** BigInt(fromDecimals - toDecimals);
    if (mode === "floor") return amount / factor;
    const quotient = amount / factor;
    const remainder = amount % factor;
    return remainder === 0n ? quotient : quotient + 1n;
  }
  const factor = 10n ** BigInt(toDecimals - fromDecimals);
  return amount * factor;
}

function numberToUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const scale = 10n ** BigInt(decimals);
  return BigInt(Math.round(amount * Number(scale)));
}
