/**
 * Shared API response types extracted from page components.
 * Each page imports from here instead of defining inline types.
 */
import type { AssetId } from "@domain/types";

// ── Balances ────────────────────────────────────────────

export type TokenBalance = {
  key: string;
  symbol: string;
  address: string;
  decimals: number;
  balance: string;
  balanceNumber: number | null;
  raw: string;
  error?: string | null;
};

export type NativeBalance = {
  symbol: string;
  balance: string;
  balanceNumber: number | null;
  raw: string;
};

export type EvmPayload = {
  address: string | null;
  network: string;
  rpcUrl: string | null;
  status: "ok" | "missing-address" | "missing-rpc" | "error";
  native: NativeBalance | null;
  tokens: TokenBalance[];
  error: string | null;
};

export type PaperPayload = {
  mexc: Record<string, number>;
  zephyr: Record<string, number>;
  updatedAt: string;
};

export type ZephyrWalletPayload = {
  status: "ok" | "error";
  address: string | null;
  balances: {
    zeph: number;
    zsd: number;
    zrs: number;
    zys: number;
    unlockedZeph: number;
    unlockedZsd: number;
    unlockedZrs: number;
    unlockedZys: number;
  } | null;
  error?: string;
} | null;

export type BalancesResponse = {
  timestamp: string;
  evm: EvmPayload;
  paper: PaperPayload;
  zephyrWallet?: ZephyrWalletPayload;
  config: {
    mexcPaper: boolean;
    zephyrPaper: boolean;
  };
  error?: string;
};

// ── Engine ──────────────────────────────────────────────

export interface EngineStatus {
  timestamp: string;
  database: {
    connected: boolean;
    pendingOperations: number;
    approvedOperations: number;
    recentExecutions: number;
  };
  state: {
    zephyrAvailable: boolean;
    evmAvailable: boolean;
    cexAvailable: boolean;
    reserveRatio: number | null;
    rrMode: string;
  };
  runner?: {
    autoExecute: boolean;
    manualApproval: boolean;
    cooldownMs: number;
  };
}

export interface QueueOperation {
  id: string;
  strategy: string;
  status: string;
  priority: number;
  plan: unknown;
  createdAt: string;
  approvedAt: string | null;
  executedAt: string | null;
}

export interface EvaluationResult {
  timestamp: string;
  state: {
    reserveRatio: number;
    reserveRatioMa: number;
    zephPrice: number;
    rrMode: string;
  } | null;
  results: Record<
    string,
    {
      opportunities: Array<{
        id: string;
        strategy: string;
        trigger: string;
        asset?: string;
        direction?: string;
        expectedPnl: number;
        urgency: string;
      }>;
      metrics: Record<string, number>;
      warnings?: string[];
    }
  >;
  errors?: string[];
}

export interface ExecutionHistory {
  id: string;
  strategy: string;
  mode: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  netPnlUsd: number | null;
  plan: {
    id: string;
    opportunity?: {
      asset?: string;
      direction?: string;
      expectedPnl: number;
    };
    steps?: Array<{
      planStepId: string;
      op: string;
      from: string;
      to: string;
    }>;
  };
  stepResults?: Array<{
    step: { planStepId: string; op: string };
    status: string;
    error?: string;
    durationMs?: number;
  }>;
}

// ── MEXC ────────────────────────────────────────────────

export type DepthLevel = {
  price: number;
  qty: number;
  notional: number;
};

export type MarketSummary = {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  mid: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  depthUsd: {
    bidUsd: number;
    askUsd: number;
  };
  generatedAt: string;
};

export type PaperEvent =
  | {
      id: string;
      type: "deposit" | "withdraw";
      asset: string;
      amount: number;
      timestamp: string;
      note?: string;
    }
  | {
      id: string;
      type: "trade";
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      price: number;
      fee: number;
      feeAsset: string;
      baseDelta: number;
      quoteDelta: number;
      timestamp: string;
    };

export type MexcTickerSnapshot = {
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
};

export type MexcDepthSnapshot = {
  symbol: string;
  bids: Array<{ price: number; qty: number }>;
  asks: Array<{ price: number; qty: number }>;
  ts: number;
};

export type MexcTradeSnapshot = {
  symbol: string;
  price: number;
  qty: number;
  ts: number;
  side?: "buy" | "sell";
};

export type MexcSnapshot = {
  ticker?: MexcTickerSnapshot;
  depth?: MexcDepthSnapshot;
  trades: MexcTradeSnapshot[];
  lastUpdatedAt: number | null;
  staleAfterMs: number;
  watcher: {
    live: boolean;
    lastUpdatedAt?: number;
  };
};

// ── Quoters ─────────────────────────────────────────────

export type QuotePoolImpact = {
  poolKey?: string | null;
  baseAsset?: AssetId | null;
  quoteAsset?: AssetId | null;
  priceBefore?: string | null;
  priceAfter?: string | null;
  priceImpactBps?: number | null;
  priceBeforeRaw?: string | null;
  priceAfterRaw?: string | null;
  priceAfterSqrt?: string | null;
  baseReserveBefore?: string | null;
  baseReserveAfter?: string | null;
  quoteReserveBefore?: string | null;
  quoteReserveAfter?: string | null;
  baseDelta?: string | null;
  quoteDelta?: string | null;
};

export type QuoteCexImpact = {
  market?: string | null;
  side?: "buy" | "sell";
  priceBefore?: string | null;
  priceAfter?: string | null;
  priceImpactBps?: number | null;
  averageFillPrice?: string | null;
  grossNotional?: string | null;
  netNotional?: string | null;
  feeNotional?: string | null;
  depthLevelsUsed?: number | null;
  warnings?: string[];
};
