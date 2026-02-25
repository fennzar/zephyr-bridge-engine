import type { PathEvaluation } from "@domain/pathing";
import type { QuoterAwareCandidate } from "@domain/pathing/arb";
import type { EvmPool } from "@domain/state/types";
import type { AssetId } from "@domain/types";

export interface ClipEstimate {
  asset: AssetId;
  amount: bigint;
  amountDecimal: number;
  amountUsd: number | null;
  pool?: EvmPool | null;
}

export interface ClipEstimateOptions {
  amountOverride?: bigint;
  pathLimit?: number;
}

export interface ClipSearchIteration {
  iteration: number;
  amountDecimal: number;
  openAmountOutDecimal: number | null;
  closeAmountOutDecimal: number | null;
  poolPriceAfter: number | null;
  validatedPriceAfter: number | null;
  counterPriceAfter: number | null;
  targetPrice: number | null;
  targetDiffBps: number | null;
  priceDiffBps: number | null;
  priceGap?: number | null;
}

export interface ClipExecutionVariant {
  flavor: "open" | "native" | "cex";
  evaluation: PathEvaluation | null;
  amountInDecimal: number | null;
  amountOutDecimal: number | null;
  poolPriceBefore: number | null;
  poolPriceAfter: number | null;
  onchainAmountOutDecimal: number | null;
  onchainPoolPriceAfter: number | null;
  onchainWarnings?: string[];
  fromAsset: AssetId;
  toAsset: AssetId;
  baseSymbol?: string;
  quoteSymbol?: string;
  poolBaseBefore: number | null;
  poolQuoteBefore: number | null;
  poolBaseAfter: number | null;
  poolQuoteAfter: number | null;
  onchainPoolBaseAfter: number | null;
  onchainPoolQuoteAfter: number | null;
  onchainSqrtPriceAfter?: bigint | null;
  onchainBaseDelta?: number | null;
  onchainQuoteDelta?: number | null;
  referencePriceBefore: number | null;
  predictedPriceAfter: number | null;
  onchainPriceAfter: number | null;
  priceDiffBps: number | null;
  referenceLabel?: string;
  effectivePrice?: number | null;
  nativeRateMode?: "mint" | "redeem";
  nativeRateBasis?: "spot" | "moving_average" | "spot_equals_ma";
  nativeRateBasisLabel?: string;
  nativeRateSpot?: number | null;
  nativeRateMovingAverage?: number | null;
  nativeRateMintPrice?: number | null;
  nativeRateRedeemPrice?: number | null;
  nativeRateStableAsset?: string | null;
  nativeRateReferenceAsset?: string | null;
  nativeRatePairBase?: string | null;
  nativeRatePairQuote?: string | null;
  nativeReferenceUsdBase?: string | null;
  nativeReferenceUsdQuote?: string | null;
  nativeReferenceSpotUsd?: number | null;
  nativeReferenceMovingAverageUsd?: number | null;
}

export interface ClipRouteOutcome {
  flavor: "native" | "cex";
  openLeg: ClipExecutionVariant | null;
  closeLeg: ClipExecutionVariant | null;
  netUsdChange: number | null;
  totalCostUsd: number | null;
  notes: string[];
}

export interface ClipLegSummary {
  candidate: QuoterAwareCandidate | null;
  execution: ClipExecutionVariant | null;
}

export interface ClipOption {
  flavor: "native" | "cex";
  clip: ClipEstimate;
  open: ClipLegSummary & { searchLog: ClipSearchIteration[] };
  close: ClipLegSummary;
  summary: ClipRouteOutcome;
  initialPrice: number | null;
  referencePrice: number | null;
  targetPrice: number | null;
}

export interface ClipScenario {
  pool: EvmPool | null;
  options: ClipOption[];
}

export interface ClipCalibrationResult {
  openExecution: ClipExecutionVariant;
  closeExecution: ClipExecutionVariant | null;
  amountDecimal: number;
  amountRaw: bigint;
  amountUsd: number | null;
  searchLog: ClipSearchIteration[];
  initialPoolPrice: number | null;
  referencePrice: number | null;
  targetPrice: number | null;
}
