import type { OpType } from "@domain/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";

export type RuntimeContext =
  | SwapEvmContext
  | NativeOperationContext
  | BridgeOperationContext
  | CexOperationContext;

const DEFAULT_DEPTH_PREVIEW_LIMIT = 20;

function isCexTradeContext(
  context: RuntimeContext | null | undefined,
): context is CexOperationContext & { direction: "tradeCEX" } {
  return Boolean(
    context &&
    typeof context === "object" &&
    "direction" in context &&
    (context as CexOperationContext).direction === "tradeCEX" &&
    "market" in context,
  );
}

function isBridgeContext(
  context: RuntimeContext | null | undefined,
  op: OpType | null,
): context is BridgeOperationContext {
  if (!context || !op) return false;
  if (op !== "wrap" && op !== "unwrap") return false;
  return (
    typeof context === "object" &&
    "direction" in context &&
    (context as BridgeOperationContext).direction === op &&
    "minAmountFrom" in context
  );
}

export function sanitizeRuntimeContext(
  op: OpType | null,
  context: RuntimeContext | null,
  options: { depthLimit?: number } = {},
): RuntimeContext | Record<string, unknown> | null {
  if (!context) return null;
  const depthLimit = options.depthLimit ?? DEFAULT_DEPTH_PREVIEW_LIMIT;

  if (op === "tradeCEX" && isCexTradeContext(context)) {
    const cexContext = context;
    const market = cexContext.market;

    return {
      direction: cexContext.direction,
      tradeSide: cexContext.tradeSide,
      stale: cexContext.stale,
      watcher: cexContext.cex?.watcher ?? null,
      fees: cexContext.cex
        ? {
            takerBps: cexContext.cex.fees.takerBps,
            makerBps: cexContext.cex.fees.makerBps,
          }
        : undefined,
      marketSymbol: cexContext.marketSymbol,
      market: market
        ? {
            bid: market.bid ?? null,
            ask: market.ask ?? null,
            lastUpdatedAt: market.lastUpdatedAt ?? null,
            depth: {
              bids: (market.depth?.bids ?? []).slice(0, depthLimit),
              asks: (market.depth?.asks ?? []).slice(0, depthLimit),
            },
          }
        : null,
    };
  }

  if (isBridgeContext(context, op)) {
    const bridgeContext = context as BridgeOperationContext;
    const minFormatted = formatBigint(bridgeContext.minAmountFrom, bridgeContext.fromDecimals);
    const flatFromFormatted = bridgeContext.flatFeeFrom
      ? formatBigint(bridgeContext.flatFeeFrom, bridgeContext.fromDecimals)
      : null;
    const flatToFormatted = bridgeContext.flatFeeTo
      ? formatBigint(bridgeContext.flatFeeTo, bridgeContext.toDecimals)
      : null;
    return {
      direction: bridgeContext.direction,
      from: bridgeContext.from,
      to: bridgeContext.to,
      minAmountFrom: minFormatted,
      flatFeeFrom: flatFromFormatted,
      flatFeeTo: flatToFormatted,
    };
  }

  return context;
}

function formatBigint(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fractionRaw = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const fraction = fractionRaw.length > 0 ? `.${fractionRaw}` : "";
  const result = `${whole.toString()}${fraction}`;
  return negative ? `-${result}` : result;
}
