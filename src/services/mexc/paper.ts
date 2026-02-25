import { randomUUID } from "node:crypto";

import type { ExecutionMode } from "@domain/execution";
import type {
  IMexcClient,
  MexcBalance,
  MexcBalances,
  MexcMarketOrderParams,
  MexcOrderResult,
  MexcWithdrawParams,
  MexcWithdrawResult,
  MexcDepositAddress,
  MexcEvent,
} from "./client";

type Side = "BUY" | "SELL";

export type PaperBalance = {
  available: number;
  hold: number;
};

export type PaperBalances = Record<string, PaperBalance>;

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
      side: Side;
      quantity: number;
      price: number;
      fee: number;
      feeAsset: string;
      baseDelta: number;
      quoteDelta: number;
      timestamp: string;
    };

export type PaperAccountSnapshot = {
  balances: PaperBalances;
  events: PaperEvent[];
  updatedAt: string;
};

type InternalMarketOrderParams = {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  feeBps?: number;
  feeAsset?: string;
};

type BalanceUpdate = {
  asset: string;
  delta: number;
};

const DEFAULT_FEE_BPS = 10; // 0.10%

/** Mock deposit addresses for paper trading. */
const MOCK_DEPOSIT_ADDRESSES: Record<string, string> = {
  ZEPH: "PAPER_ZEPH_DEPOSIT_ADDRESS_12345",
  USDT: "0xPAPER_USDT_DEPOSIT_ADDRESS_67890",
};

function nowIso(): string {
  return new Date().toISOString();
}

function ensureBalance(record: PaperBalance | undefined): PaperBalance {
  if (!record) return { available: 0, hold: 0 };
  return record;
}

function symbolToAssets(symbol: string): { base: string; quote: string } {
  const upper = symbol.toUpperCase();
  if (!upper.endsWith("USDT")) {
    // crude split: assume quote = last 4 chars
    return {
      base: upper.slice(0, -4),
      quote: upper.slice(-4),
    };
  }
  return {
    base: upper.replace(/USDT$/, ""),
    quote: "USDT",
  };
}

/**
 * Paper trading implementation of IMexcClient.
 * Simulates CEX operations in-memory for testing and development.
 */
export class MexcPaperClient implements IMexcClient {
  readonly mode: ExecutionMode = "paper";

  private balances: PaperBalances;
  private events: PaperEvent[];

  constructor(init: Record<string, number> = { USDT: 100_000, ZEPH: 0 }) {
    this.balances = {};
    Object.entries(init).forEach(([asset, amount]) => {
      this.balances[asset.toUpperCase()] = { available: amount, hold: 0 };
    });
    this.events = [];
  }

  /**
   * Get a snapshot of current balances and recent events.
   */
  snapshot(): PaperAccountSnapshot {
    return {
      balances: JSON.parse(JSON.stringify(this.balances)) as PaperBalances,
      events: [...this.events].slice(-50).reverse(),
      updatedAt: nowIso(),
    };
  }

  // ============================================================
  // IMexcClient Implementation
  // ============================================================

  async getBalances(): Promise<MexcBalances> {
    const result: MexcBalances = {};
    for (const [asset, balance] of Object.entries(this.balances)) {
      result[asset] = {
        asset,
        available: balance.available,
        locked: balance.hold,
      };
    }
    return result;
  }

  async getBalance(asset: string): Promise<MexcBalance | null> {
    const key = asset.toUpperCase();
    const balance = this.balances[key];
    if (!balance) return null;
    return {
      asset: key,
      available: balance.available,
      locked: balance.hold,
    };
  }

  async marketOrder(params: MexcMarketOrderParams): Promise<MexcOrderResult> {
    const { symbol, side, quantity } = params;
    const timestamp = nowIso();

    // For paper trading, we need a price. In a real scenario,
    // this would come from the order book. For now, require external price.
    // We'll use a simple lookup or throw if not provided.
    const price = await this.getCurrentPrice(symbol);

    try {
      const event = this.executeMarketOrder({
        symbol,
        side,
        quantity,
        price,
        feeBps: DEFAULT_FEE_BPS,
        feeAsset: "USDT",
      });

      if (event.type !== "trade") {
        throw new Error("Unexpected event type");
      }

      return {
        success: true,
        orderId: event.id,
        symbol: event.symbol,
        side: event.side,
        executedQty: event.quantity,
        executedPrice: event.price,
        fee: event.fee,
        feeAsset: event.feeAsset,
        timestamp: event.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        orderId: "",
        symbol,
        side,
        executedQty: 0,
        executedPrice: 0,
        fee: 0,
        feeAsset: "USDT",
        timestamp,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getDepositAddress(asset: string, _network?: string): Promise<MexcDepositAddress> {
    const key = asset.toUpperCase();
    return {
      asset: key,
      address: MOCK_DEPOSIT_ADDRESSES[key] ?? `PAPER_${key}_DEPOSIT_ADDRESS`,
      network: key === "USDT" ? "ERC20" : "ZEPHYR",
    };
  }

  async requestWithdraw(params: MexcWithdrawParams): Promise<MexcWithdrawResult> {
    const { asset, amount, address } = params;
    const key = asset.toUpperCase();
    const timestamp = nowIso();

    // Check balance
    const balance = this.balances[key];
    if (!balance || balance.available < amount) {
      return {
        success: false,
        withdrawId: "",
        asset: key,
        amount,
        fee: 0,
        status: "failed",
        timestamp,
        error: `Insufficient ${key} balance`,
      };
    }

    // Simulate withdrawal (deduct balance)
    const fee = this.getWithdrawFee(key);
    const netAmount = amount - fee;

    if (netAmount <= 0) {
      return {
        success: false,
        withdrawId: "",
        asset: key,
        amount,
        fee,
        status: "failed",
        timestamp,
        error: "Amount less than withdrawal fee",
      };
    }

    // Deduct from balance
    balance.available -= amount;
    this.balances[key] = balance;

    const event: PaperEvent = {
      id: randomUUID(),
      type: "withdraw",
      asset: key,
      amount: -amount,
      timestamp,
      note: `To: ${address}`,
    };
    this.events.push(event);

    return {
      success: true,
      withdrawId: event.id,
      asset: key,
      amount: netAmount,
      fee,
      status: "completed", // Paper mode = instant completion
      timestamp,
    };
  }

  async getRecentEvents(limit = 50): Promise<MexcEvent[]> {
    const events = [...this.events].slice(-limit).reverse();
    return events.map((e) => this.mapToMexcEvent(e));
  }

  async notifyDeposit(asset: string, amount: number): Promise<void> {
    this.deposit(asset, amount, "External deposit notification");
  }

  // ============================================================
  // Internal Methods (preserved from original MexcPaper)
  // ============================================================

  /**
   * Add funds to paper account (simulates deposit arrival).
   */
  deposit(asset: string, amount: number, note?: string): PaperEvent {
    const key = asset.toUpperCase();
    const entry = ensureBalance(this.balances[key]);
    entry.available += amount;
    this.balances[key] = entry;
    const event: PaperEvent = {
      id: randomUUID(),
      type: "deposit",
      asset: key,
      amount,
      timestamp: nowIso(),
      note,
    };
    this.events.push(event);
    return event;
  }

  /**
   * Internal withdraw (for backward compatibility).
   */
  withdraw(asset: string, amount: number, note?: string): PaperEvent {
    const key = asset.toUpperCase();
    const entry = ensureBalance(this.balances[key]);
    if (entry.available < amount) {
      throw new Error(`Insufficient ${key} balance`);
    }
    entry.available -= amount;
    this.balances[key] = entry;
    const event: PaperEvent = {
      id: randomUUID(),
      type: "withdraw",
      asset: key,
      amount: -amount,
      timestamp: nowIso(),
      note,
    };
    this.events.push(event);
    return event;
  }

  private applyBalanceUpdates(updates: BalanceUpdate[]) {
    updates.forEach(({ asset, delta }) => {
      const key = asset.toUpperCase();
      const entry = ensureBalance(this.balances[key]);
      entry.available += delta;
      this.balances[key] = entry;
    });
  }

  /**
   * Execute a market order internally.
   */
  private executeMarketOrder(params: InternalMarketOrderParams): PaperEvent {
    const symbol = params.symbol.toUpperCase();
    const side = params.side;
    const quantity = params.quantity;
    if (quantity <= 0) {
      throw new Error("Quantity must be positive");
    }
    const price = params.price;
    if (price <= 0) {
      throw new Error("Price must be positive");
    }
    const feeBps = params.feeBps ?? DEFAULT_FEE_BPS;
    const feeAsset = (params.feeAsset ?? "USDT").toUpperCase();
    const { base, quote } = symbolToAssets(symbol);

    const notional = price * quantity;
    const fee = (notional * feeBps) / 10_000;

    const updates: BalanceUpdate[] = [];
    if (side === "BUY") {
      // Check quote balance
      const quoteBalance = this.balances[quote];
      if (!quoteBalance || quoteBalance.available < notional + fee) {
        throw new Error(`Insufficient ${quote} balance`);
      }
      updates.push({ asset: base, delta: quantity });
      updates.push({ asset: quote, delta: -notional });
    } else {
      // Check base balance
      const baseBalance = this.balances[base];
      if (!baseBalance || baseBalance.available < quantity) {
        throw new Error(`Insufficient ${base} balance`);
      }
      updates.push({ asset: base, delta: -quantity });
      updates.push({ asset: quote, delta: notional });
    }

    // Apply fee
    updates.push({ asset: feeAsset, delta: -fee });
    this.applyBalanceUpdates(updates);

    const event: PaperEvent = {
      id: randomUUID(),
      type: "trade",
      symbol,
      side,
      quantity,
      price,
      fee,
      feeAsset,
      baseDelta: updates.find((u) => u.asset === base)?.delta ?? 0,
      quoteDelta: updates.find((u) => u.asset === quote)?.delta ?? 0,
      timestamp: nowIso(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * Legacy marketOrder method for backward compatibility.
   */
  legacyMarketOrder(params: InternalMarketOrderParams): PaperEvent {
    return this.executeMarketOrder(params);
  }

  /**
   * Reset the paper account to initial state.
   */
  reset(init: Record<string, number>) {
    this.balances = {};
    Object.entries(init).forEach(([asset, amount]) => {
      this.balances[asset.toUpperCase()] = { available: amount, hold: 0 };
    });
    this.events = [];
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Get current price for a symbol (stub - should integrate with market data).
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    const { getMexcDepth } = await import("./market");
    const depth = await getMexcDepth(symbol, 1);
    if (depth.bids.length > 0 && depth.asks.length > 0) {
      return (depth.bids[0].price + depth.asks[0].price) / 2;
    }
    throw new Error(`No price available for ${symbol}`);
  }

  /**
   * Get withdrawal fee for an asset.
   */
  private getWithdrawFee(asset: string): number {
    const fees: Record<string, number> = {
      ZEPH: 0.1,
      USDT: 1.0,
    };
    return fees[asset.toUpperCase()] ?? 0;
  }

  /**
   * Map internal event to MexcEvent interface.
   */
  private mapToMexcEvent(event: PaperEvent): MexcEvent {
    if (event.type === "trade") {
      return {
        id: event.id,
        type: "trade",
        symbol: event.symbol,
        side: event.side,
        amount: event.quantity,
        price: event.price,
        fee: event.fee,
        timestamp: event.timestamp,
      };
    }
    return {
      id: event.id,
      type: event.type,
      asset: event.asset,
      amount: Math.abs(event.amount),
      timestamp: event.timestamp,
      status: "completed",
    };
  }
}

// ============================================================
// Backward Compatibility Export
// ============================================================

/**
 * @deprecated Use MexcPaperClient instead.
 */
export const MexcPaper = MexcPaperClient;
