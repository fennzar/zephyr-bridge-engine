import type { AssetId, OpType } from "@domain/types";
import type { GlobalState } from "@domain/state/types";

export interface OperationQuoteRequest {
  op: OpType;
  from: AssetId;
  to: AssetId;
  amountIn?: bigint;
  amountOut?: bigint;
}

export type NetworkMetricFormat = "token" | "ratio";

export interface NetworkEffectMetric {
  key: string;
  label: string;
  format: NetworkMetricFormat;
  old: number;
  delta: number;
  new: number;
  deltaPercent: number | null;
}

export interface NetworkEffect {
  operation: OpType;
  metrics: NetworkEffectMetric[];
}

export interface OperationQuoteResponse {
  request: OperationQuoteRequest;
  grossAmountOut?: bigint;
  amountOut: bigint;
  feePaid?: bigint;
  feeAsset?: "from" | "to";
  estGasWei?: bigint;
  warnings?: string[];
  networkEffect?: NetworkEffect;
  policy?: {
    native?: {
      allowed: boolean;
      reasons?: string[];
    };
    cex?: {
      allowed: boolean;
      reasons?: string[];
    };
    bridge?: {
      allowed: boolean;
      reasons?: string[];
    };
  };
  poolImpact?: SwapPoolImpact;
  cexImpact?: CexTradeImpact;
}

export interface SwapPoolImpact {
  poolKey?: string;
  baseAsset?: AssetId;
  quoteAsset?: AssetId;
  priceBefore?: string | null;
  priceAfter?: string | null;
  priceBeforeRaw?: string | null;
  priceAfterRaw?: string | null;
  priceAfterSqrt?: string | null;
  priceImpactBps?: number | null;
  baseReserveBefore?: string | null;
  baseReserveAfter?: string | null;
  quoteReserveBefore?: string | null;
  quoteReserveAfter?: string | null;
  baseDelta?: string | null;
  quoteDelta?: string | null;
}

export interface CexTradeImpact {
  market?: string | null;
  side: "buy" | "sell";
  priceBefore?: string | null;
  priceAfter?: string | null;
  priceImpactBps?: number | null;
  averageFillPrice?: string | null;
  grossNotional?: string | null;
  netNotional?: string | null;
  feeNotional?: string | null;
  depthLevelsUsed?: number;
  warnings?: string[];
}

export interface QuoteContext {
  state: GlobalState;
}

export interface RouteQuoteRequest {
  context: QuoteContext;
  legs: OperationQuoteRequest[];
}

export interface RouteQuoteBreakdown {
  legs: OperationQuoteResponse[];
  totalIn: bigint;
  totalOut: bigint;
  notes?: string[];
}
