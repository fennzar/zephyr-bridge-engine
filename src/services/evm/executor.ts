import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { AssetId } from "@domain/types";
import type { EvmPool } from "@domain/state/types";
import type { VenueOperationResult } from "@domain/execution";
import { env, type NetworkEnv } from "@shared";

import { getNetworkConfig } from "./config";
import { makePublicClient, makeWalletClient, chainFromKey } from "./viemClient";
import { ensureApproval, ERC20_ABI } from "./approval";
import { getTokenAddress, buildPoolKeyFromPool, isZeroForOne } from "./tokenUtils";
import {
  executeLpMint as _executeLpMint,
  executeLpBurn as _executeLpBurn,
  executeLpCollect as _executeLpCollect,
} from "./lpExecutor";

// Re-export sub-modules so the public API from executor.ts remains unchanged
export { ensureApproval, ensurePermit2Approval, ERC20_ABI, PERMIT2_ABI } from "./approval";
export { getTokenAddress, getTokenAddressFromSymbol, buildPoolKeyFromPool, isZeroForOne } from "./tokenUtils";
export { executeLpMint, executeLpBurn, executeLpCollect, type LpExecutorDeps } from "./lpExecutor";

/**
 * Parameters for executing an EVM swap.
 */
export interface EvmSwapParams {
  /** Source asset ID. */
  fromAsset: AssetId;
  /** Destination asset ID. */
  toAsset: AssetId;
  /** Amount to swap (in smallest unit). */
  amountIn: bigint;
  /** Minimum amount to receive (slippage protection). */
  amountOutMin: bigint;
  /** Pool to swap through. */
  pool: EvmPool;
  /** Optional deadline (unix timestamp). */
  deadline?: bigint;
}

/**
 * Result of an EVM swap execution.
 */
export interface EvmSwapResult extends VenueOperationResult {
  /** Actual amount received. */
  amountOut?: bigint;
}

/**
 * Parameters for unwrapping to native (EVM -> Zephyr).
 */
export interface EvmUnwrapParams {
  /** Wrapped asset to burn. */
  asset: AssetId;
  /** Amount to unwrap (in smallest unit). */
  amount: bigint;
  /** Destination address on Zephyr network. */
  destinationAddress: string;
}

/**
 * Parameters for claiming wrapped tokens from bridge (legacy voucher flow).
 */
export interface EvmClaimParams {
  /** Voucher/claim ID from the bridge. */
  voucherId: string;
}

/**
 * Parameters for claiming wrapped tokens via EIP-712 signature.
 */
export interface EvmClaimWithSignatureParams {
  /** Token contract address (e.g. wZEPH). */
  tokenAddress: string;
  /** Recipient EVM address. */
  to: string;
  /** Amount in wei. */
  amountWei: bigint;
  /** Zephyr transaction hash (will be formatted as bytes32). */
  zephTxId: string;
  /** Claim deadline (unix timestamp). */
  deadline: bigint;
  /** EIP-712 signature from bridge signer. */
  signature: string;
}

/**
 * Pool key for LP executor operations. Same shape as Uniswap V4 PoolKey
 * but uses plain strings instead of viem Address for flexibility.
 */
export interface LpPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

/**
 * Parameters for minting a new LP position on Uniswap V4.
 */
export interface LpMintParams {
  poolKey: LpPoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  slippageBps?: number;
  deadline?: number;
}

/**
 * Parameters for burning (removing liquidity from) an LP position.
 */
export interface LpBurnParams {
  tokenId: bigint;
  poolKey: LpPoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline?: number;
}

/**
 * Parameters for collecting fees from an LP position.
 */
export interface LpCollectParams {
  tokenId: bigint;
  poolKey: LpPoolKey;
  tickLower: number;
  tickUpper: number;
  recipient?: string;
}

/**
 * EVM Executor for on-chain operations.
 */
export class EvmExecutor {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private network: NetworkEnv;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: Hex, network?: NetworkEnv, rpcUrl?: string) {
    this.network = network ?? (env.ZEPHYR_ENV as NetworkEnv);
    const url = rpcUrl ?? env.RPC_URL_HTTP;

    if (!url) {
      throw new Error("RPC URL not configured");
    }

    this.account = privateKeyToAccount(privateKey);
    this.publicClient = makePublicClient(url, this.network) as PublicClient;
    this.walletClient = makeWalletClient(url, this.network, privateKey) as WalletClient;
  }

  /**
   * Get the executor's wallet address.
   */
  get address(): Address {
    return this.account.address;
  }

  /**
   * Get the network environment (local/sepolia/mainnet).
   */
  get networkEnv(): NetworkEnv {
    return this.network;
  }

  /**
   * Execute a swap on Uniswap V4.
   */
  async executeSwap(params: EvmSwapParams): Promise<EvmSwapResult> {
    const startTime = Date.now();
    const config = getNetworkConfig(this.network);

    try {
      const swapRouterAddress = config.contracts?.swapRouter;
      if (!swapRouterAddress) {
        return {
          success: false,
          error: "Swap router not configured for this network",
          durationMs: Date.now() - startTime,
        };
      }

      // Build pool key
      const poolKey = buildPoolKeyFromPool(params.pool, this.network);

      // Determine swap direction
      const zeroForOne = isZeroForOne(params.fromAsset, params.toAsset, params.pool, this.network);

      // Build swap parameters
      const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min default

      // Approve token if needed
      const tokenAddress = getTokenAddress(params.fromAsset, this.network);
      if (tokenAddress) {
        await ensureApproval(
          this.publicClient,
          this.walletClient,
          this.account,
          this.network,
          tokenAddress,
          swapRouterAddress,
          params.amountIn,
        );
      }

      // Build the swap call data using swapExactTokensForTokens
      const swapCallData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [
          params.amountIn,
          params.amountOutMin,
          zeroForOne,
          {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks,
          },
          "0x" as Hex,
          this.account.address,
          deadline,
        ],
      });

      // Execute the swap using sendTransaction
      const hash = await this.walletClient.sendTransaction({
        to: getAddress(swapRouterAddress),
        data: swapCallData,
        account: this.account,
        chain: chainFromKey(this.network),
      });

      // Wait for receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "reverted") {
        return {
          success: false,
          txHash: hash,
          error: "Transaction reverted",
          durationMs: Date.now() - startTime,
          gasUsed: receipt.gasUsed,
        };
      }

      // Parse amount out from logs (simplified - would need proper event parsing)
      const amountOut = await this.parseSwapOutput(receipt, params.toAsset);

      return {
        success: true,
        txHash: hash,
        amountOut,
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Unwrap wrapped tokens to native Zephyr (burn on EVM).
   */
  async unwrapToNative(params: EvmUnwrapParams): Promise<VenueOperationResult> {
    const startTime = Date.now();
    const config = getNetworkConfig(this.network);

    try {
      // Get bridge contract address
      const bridgeAddress = config.contracts?.bridge;
      if (!bridgeAddress) {
        return {
          success: false,
          error: "Bridge contract not configured for this network",
          durationMs: Date.now() - startTime,
        };
      }

      const tokenAddress = getTokenAddress(params.asset, this.network);
      if (!tokenAddress) {
        return {
          success: false,
          error: `Token address not found for ${params.asset}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Approve bridge to burn tokens
      await ensureApproval(
        this.publicClient,
        this.walletClient,
        this.account,
        this.network,
        tokenAddress,
        bridgeAddress,
        params.amount,
      );

      // Build the burn call data
      const burnCallData = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "burn",
        args: [getAddress(tokenAddress), params.amount, params.destinationAddress],
      });

      // Call burn function on bridge
      const hash = await this.walletClient.sendTransaction({
        to: getAddress(bridgeAddress),
        data: burnCallData,
        account: this.account,
        chain: chainFromKey(this.network),
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "reverted") {
        return {
          success: false,
          txHash: hash,
          error: "Burn transaction reverted",
          durationMs: Date.now() - startTime,
          gasUsed: receipt.gasUsed,
        };
      }

      return {
        success: true,
        txHash: hash,
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Call burnWithData() on a wrapped token contract to initiate an unwrap.
   * Used by BridgeExecutor after calling the bridge API /unwraps/prepare.
   */
  async burnWithData(params: {
    tokenAddress: string;
    amount: bigint;
    payload: Hex;
    nonce: Hex;
  }): Promise<VenueOperationResult> {
    const startTime = Date.now();

    try {
      const BURN_ABI = parseAbi([
        "function burnWithData(uint256 amount, bytes zephDestination, bytes32 nonce) external",
      ]);

      // Ensure nonce is a full bytes32 (pad to 32 bytes if needed)
      const nonceBytes32 = params.nonce.length < 66
        ? `0x${params.nonce.replace("0x", "").padStart(64, "0")}` as Hex
        : params.nonce;

      const callData = encodeFunctionData({
        abi: BURN_ABI,
        functionName: "burnWithData",
        args: [params.amount, params.payload, nonceBytes32],
      });

      const hash = await this.walletClient.sendTransaction({
        to: getAddress(params.tokenAddress),
        data: callData,
        account: this.account,
        chain: chainFromKey(this.network),
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "reverted") {
        return {
          success: false,
          txHash: hash,
          error: "burnWithData transaction reverted",
          durationMs: Date.now() - startTime,
          gasUsed: receipt.gasUsed,
        };
      }

      return {
        success: true,
        txHash: hash,
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "burnWithData failed",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Claim wrapped tokens from a bridge voucher.
   */
  async claimWrapped(params: EvmClaimParams): Promise<VenueOperationResult> {
    const startTime = Date.now();
    const config = getNetworkConfig(this.network);

    try {
      const bridgeAddress = config.contracts?.bridge;
      if (!bridgeAddress) {
        return {
          success: false,
          error: "Bridge contract not configured for this network",
          durationMs: Date.now() - startTime,
        };
      }

      // Build the claim call data
      const claimCallData = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "claim",
        args: [params.voucherId],
      });

      const hash = await this.walletClient.sendTransaction({
        to: getAddress(bridgeAddress),
        data: claimCallData,
        account: this.account,
        chain: chainFromKey(this.network),
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "reverted") {
        return {
          success: false,
          txHash: hash,
          error: "Claim transaction reverted",
          durationMs: Date.now() - startTime,
          gasUsed: receipt.gasUsed,
        };
      }

      return {
        success: true,
        txHash: hash,
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Claim wrapped tokens via EIP-712 signature (claimWithSignature on token contract).
   * This matches the bridge's claim flow: the bridge API produces a signed claim,
   * and anyone can submit it on-chain.
   */
  async claimWithSignature(params: EvmClaimWithSignatureParams): Promise<VenueOperationResult> {
    const startTime = Date.now();

    try {
      // Format zephTxId as bytes32 with 0x prefix, zero-padded to 64 hex chars
      const rawId = params.zephTxId.startsWith("0x")
        ? params.zephTxId.slice(2)
        : params.zephTxId;
      const zephTxIdBytes32 = ("0x" + rawId.padStart(64, "0")) as Hex;

      const callData = encodeFunctionData({
        abi: CLAIM_WITH_SIGNATURE_ABI,
        functionName: "claimWithSignature",
        args: [
          getAddress(params.to),
          params.amountWei,
          zephTxIdBytes32,
          params.deadline,
          params.signature as Hex,
        ],
      });

      const hash = await this.walletClient.sendTransaction({
        to: getAddress(params.tokenAddress),
        data: callData,
        account: this.account,
        chain: chainFromKey(this.network),
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "reverted") {
        return {
          success: false,
          txHash: hash,
          error: "claimWithSignature reverted",
          durationMs: Date.now() - startTime,
          gasUsed: receipt.gasUsed,
        };
      }

      return {
        success: true,
        txHash: hash,
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get native ETH balance.
   */
  async getEthBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address });
  }

  /**
   * Get ERC20 token balance.
   */
  async getTokenBalance(asset: AssetId): Promise<bigint> {
    const tokenAddress = getTokenAddress(asset, this.network);
    if (!tokenAddress) return 0n;

    const balance = await this.publicClient.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });

    return balance as bigint;
  }

  // ============================================================
  // LP Operations (delegate to standalone functions)
  // ============================================================

  /**
   * Add liquidity to a Uniswap V4 pool (mint a new position).
   */
  async executeLpMint(params: LpMintParams): Promise<VenueOperationResult & { tokenId?: bigint }> {
    return _executeLpMint(
      {
        publicClient: this.publicClient,
        walletClient: this.walletClient,
        account: this.account,
        network: this.network,
      },
      params,
    );
  }

  /**
   * Remove liquidity from a Uniswap V4 position.
   */
  async executeLpBurn(params: LpBurnParams): Promise<VenueOperationResult> {
    return _executeLpBurn(
      {
        publicClient: this.publicClient,
        walletClient: this.walletClient,
        account: this.account,
        network: this.network,
      },
      params,
    );
  }

  /**
   * Collect fees from a Uniswap V4 position.
   */
  async executeLpCollect(params: LpCollectParams): Promise<VenueOperationResult & { amount0?: bigint; amount1?: bigint }> {
    return _executeLpCollect(
      {
        publicClient: this.publicClient,
        walletClient: this.walletClient,
        account: this.account,
        network: this.network,
      },
      params,
    );
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private async parseSwapOutput(
    receipt: { logs: readonly { data: Hex; topics: readonly Hex[] }[] },
    toAsset: AssetId,
  ): Promise<bigint | undefined> {
    // Simplified output parsing - would need proper log decoding
    // for Uniswap V4 Swap events
    return undefined;
  }
}

// ============================================================
// ABIs (minimal required functions) — kept here for swap/bridge ops
// ============================================================

const SWAP_ROUTER_ABI = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, bool zeroForOne, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bytes hookData, address receiver, uint256 deadline) external payable returns (int256)",
]);

const BRIDGE_ABI = parseAbi([
  "function burn(address token, uint256 amount, string destinationAddress) external",
  "function claim(string voucherId) external",
]);

const CLAIM_WITH_SIGNATURE_ABI = parseAbi([
  "function claimWithSignature(address to, uint256 amount, bytes32 zephTxId, uint256 deadline, bytes signature) external",
]);

/**
 * Factory function to create an EVM executor.
 */
export function createEvmExecutor(
  privateKey?: Hex,
  network?: NetworkEnv,
  rpcUrl?: string,
): EvmExecutor {
  const raw = privateKey ?? env.EVM_PRIVATE_KEY;
  if (!raw) {
    throw new Error("EVM_PRIVATE_KEY not configured");
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return new EvmExecutor(key, network, rpcUrl);
}
