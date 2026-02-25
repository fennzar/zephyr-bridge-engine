import type { AssetId, OpType } from "@domain/types";
import type { QuotePoolImpact, QuoteCexImpact } from "@/types/api";
import type { RuntimeContext } from "./rateHelpers";
import { isSwapContext } from "./rateHelpers";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import { getAssetDecimals } from "../shared/assetMetadata";
import { QUOTER_ASSETS } from "./config";

const ASSETS = QUOTER_ASSETS;

export function normalizeParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function isAssetId(value: string | null): value is AssetId {
  return value != null && (ASSETS as string[]).includes(value);
}

export function resolveDecimals(
  op: OpType | null,
  context: RuntimeContext | null,
  from: AssetId | null,
  to: AssetId | null,
): { from?: number; to?: number } {
  if (op === "swapEVM" && context && isSwapContext(context)) {
    return {
      from: context.direction === "baseToQuote" ? context.pool.baseDecimals : context.pool.quoteDecimals,
      to: context.direction === "baseToQuote" ? context.pool.quoteDecimals : context.pool.baseDecimals,
    };
  }

  if (
    (op === "wrap" || op === "unwrap") &&
    context &&
    typeof context === "object" &&
    "fromDecimals" in context &&
    "toDecimals" in context
  ) {
    const bridge = context as BridgeOperationContext;
    return {
      from: bridge.fromDecimals,
      to: bridge.toDecimals,
    };
  }

  return {
    from: from ? getAssetDecimals(from) : undefined,
    to: to ? getAssetDecimals(to) : undefined,
  };
}

export function valueArrow(oldValue: string | null | undefined, newValue: string | null | undefined) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {oldValue ?? "\u2014"}
      <span style={{ opacity: 0.6, margin: "0 6px" }}>\u2192</span>
      {newValue ?? "\u2014"}
    </span>
  );
}

export function formatBpsLabel(value?: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps`;
}

export type QuoteCardMetadata = {
  operation: OpType | null;
  zeroForOne?: boolean;
  from?: AssetId | null;
  to?: AssetId | null;
  poolImpact?: QuotePoolImpact | null;
  cexImpact?: QuoteCexImpact | null;
};
