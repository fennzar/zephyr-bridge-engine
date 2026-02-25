import type { ExecutionMode } from "@domain/execution";

/**
 * Balance information for a single asset.
 */
export interface MexcBalance {
  asset: string;
  available: number;
  locked: number;
}

/**
 * Collection of balances keyed by asset symbol.
 */
export type MexcBalances = Record<string, MexcBalance>;

/**
 * Parameters for placing a market order.
 */
export interface MexcMarketOrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** Optional: use quote order quantity instead of base quantity. */
  quoteOrderQty?: number;
}

/**
 * Result of a market order execution.
 */
export interface MexcOrderResult {
  success: boolean;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  executedQty: number;
  executedPrice: number;
  fee: number;
  feeAsset: string;
  timestamp: string;
  error?: string;
}

/**
 * Parameters for requesting a withdrawal.
 */
export interface MexcWithdrawParams {
  asset: string;
  amount: number;
  address: string;
  network?: string;
  memo?: string;
}

/**
 * Result of a withdrawal request.
 */
export interface MexcWithdrawResult {
  success: boolean;
  withdrawId: string;
  asset: string;
  amount: number;
  fee: number;
  status: "pending" | "processing" | "completed" | "failed";
  timestamp: string;
  error?: string;
}

/**
 * Deposit address information.
 */
export interface MexcDepositAddress {
  asset: string;
  address: string;
  network: string;
  memo?: string;
}

/**
 * Event types for history tracking.
 */
export type MexcEventType = "deposit" | "withdraw" | "trade";

/**
 * Event record for history.
 */
export interface MexcEvent {
  id: string;
  type: MexcEventType;
  asset?: string;
  symbol?: string;
  amount?: number;
  side?: "BUY" | "SELL";
  price?: number;
  fee?: number;
  timestamp: string;
  status?: string;
}

/**
 * Interface for MEXC client operations.
 * Implemented by both paper (simulated) and live (real API) clients.
 */
export interface IMexcClient {
  /** Execution mode of this client. */
  readonly mode: ExecutionMode;

  /**
   * Get current balances for all assets.
   */
  getBalances(): Promise<MexcBalances>;

  /**
   * Get balance for a specific asset.
   */
  getBalance(asset: string): Promise<MexcBalance | null>;

  /**
   * Execute a market order.
   */
  marketOrder(params: MexcMarketOrderParams): Promise<MexcOrderResult>;

  /**
   * Get deposit address for an asset.
   */
  getDepositAddress(asset: string, network?: string): Promise<MexcDepositAddress>;

  /**
   * Request a withdrawal.
   */
  requestWithdraw(params: MexcWithdrawParams): Promise<MexcWithdrawResult>;

  /**
   * Get recent events (trades, deposits, withdrawals).
   */
  getRecentEvents(limit?: number): Promise<MexcEvent[]>;

  /**
   * Notify the client of an external deposit (for paper mode coordination).
   * Live mode may no-op or refresh balances.
   */
  notifyDeposit(asset: string, amount: number): Promise<void>;
}

/**
 * Factory function to create the appropriate MEXC client based on mode.
 * Implementation provided in paper.ts and live.ts modules.
 */
export type MexcClientFactory = (mode: ExecutionMode) => IMexcClient;

