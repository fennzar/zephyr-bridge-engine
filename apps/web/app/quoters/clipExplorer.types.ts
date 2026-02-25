import type { ReactNode } from "react";

export type ClipResponseClip = {
  asset: string;
  amount: string;
  amountDecimal: number;
  amountUsd: number | null;
};

export type ClipExecutionResponse = {
  flavor: "open" | "native" | "cex";
  fromAsset: string;
  toAsset: string;
  amountInDecimal?: number;
  amountOutDecimal?: number;
  poolPriceBefore?: number;
  poolPriceAfter?: number;
  onchainAmountOutDecimal?: number;
  onchainPoolPriceAfter?: number;
  onchainWarnings?: string[];
  evaluation?: Record<string, unknown> | null;
  baseSymbol?: string;
  quoteSymbol?: string;
  poolBaseBefore?: number;
  poolQuoteBefore?: number;
  poolBaseAfter?: number;
  poolQuoteAfter?: number;
  onchainPoolBaseAfter?: number;
  onchainPoolQuoteAfter?: number;
  onchainSqrtPriceAfter?: string;
  onchainBaseDelta?: number;
  onchainQuoteDelta?: number;
  referencePriceBefore?: number;
  predictedPriceAfter?: number;
  onchainPriceAfter?: number;
  priceDiffBps?: number;
  referenceLabel?: string;
  effectivePrice?: number;
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
};

export type ClipSummaryResponse = {
  netUsdChange: number | null;
  totalCostUsd: number | null;
  notes: string[];
};

export type ClipSearchIterationResponse = {
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
};

export type ClipOptionResponse = {
  flavor: "native" | "cex";
  clip: ClipResponseClip;
  open: {
    candidate: Record<string, unknown> | null;
    execution: ClipExecutionResponse | null;
    searchLog: ClipSearchIterationResponse[];
  };
  close: {
    candidate: Record<string, unknown> | null;
    execution: ClipExecutionResponse | null;
  };
  summary: ClipSummaryResponse;
  initialPrice: number | null;
  referencePrice: number | null;
  targetPrice: number | null;
};

export type ClipApiResponse = {
  generatedAt: string;
  asset: string;
  direction: string;
  pool: Record<string, unknown> | null;
  zephSpotUsd: number | null;
  options: ClipOptionResponse[];
  error?: string;
};

export type OverviewMetric = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "positive" | "negative";
  variant?: "default" | "price" | "price-final";
  badge?: string | null;
  badgeAlign?: "left" | "right";
  details?: Array<{ label: ReactNode; value: ReactNode }>;
};

export type InventoryDelta = {
  assetId: string;
  baseAsset: string;
  amount: number;
  usdChange: number | null;
  usdPrice: number | null;
  source?: string;
};

export type InventoryGroup = {
  asset: string;
  totalAmount: number;
  totalUsdChange: number | null;
  entries: InventoryDelta[];
};

export type MutableInventoryGroup = {
  asset: string;
  totalAmount: number;
  totalUsdChange: number;
  hasUsd: boolean;
  entries: InventoryDelta[];
};

export type InfoEntry = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "positive" | "negative";
  align?: "start" | "end";
};

export type FlowTone = "open" | "bridge" | "close-native" | "close-cex";

export type ClipLegSectionProps = {
  metaEntries?: InfoEntry[];
  tradeEntries?: InfoEntry[];
  priceEntries?: InfoEntry[];
  flavorBadge?: string | null;
  flavorTone?: FlowTone;
  rawLabel: string;
  rawCandidate: Record<string, unknown> | null;
};

export type ClipLegSectionConfig = ClipLegSectionProps & {
  key: string;
  title: string;
};

export type CandidatePathInfo = {
  assets: string[];
  steps: Array<{ op?: string | null; venue?: string | null }>;
};

export type CostEntry = {
  label: string;
  asset?: string;
  amount: number | null;
  usdAmount: number | null;
  source: string;
  kind: "fee" | "gas";
};

export type ClipOptionCardProps = {
  option: ClipOptionResponse;
  index: number;
  pool: Record<string, unknown> | null;
  asset: string;
  direction: string;
  zephSpotUsd: number | null;
};
