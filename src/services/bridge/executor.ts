import type { AssetId } from "@domain/types";
import type { VenueOperationResult } from "@domain/execution";
import { getTimingConfig, applyDelay } from "@domain/execution";

import { ZephyrWalletClient, type ZephyrTxResult } from "@services/zephyr/wallet";
import { EvmExecutor } from "@services/evm/executor";

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
  private simulateTiming: boolean;

  constructor(
    zephyrWallet: ZephyrWalletClient,
    evmExecutor: EvmExecutor,
    options?: { simulateTiming?: boolean },
  ) {
    this.zephyrWallet = zephyrWallet;
    this.evmExecutor = evmExecutor;
    this.simulateTiming = options?.simulateTiming ?? false;
  }

  /**
   * Wrap native assets to EVM (Native -> EVM).
   *
   * Flow:
   * 1. Send native assets to bridge address with EVM address as payment ID
   * 2. Wait for bridge confirmations (if timing enabled)
   * 3. Return voucher ID for claiming on EVM side
   */
  async wrap(params: WrapParams): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      // Step 1: Send to bridge from native wallet
      const txResult = await this.zephyrWallet.wrapToEvm(
        params.asset,
        params.amount,
        params.evmAddress,
      );

      if (!txResult.success) {
        return {
          success: false,
          error: txResult.error ?? "Failed to initiate wrap on native side",
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: Simulate bridge confirmation time if enabled
      if (this.simulateTiming) {
        await applyDelay("bridgeConfirmations");
      }

      // Step 3: Generate voucher ID (in reality, this comes from the bridge)
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
   * 1. Burn wrapped tokens on EVM with native destination address
   * 2. Wait for bridge processing (if timing enabled)
   * 3. Funds appear on native side (minus bridge fee)
   */
  async unwrap(params: UnwrapParams): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      // Convert wrapped asset to native asset ID format
      const nativeAsset = WRAPPED_TO_NATIVE[params.asset];
      if (!nativeAsset) {
        return {
          success: false,
          error: `Unknown wrapped asset: ${params.asset}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 1: Burn on EVM
      const burnResult = await this.evmExecutor.unwrapToNative({
        asset: params.asset,
        amount: params.amount,
        destinationAddress: params.nativeAddress,
      });

      if (!burnResult.success) {
        return {
          success: false,
          error: burnResult.error ?? "Failed to burn wrapped tokens",
          evmTxHash: burnResult.txHash,
          durationMs: Date.now() - startTime,
          gasUsed: burnResult.gasUsed,
        };
      }

      // Step 2: Simulate bridge processing time if enabled
      if (this.simulateTiming) {
        await applyDelay("bridgeConfirmations");
        // Also need to wait for Zephyr unlock time
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
  options?: { simulateTiming?: boolean },
): BridgeExecutor {
  return new BridgeExecutor(zephyrWallet, evmExecutor, options);
}

