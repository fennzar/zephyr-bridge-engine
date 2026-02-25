/**
 * CexWalletClient — implements IMexcClient backed by real wallets.
 *
 * Replaces the old MexcPaperCexClient + papercex DB service.
 *
 * - ZEPH balance: read from CEX Zephyr wallet (port 48772)
 * - USDT balance: read from CEX EVM wallet (ERC-20)
 * - Trades: accounting-only (no real exchange — price from fake orderbook)
 * - Deposits: real Zephyr / EVM transfers INTO the CEX wallets
 * - Withdrawals: real Zephyr / EVM transfers OUT of the CEX wallets
 */

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
} from "@services/mexc/client";

import * as cexRpc from "./rpc";
import * as cexEvm from "./evm";

const ATOMIC = 1e12;

/**
 * Fetch the mid price from the fake orderbook (same source as old paper client).
 */
async function getMidPrice(): Promise<number> {
  try {
    const { getMexcDepth } = await import("@services/mexc/market");
    const depth = await getMexcDepth("ZEPHUSDT", 1);
    if (depth.bids.length > 0 && depth.asks.length > 0) {
      return (depth.bids[0].price + depth.asks[0].price) / 2;
    }
  } catch {
    // fallback
  }
  return 0.5;
}

/**
 * IMexcClient implementation backed by real CEX wallets.
 */
export class CexWalletClient implements IMexcClient {
  readonly mode: ExecutionMode;

  constructor(mode: ExecutionMode = "devnet") {
    this.mode = mode;
  }

  async getBalances(): Promise<MexcBalances> {
    const [zephBal, usdtBal] = await Promise.all([
      cexRpc.getZephBalance().catch(() => ({ total: 0, unlocked: 0 })),
      cexEvm.getUsdtBalance().catch(() => 0),
    ]);

    return {
      ZEPH: {
        asset: "ZEPH",
        available: zephBal.unlocked,
        locked: zephBal.total - zephBal.unlocked,
      },
      USDT: {
        asset: "USDT",
        available: usdtBal,
        locked: 0,
      },
    };
  }

  async getBalance(asset: string): Promise<MexcBalance | null> {
    const balances = await this.getBalances();
    return balances[asset.toUpperCase()] ?? null;
  }

  async marketOrder(params: MexcMarketOrderParams): Promise<MexcOrderResult> {
    const { symbol, side, quantity } = params;
    const timestamp = new Date().toISOString();

    // Accounting-only: get price, return success.
    // The actual fund movement happens via deposit/withdraw steps in the arb flow.
    const price = await getMidPrice();
    const usdtAmount = quantity * price;
    const fee = (usdtAmount * 10) / 10_000; // 0.10% fee

    return {
      success: true,
      orderId: `cex-${Date.now()}`,
      symbol,
      side,
      executedQty: quantity,
      executedPrice: price,
      fee,
      feeAsset: "USDT",
      timestamp,
    };
  }

  async getDepositAddress(asset: string, _network?: string): Promise<MexcDepositAddress> {
    const key = asset.toUpperCase();

    if (key === "ZEPH") {
      const address = await cexRpc.getAddress();
      return { asset: key, address, network: "ZEPHYR" };
    }

    if (key === "USDT") {
      return { asset: key, address: cexEvm.getAddress(), network: "ERC20" };
    }

    throw new Error(`CEX deposit not supported for asset: ${key}`);
  }

  async requestWithdraw(params: MexcWithdrawParams): Promise<MexcWithdrawResult> {
    const { asset, amount, address } = params;
    const key = asset.toUpperCase();
    const timestamp = new Date().toISOString();

    try {
      if (key === "ZEPH") {
        const amountAtomic = BigInt(Math.round(amount * ATOMIC));
        const result = await cexRpc.transfer(address, amountAtomic);
        return {
          success: true,
          withdrawId: result.txHash,
          asset: key,
          amount,
          fee: Number(result.fee) / ATOMIC,
          status: "completed",
          timestamp,
        };
      }

      if (key === "USDT") {
        const txHash = await cexEvm.transferUsdt(address, amount);
        return {
          success: true,
          withdrawId: txHash,
          asset: key,
          amount,
          fee: 0,
          status: "completed",
          timestamp,
        };
      }

      return {
        success: false,
        withdrawId: "",
        asset: key,
        amount,
        fee: 0,
        status: "failed",
        timestamp,
        error: `Withdrawal not supported for asset: ${key}`,
      };
    } catch (error) {
      return {
        success: false,
        withdrawId: "",
        asset: key,
        amount,
        fee: 0,
        status: "failed",
        timestamp,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getRecentEvents(_limit?: number): Promise<MexcEvent[]> {
    return [];
  }

  async notifyDeposit(_asset: string, _amount: number): Promise<void> {
    // No-op — balances are on-chain, no scanning needed.
  }
}

// ---------------------------------------------------------------------------
// Convenience: read CEX balances for balance snapshots
// ---------------------------------------------------------------------------

export async function getCexBalances(): Promise<{ ZEPH: number; USDT: number }> {
  const [zephBal, usdtBal] = await Promise.all([
    cexRpc.getZephBalance().catch(() => ({ total: 0, unlocked: 0 })),
    cexEvm.getUsdtBalance().catch(() => 0),
  ]);
  return { ZEPH: zephBal.unlocked, USDT: usdtBal };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: CexWalletClient | null = null;

export function getCexWalletClient(mode?: ExecutionMode): CexWalletClient {
  if (!_instance) {
    _instance = new CexWalletClient(mode);
  }
  return _instance;
}
