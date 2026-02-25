import type { AssetId, OpType } from "@domain/types";
import type { AssetPath } from "@domain/inventory/graph";
import type { OperationQuoteRequest, OperationQuoteResponse } from "@domain/quoting/types";

export type InventoryBalances = Partial<Record<AssetId, number>>;

export interface PathingQuoteRequest {
  from: AssetId;
  to: AssetId;
  amountIn: bigint;
  maxDepth?: number;
  limit?: number;
  inventory?: InventoryBalances;
}

export interface PathHopQuote {
  request: OperationQuoteRequest;
  response: OperationQuoteResponse | null;
}

export interface PathAssetDelta {
  asset: AssetId;
  amount: bigint;
  amountDecimal: number;
  usdPrice?: number | null;
  usdChange?: number | null;
  startingBalance?: number | null;
  endingBalance?: number | null;
}

export interface PathFeeSummary {
  asset: AssetId;
  amount: bigint;
  amountDecimal: number;
  usdPrice?: number | null;
  usdAmount?: number | null;
}

export type PathInventoryStatus = "prepped" | "covered" | "unknown" | "short";

export interface PathInventoryShortfall {
  asset: AssetId;
  shortfall: number;
  startingBalance?: number | null;
  endingBalance?: number | null;
}

export interface PathInventorySummary {
  status: PathInventoryStatus;
  shortfalls: PathInventoryShortfall[];
}

export interface PathHopEvaluation {
  index: number;
  op: OpType;
  from: AssetId;
  to: AssetId;
  runtimeEnabled: boolean | null;
  runtimeContextAvailable: boolean;
  durationMs?: number;
  quote?: PathHopQuote;
  amountIn?: bigint | null;
  amountOut?: bigint | null;
  feeBps?: number | null;
  gasWei?: bigint | null;
  gasUsd?: number | null;
  feePaid?: bigint | null;
  feeAssetId?: AssetId | null;
  feeUsd?: number | null;
  assetDeltas: Partial<Record<AssetId, bigint>>;
  allowed: boolean;
  allowanceReasons: string[];
  warnings: string[];
}

export interface PathEvaluationScore {
  allowed: boolean;
  disallowedSteps: number;
  totalFeeBps?: number | null;
  totalGasWei?: bigint | null;
  totalGasUsd?: number | null;
  netUsdChangeUsd?: number | null;
  totalCostUsd?: number | null;
  totalDurationMs?: number | null;
  hopCount: number;
  inventoryStatus: PathInventoryStatus;
}

export interface PathEvaluation {
  path: AssetPath;
  hops: PathHopEvaluation[];
  score: PathEvaluationScore;
  finalAmountOut?: bigint | null;
  assetDeltas: PathAssetDelta[];
  feeBreakdown: PathFeeSummary[];
  totalFeeUsd?: number | null;
  totalGasUsd?: number | null;
  netUsdChangeUsd?: number | null;
  totalCostUsd?: number | null;
  totalDurationMs?: number | null;
  notes: string[];
  inventory: PathInventorySummary;
}

export interface PathingResult {
  from: AssetId;
  to: AssetId;
  amountIn: bigint;
  maxDepth?: number;
  evaluatedAt: number;
  paths: PathEvaluation[];
}
