import { env } from "@shared";

/**
 * Zephyr wallet balance structure.
 */
export interface ZephyrWalletBalance {
  /** Balance in ZEPH. */
  zeph: bigint;
  /** Balance in ZSD (stable). */
  zsd: bigint;
  /** Balance in ZRS (reserve). */
  zrs: bigint;
  /** Balance in ZYS (yield). */
  zys: bigint;
  /** Unlocked ZEPH (available to spend). */
  unlockedZeph: bigint;
  /** Unlocked ZSD. */
  unlockedZsd: bigint;
  /** Unlocked ZRS. */
  unlockedZrs: bigint;
  /** Unlocked ZYS. */
  unlockedZys: bigint;
}

/**
 * Result of a Zephyr transaction.
 */
export interface ZephyrTxResult {
  success: boolean;
  txHash?: string;
  fee?: bigint;
  error?: string;
}

/**
 * Parameters for a transfer operation.
 */
export interface ZephyrTransferParams {
  /** Destination address. */
  address: string;
  /** Amount to send (in atomic units). */
  amount: bigint;
  /** Asset type to send. */
  assetType: "ZEPH" | "ZSD" | "ZRS" | "ZYS";
  /** Optional payment ID. */
  paymentId?: string;
}

/**
 * Zephyr wallet RPC response wrapper.
 */
interface WalletRpcResponse<T> {
  id: string;
  jsonrpc: string;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Balance response from wallet RPC.
 */
interface GetBalanceResult {
  balance: string;
  unlocked_balance: string;
  stable_balance: string;
  stable_unlocked_balance: string;
  reserve_balance: string;
  reserve_unlocked_balance: string;
  yield_balance: string;
  yield_unlocked_balance: string;
}

/**
 * Transfer response from wallet RPC.
 */
interface TransferResult {
  tx_hash: string;
  fee: string;
}

/**
 * Pricing conversion result.
 */
interface PricingResult {
  pricing_record_height: number;
  expected_amount: string;
}

/**
 * Map conversion method names to (source_asset, destination_asset) pairs.
 * The Zephyr wallet uses a single "transfer" RPC method for all conversions,
 * distinguished by source_asset/destination_asset parameters.
 */
const CONVERSION_ASSETS: Record<string, { source: string; destination: string }> = {
  mint_stable:   { source: "ZPH", destination: "ZSD" },
  redeem_stable: { source: "ZSD", destination: "ZPH" },
  mint_reserve:  { source: "ZPH", destination: "ZRS" },
  redeem_reserve:{ source: "ZRS", destination: "ZPH" },
  mint_yield:    { source: "ZSD", destination: "ZYS" },
  redeem_yield:  { source: "ZYS", destination: "ZSD" },
};

const HEADERS: HeadersInit = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

function getWalletRpcUrl(): string {
  return env.ZEPHYR_WALLET_RPC_URL ?? "http://localhost:28080/json_rpc";
}

async function walletRpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const url = getWalletRpcUrl();
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method,
    params: params ?? {},
  };

  const response = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zephyr wallet RPC ${method} failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as WalletRpcResponse<T>;

  if (data.error) {
    throw new Error(`Zephyr wallet RPC error: ${data.error.code} ${data.error.message}`);
  }

  if (data.result === undefined) {
    throw new Error(`Zephyr wallet RPC ${method}: no result returned`);
  }

  return data.result;
}

function parseBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Client for interacting with a Zephyr wallet via RPC.
 */
export class ZephyrWalletClient {
  /**
   * Get current wallet balance for all asset types.
   */
  async getBalance(): Promise<ZephyrWalletBalance> {
    const result = await walletRpc<GetBalanceResult>("get_balance", { all_assets: true });

    return {
      zeph: parseBigInt(result.balance),
      zsd: parseBigInt(result.stable_balance),
      zrs: parseBigInt(result.reserve_balance),
      zys: parseBigInt(result.yield_balance),
      unlockedZeph: parseBigInt(result.unlocked_balance),
      unlockedZsd: parseBigInt(result.stable_unlocked_balance),
      unlockedZrs: parseBigInt(result.reserve_unlocked_balance),
      unlockedZys: parseBigInt(result.yield_unlocked_balance),
    };
  }

  /**
   * Transfer funds to an address.
   */
  async transfer(params: ZephyrTransferParams): Promise<ZephyrTxResult> {
    // Map to V2 asset names the wallet RPC expects
    const v2Name: Record<string, string> = {
      ZEPH: "ZPH",
      ZSD: "ZSD",
      ZRS: "ZRS",
      ZYS: "ZYS",
    };
    const asset = v2Name[params.assetType] ?? "ZPH";

    try {
      const result = await walletRpc<TransferResult>("transfer", {
        destinations: [
          {
            address: params.address,
            amount: params.amount.toString(),
          },
        ],
        source_asset: asset,
        destination_asset: asset,
        payment_id: params.paymentId,
        get_tx_key: true,
      });

      return {
        success: true,
        txHash: result.tx_hash,
        fee: parseBigInt(result.fee),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Convert ZEPH to ZSD (mint stable).
   */
  async mintStable(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("mint_stable", amount);
  }

  /**
   * Convert ZSD to ZEPH (redeem stable).
   */
  async redeemStable(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("redeem_stable", amount);
  }

  /**
   * Convert ZEPH to ZRS (mint reserve).
   */
  async mintReserve(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("mint_reserve", amount);
  }

  /**
   * Convert ZRS to ZEPH (redeem reserve).
   */
  async redeemReserve(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("redeem_reserve", amount);
  }

  /**
   * Convert ZSD to ZYS (mint yield).
   */
  async mintYield(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("mint_yield", amount);
  }

  /**
   * Convert ZYS to ZSD (redeem yield).
   */
  async redeemYield(amount: bigint): Promise<ZephyrTxResult> {
    return this.doConversion("redeem_yield", amount);
  }

  /**
   * Get pricing for a conversion (preview without executing).
   */
  async getPricing(
    conversionType: "mint_stable" | "redeem_stable" | "mint_reserve" | "redeem_reserve" | "mint_yield" | "redeem_yield",
    amount: bigint,
  ): Promise<{ expectedAmount: bigint; height: number }> {
    const result = await walletRpc<PricingResult>("get_pricing", {
      conversion_type: conversionType,
      amount: amount.toString(),
    });

    return {
      expectedAmount: parseBigInt(result.expected_amount),
      height: result.pricing_record_height,
    };
  }

  /**
   * Initiate a wrap operation (native -> EVM).
   * This sends to the bridge address with appropriate metadata.
   */
  async wrapToEvm(
    assetType: "ZEPH" | "ZSD" | "ZRS" | "ZYS",
    amount: bigint,
    evmAddress: string,
  ): Promise<ZephyrTxResult> {
    // The bridge address would come from configuration.
    // The EVM address is included as payment_id or integrated field.
    const bridgeAddress = env.ZEPHYR_BRIDGE_ADDRESS;

    if (!bridgeAddress) {
      return {
        success: false,
        error: "ZEPHYR_BRIDGE_ADDRESS not configured",
      };
    }

    // Format EVM address as payment_id (32 bytes, zero-padded)
    const paymentId = evmAddress.toLowerCase().replace("0x", "").padStart(64, "0");

    return this.transfer({
      address: bridgeAddress,
      amount,
      assetType,
      paymentId,
    });
  }

  /**
   * Get wallet address.
   */
  async getAddress(): Promise<string> {
    const result = await walletRpc<{ address: string }>("get_address");
    return result.address;
  }

  /**
   * Check if wallet is connected and synced.
   */
  async isReady(): Promise<boolean> {
    try {
      await walletRpc<{ height: number }>("get_height");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Internal conversion method.
   * Uses the "transfer" RPC with source_asset/destination_asset to convert
   * between asset types (e.g., ZSD→ZPH for redeem_stable).
   * Sends to own address since conversions are self-transfers.
   */
  private async doConversion(
    method: string,
    amount: bigint,
  ): Promise<ZephyrTxResult> {
    const assets = CONVERSION_ASSETS[method];
    if (!assets) {
      return { success: false, error: `Unknown conversion type: ${method}` };
    }

    try {
      // Get own address — conversions send to self
      const { address } = await walletRpc<{ address: string }>("get_address", { account_index: 0 });

      // Zephyr wallet enforces max 4 decimal places for mint/redeem.
      // With 12-decimal atomic units, truncate to nearest 10^8.
      // Ensure amount is BigInt (may be string after JSON deserialization).
      const amountBn = typeof amount === "bigint" ? amount : BigInt(amount);
      const PRECISION_MASK = 100_000_000n; // 10^8
      const truncatedAmount = (amountBn / PRECISION_MASK) * PRECISION_MASK;

      const result = await walletRpc<TransferResult>("transfer", {
        destinations: [{ amount: truncatedAmount.toString(), address }],
        source_asset: assets.source,
        destination_asset: assets.destination,
        priority: 0,
        ring_size: 2,
        get_tx_key: true,
      });

      return {
        success: true,
        txHash: result.tx_hash,
        fee: parseBigInt(result.fee),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * Create a Zephyr wallet client instance.
 */
export function createZephyrWalletClient(): ZephyrWalletClient {
  return new ZephyrWalletClient();
}

