import type { AssetId } from "@domain/types";
import type { VenueOperationResult } from "@domain/execution";
import { applyDelay } from "@domain/execution";
import { createLogger } from "@shared/logger";

import { ZephyrWalletClient, type ZephyrTxResult } from "@services/zephyr/wallet";
import { EvmExecutor } from "@services/evm/executor";
import { BridgeApiClient } from "./apiClient";
import { getTokenAddress } from "@services/evm/tokenUtils";

const log = createLogger("BridgeExec");

/**
 * Native asset types that can be bridged.
 */
export type NativeAsset = "ZEPH" | "ZSD" | "ZRS" | "ZYS";

/**
 * Wrapped asset types on EVM.
 */
export type WrappedAsset = "WZEPH.e" | "WZSD.e" | "WZRS.e" | "WZYS.e";

/**
 * Mapping from native to wrapped assets.
 */
const NATIVE_TO_WRAPPED: Record<NativeAsset, WrappedAsset> = {
  ZEPH: "WZEPH.e",
  ZSD: "WZSD.e",
  ZRS: "WZRS.e",
  ZYS: "WZYS.e",
};

/**
 * Mapping from wrapped to native assets.
 */
const WRAPPED_TO_NATIVE: Record<WrappedAsset, NativeAsset> = {
  "WZEPH.e": "ZEPH",
  "WZSD.e": "ZSD",
  "WZRS.e": "ZRS",
  "WZYS.e": "ZYS",
};

/**
 * Parameters for wrapping native to EVM.
 */
export interface WrapParams {
  /** Native asset type to wrap. */
  asset: NativeAsset;
  /** Amount to wrap (in atomic units). */
  amount: bigint;
  /** EVM address to receive wrapped tokens. */
  evmAddress: string;
}

/**
 * Parameters for unwrapping EVM to native.
 */
export interface UnwrapParams {
  /** Wrapped asset type to unwrap. */
  asset: WrappedAsset;
  /** Amount to unwrap (in atomic units). */
  amount: bigint;
  /** Native Zephyr address to receive funds. */
  nativeAddress: string;
}

/**
 * Status of a bridge voucher.
 */
export type VoucherStatus =
  | "pending"
  | "ready_to_claim"
  | "claimed"
  | "expired"
  | "unknown";

/**
 * Voucher information.
 */
export interface VoucherInfo {
  id: string;
  status: VoucherStatus;
  asset?: NativeAsset | WrappedAsset;
  amount?: bigint;
  createdAt?: string;
  claimableAt?: string;
}

/**
 * Result of a bridge operation.
 */
export interface BridgeResult extends VenueOperationResult {
  /** Voucher ID for tracking (wrap creates a claim voucher). */
  voucherId?: string;
  /** Native transaction hash (for wrap). */
  nativeTxHash?: string;
  /** EVM transaction hash (for unwrap/claim). */
  evmTxHash?: string;
}

/**
 * Bridge executor for coordinating wrap/unwrap operations.
 */
export class BridgeExecutor {
  private zephyrWallet: ZephyrWalletClient;
  private evmExecutor: EvmExecutor;
  private bridgeApi: BridgeApiClient;
  private simulateTiming: boolean;

  constructor(
    zephyrWallet: ZephyrWalletClient,
    evmExecutor: EvmExecutor,
    bridgeApi?: BridgeApiClient,
    options?: { simulateTiming?: boolean },
  ) {
    this.zephyrWallet = zephyrWallet;
    this.evmExecutor = evmExecutor;
    this.bridgeApi = bridgeApi ?? new BridgeApiClient();
    this.simulateTiming = options?.simulateTiming ?? false;
  }

  /**
   * Wrap native assets to EVM (Native -> EVM).
   *
   * Flow:
   * 1. Get bridge subaddress for the EVM address via bridge API
   * 2. Send native assets to that subaddress (no payment ID needed)
   * 3. Bridge watcher detects deposit and issues a claimable voucher
   */
  async wrap(params: WrapParams): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      // Step 1: Get bridge subaddress for our EVM address
      log.info(`Getting bridge subaddress for ${params.evmAddress}`);
      const bridgeSubaddress = await this.bridgeApi.createBridgeAccount(params.evmAddress);
      log.info(`Bridge subaddress: ${bridgeSubaddress.slice(0, 20)}...`);

      // Step 2: Send native asset to bridge subaddress
      const txResult = await this.zephyrWallet.transfer({
        address: bridgeSubaddress,
        amount: typeof params.amount === "bigint" ? params.amount : BigInt(params.amount),
        assetType: params.asset,
      });

      if (!txResult.success) {
        return {
          success: false,
          error: txResult.error ?? "Failed to send to bridge subaddress",
          durationMs: Date.now() - startTime,
        };
      }

      log.info(`Wrap tx sent: ${txResult.txHash}`);

      // Step 3: Simulate bridge confirmation time if enabled
      if (this.simulateTiming) {
        await applyDelay("bridgeConfirmations");
      }

      const voucherId = this.generateVoucherId(txResult.txHash ?? "");

      return {
        success: true,
        nativeTxHash: txResult.txHash,
        voucherId,
        durationMs: Date.now() - startTime,
        feePaid: txResult.fee,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during wrap",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Unwrap EVM assets to native (EVM -> Native).
   *
   * Flow:
   * 1. Call bridge API /unwraps/prepare to pre-sign the Zephyr transfer
   * 2. Call burnWithData() on the wrapped token contract
   * 3. Bridge watcher detects burn, relays the pre-signed tx
   * 4. Funds appear on native side (minus bridge fee)
   */
  async unwrap(params: UnwrapParams): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      const nativeAsset = WRAPPED_TO_NATIVE[params.asset];
      if (!nativeAsset) {
        return {
          success: false,
          error: `Unknown wrapped asset: ${params.asset}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Resolve the token contract address
      const tokenAddress = getTokenAddress(params.asset, this.evmExecutor.networkEnv);
      if (!tokenAddress) {
        return {
          success: false,
          error: `Token address not found for ${params.asset}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 1: Prepare unwrap via bridge API (pre-signs Zephyr transfer)
      log.info(`Preparing unwrap: ${params.asset} amount=${params.amount} dest=${params.nativeAddress}`);
      const prepared = await this.bridgeApi.prepareUnwrap({
        token: tokenAddress,
        amountWei: params.amount.toString(),
        destination: params.nativeAddress,
      });
      log.info(`Unwrap prepared: txHash=${prepared.txHash} netWei=${prepared.netWei}`);

      // Step 2: Call burnWithData() on the token contract
      const burnResult = await this.evmExecutor.burnWithData({
        tokenAddress,
        amount: params.amount,
        payload: prepared.payload as `0x${string}`,
        nonce: prepared.txHash as `0x${string}`,
      });

      if (!burnResult.success) {
        return {
          success: false,
          error: burnResult.error ?? "burnWithData failed",
          evmTxHash: burnResult.txHash,
          durationMs: Date.now() - startTime,
          gasUsed: burnResult.gasUsed,
        };
      }

      log.info(`Burn success: txHash=${burnResult.txHash}`);

      // Step 3: Wait for bridge watcher to process and relay
      if (this.simulateTiming) {
        await applyDelay("bridgeConfirmations");
        await applyDelay("zephyrUnlock");
      }

      return {
        success: true,
        evmTxHash: burnResult.txHash,
        durationMs: Date.now() - startTime,
        gasUsed: burnResult.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during unwrap",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Claim wrapped tokens using a voucher (after wrap).
   *
   * Called after wrap() when funds are ready on EVM side.
   */
  async claimWrapped(voucherId: string): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      const claimResult = await this.evmExecutor.claimWrapped({ voucherId });

      if (!claimResult.success) {
        return {
          success: false,
          error: claimResult.error ?? "Failed to claim wrapped tokens",
          evmTxHash: claimResult.txHash,
          durationMs: Date.now() - startTime,
          gasUsed: claimResult.gasUsed,
        };
      }

      return {
        success: true,
        evmTxHash: claimResult.txHash,
        voucherId,
        durationMs: Date.now() - startTime,
        gasUsed: claimResult.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during claim",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check the status of a bridge voucher.
   */
  async checkVoucherStatus(voucherId: string): Promise<VoucherInfo> {
    // In a real implementation, this would query the bridge contract or API.
    // For now, return unknown status.
    return {
      id: voucherId,
      status: "unknown",
    };
  }

  /**
   * Get the wrapped asset for a native asset.
   */
  getWrappedAsset(native: NativeAsset): WrappedAsset {
    return NATIVE_TO_WRAPPED[native];
  }

  /**
   * Get the native asset for a wrapped asset.
   */
  getNativeAsset(wrapped: WrappedAsset): NativeAsset {
    return WRAPPED_TO_NATIVE[wrapped];
  }

  /**
   * Check if an asset ID is a wrapped asset.
   */
  isWrappedAsset(asset: AssetId): asset is WrappedAsset {
    return asset in WRAPPED_TO_NATIVE;
  }

  /**
   * Check if an asset ID is a native asset that can be wrapped.
   */
  isNativeAsset(asset: string): asset is NativeAsset {
    return asset in NATIVE_TO_WRAPPED;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private generateVoucherId(txHash: string): string {
    // Generate a voucher ID from the native tx hash
    // In reality, this would come from the bridge
    const timestamp = Date.now().toString(36);
    const hashPart = txHash.slice(0, 16) || "unknown";
    return `voucher_${timestamp}_${hashPart}`;
  }
}

/**
 * Create a bridge executor instance.
 */
export function createBridgeExecutor(
  zephyrWallet: ZephyrWalletClient,
  evmExecutor: EvmExecutor,
  bridgeApi?: BridgeApiClient,
  options?: { simulateTiming?: boolean },
): BridgeExecutor {
  return new BridgeExecutor(zephyrWallet, evmExecutor, bridgeApi, options);
}

