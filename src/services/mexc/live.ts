import type { ExecutionMode } from "@domain/execution";
import { env } from "@shared";

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
import { MexcRest } from "./rest";
import { getCexWalletClient } from "../cex/client";

/**
 * Live implementation of IMexcClient using real MEXC API.
 */
export class MexcLiveClient implements IMexcClient {
  readonly mode: ExecutionMode = "live";

  private rest: MexcRest;

  constructor(apiKey?: string, apiSecret?: string) {
    const key = apiKey ?? env.MEXC_API_KEY;
    const secret = apiSecret ?? env.MEXC_API_SECRET;

    if (!key || !secret) {
      throw new Error("MEXC API credentials required for live mode");
    }

    this.rest = new MexcRest({
      apiKey: key,
      apiSecret: secret,
    });
  }

  async getBalances(): Promise<MexcBalances> {
    const account = await this.rest.account();
    const result: MexcBalances = {};

    if (account.balances && Array.isArray(account.balances)) {
      for (const balance of account.balances) {
        const asset = String(balance.asset ?? "").toUpperCase();
        if (!asset) continue;

        result[asset] = {
          asset,
          available: parseFloat(balance.free ?? "0"),
          locked: parseFloat(balance.locked ?? "0"),
        };
      }
    }

    return result;
  }

  async getBalance(asset: string): Promise<MexcBalance | null> {
    const balances = await this.getBalances();
    return balances[asset.toUpperCase()] ?? null;
  }

  async marketOrder(params: MexcMarketOrderParams): Promise<MexcOrderResult> {
    const { symbol, side, quantity, quoteOrderQty } = params;
    const timestamp = new Date().toISOString();

    try {
      const orderParams: {
        symbol: string;
        side: "BUY" | "SELL";
        type: "MARKET";
        quantity?: string;
        quoteOrderQty?: string;
      } = {
        symbol: symbol.toUpperCase().replace("_", ""),
        side,
        type: "MARKET",
      };

      if (quoteOrderQty !== undefined) {
        orderParams.quoteOrderQty = quoteOrderQty.toString();
      } else {
        orderParams.quantity = quantity.toString();
      }

      const response = await this.rest.order(orderParams);

      // Parse MEXC order response
      const executedQty = parseFloat(response.executedQty ?? "0");
      const cummulativeQuoteQty = parseFloat(response.cummulativeQuoteQty ?? "0");
      const executedPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;

      // Calculate fee (usually in fills array)
      let fee = 0;
      let feeAsset = "USDT";
      if (response.fills && Array.isArray(response.fills)) {
        for (const fill of response.fills) {
          fee += parseFloat(fill.commission ?? "0");
          feeAsset = fill.commissionAsset ?? feeAsset;
        }
      }

      return {
        success: true,
        orderId: String(response.orderId ?? ""),
        symbol: response.symbol ?? symbol,
        side,
        executedQty,
        executedPrice,
        fee,
        feeAsset,
        timestamp,
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

  async getDepositAddress(asset: string, network?: string): Promise<MexcDepositAddress> {
    // MEXC deposit address endpoint: GET /api/v3/capital/deposit/address
    // For now, we'll need to extend MexcRest or call directly.
    // Placeholder implementation - extend as needed.
    throw new Error(
      `getDepositAddress not yet implemented for live mode. Asset: ${asset}, Network: ${network}`,
    );
  }

  async requestWithdraw(params: MexcWithdrawParams): Promise<MexcWithdrawResult> {
    // MEXC withdrawal endpoint: POST /api/v3/capital/withdraw
    // For now, we'll need to extend MexcRest or call directly.
    // Placeholder implementation - extend as needed.
    const { asset, amount } = params;
    throw new Error(
      `requestWithdraw not yet implemented for live mode. Asset: ${asset}, Amount: ${amount}`,
    );
  }

  async getRecentEvents(limit = 50): Promise<MexcEvent[]> {
    // This would require fetching order history and deposit/withdraw history.
    // Placeholder implementation.
    return [];
  }

  async notifyDeposit(_asset: string, _amount: number): Promise<void> {
    // In live mode, deposits are detected automatically.
    // This is a no-op, but could trigger a balance refresh.
  }
}

/**
 * Factory function to create MEXC client based on execution mode.
 *
 * - paper/devnet: Uses CexWalletClient backed by real CEX wallets.
 * - live: Uses MexcLiveClient which calls real MEXC API (unless MEXC_PAPER override).
 */
export function createMexcClient(mode?: ExecutionMode): IMexcClient {
  if (mode === "live" && !env.MEXC_PAPER) {
    return new MexcLiveClient();
  }

  return getCexWalletClient(mode);
}

