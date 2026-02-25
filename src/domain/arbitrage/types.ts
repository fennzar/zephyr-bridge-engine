// src/domain/arbitrage/types.ts
import type { PoolOverview } from "@services/evm/uniswapV4";

export type CaseType = "premium" | "discount";

export type PriceComparison = {
  unitSymbol: string; // e.g., "USDT" or "WZSD"
  dexPrice: number; // rate in unitSymbol
  dexPriceUsd: number; // rate * $unit
  pool?: PoolOverview | null;
};

export type AssetStatus = {
  mode: "aligned" | "premium" | "discount";
  gapBps: number;
  referenceLabel: string;
  referencePrice: number; // in unitSymbol
  referencePriceUsd: number; // USD equivalent
  referenceDescription: string;
  caseType?: CaseType;
};

export type Opportunity = {
  id: string;
  asset: string;
  title: string;
  path: string;
  direction: string;
  edgeBps: number;
  thresholdBps: number;
  meetsThreshold: boolean;
  estProfitUsd: number;
  unitProfitUsd: number;
  tradeSize: number;
  tradeSymbol: string;
  steps: { label: string; detail: string }[];
  working: string[];
  notes: string[];
};

export type AssetOverview = {
  asset: "ZSD" | "ZEPH" | "ZYS" | "ZRS";
  wrappedSymbol: "WZSD" | "WZEPH" | "WZYS" | "WZRS";
  thresholdBps: number;
  status: AssetStatus;
  comparisons: PriceComparison[];
  primaryComparison: PriceComparison | null;
  opportunities: Opportunity[];
  // small flag used by ZYS route copy
  yieldHalted?: boolean;
};

export function formatAssetStatus(ov: AssetOverview): string {
  const s = ov.status;
  if (s.mode === "aligned") return "Aligned (within threshold)";
  return s.mode === "premium" ? "Premium vs reference" : "Discount vs reference";
}

export type RouteInventoryLeg = {
  asset: string;
  amount: number;
  denomination: "usd" | "token";
  available: number | null;
  shortfall: number;
  note?: string;
};

export type RouteInventoryPlan = {
  inputs: RouteInventoryLeg[];
  outputs: RouteInventoryLeg[];
  summary?: RouteInventorySummary;
};

export type CaseRoute = {
  label: string;
  available: boolean;
  note?: string;
  availabilityNote?: string;
  edgeBps?: number;
  unitEdge?: string;
  recommendedSize?: string;
  estimatedProfit?: string;
  clipSummary?: string;
  footnotes?: string[];
  stepDetails: { title: string; lines: string[] }[];
  inventory?: RouteInventoryPlan;
};

export type RouteInventorySummaryRow = {
  asset: string;
  denomination: "usd" | "token";
  before: number | null;
  change: number;
  after: number | null;
  usdBefore: number | null;
  usdChange: number | null;
  usdAfter: number | null;
};

export type RouteInventorySummary = {
  rows: RouteInventorySummaryRow[];
  totalUsdChange: number | null;
};
