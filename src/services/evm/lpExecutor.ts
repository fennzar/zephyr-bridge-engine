import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { privateKeyToAccount } from "viem/accounts";

import type { VenueOperationResult } from "@domain/execution";
import type { NetworkEnv } from "@shared";

import { getNetworkConfig } from "./config";
import { chainFromKey } from "./viemClient";
import { ensurePermit2Approval } from "./approval";

import type { LpMintParams, LpBurnParams, LpCollectParams } from "./executor";

// ============================================================
// LP-specific ABI
// ============================================================

const POSITION_MANAGER_ABI = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline) external payable",
  "function getPositionInfo(uint256 tokenId) external view returns (address poolId, int24 tickLower, int24 tickUpper, uint128 liquidity)",
  "function nextTokenId() external view returns (uint256)",
]);

/** Dependencies needed by LP executor functions. */
export interface LpExecutorDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  network: NetworkEnv;
}

/**
 * Add liquidity to a Uniswap V4 pool (mint a new position).
 *
 * Uses the V4 PositionManager pattern:
 *   actions = [MINT_POSITION, SETTLE_PAIR]
 *   Encode params per action, pack into modifyLiquidities(unlockData, deadline).
 */
export async function executeLpMint(
  deps: LpExecutorDeps,
  params: LpMintParams,
): Promise<VenueOperationResult & { tokenId?: bigint }> {
  const startTime = Date.now();
  const config = getNetworkConfig(deps.network);

  try {
    const positionManager = config.contracts?.positionManager;
    if (!positionManager) {
      return {
        success: false,
        error: "Position manager not configured for this network",
        durationMs: Date.now() - startTime,
      };
    }

    // Approve both tokens via Permit2 → PositionManager
    await ensurePermit2Approval(deps.publicClient, deps.walletClient, deps.account, deps.network, params.poolKey.currency0, positionManager, params.amount0Max);
    await ensurePermit2Approval(deps.publicClient, deps.walletClient, deps.account, deps.network, params.poolKey.currency1, positionManager, params.amount1Max);

    // V4 action codes
    const MINT_POSITION = 2;
    const SETTLE_PAIR = 13;

    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 600;

    // Encode MINT_POSITION params:
    // (PoolKey, int24 tickLower, int24 tickUpper, uint256 liquidity,
    //  uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData)
    const mintParams = encodeAbiParameters(
      parseAbiParameters([
        "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
        "int24",
        "int24",
        "uint256",
        "uint128",
        "uint128",
        "address",
        "bytes",
      ]),
      [
        {
          currency0: getAddress(params.poolKey.currency0) as Address,
          currency1: getAddress(params.poolKey.currency1) as Address,
          fee: params.poolKey.fee,
          tickSpacing: params.poolKey.tickSpacing,
          hooks: getAddress(params.poolKey.hooks) as Address,
        },
        params.tickLower,
        params.tickUpper,
        params.liquidity,
        params.amount0Max,
        params.amount1Max,
        deps.account.address,
        "0x" as Hex, // hookData
      ],
    );

    // Encode SETTLE_PAIR params: (address currency0, address currency1)
    const settleParams = encodeAbiParameters(
      parseAbiParameters(["address", "address"]),
      [
        getAddress(params.poolKey.currency0) as Address,
        getAddress(params.poolKey.currency1) as Address,
      ],
    );

    // Pack actions + params into unlockData
    const actions = new Uint8Array([MINT_POSITION, SETTLE_PAIR]);
    const unlockData = encodeAbiParameters(
      parseAbiParameters(["bytes", "bytes[]"]),
      [
        ("0x" + Buffer.from(actions).toString("hex")) as Hex,
        [mintParams, settleParams],
      ],
    );

    // Call modifyLiquidities
    const callData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [unlockData, BigInt(deadline)],
    });

    const hash = await deps.walletClient.sendTransaction({
      to: getAddress(positionManager),
      data: callData,
      account: deps.account,
      chain: chainFromKey(deps.network),
    });

    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      return {
        success: false,
        txHash: hash,
        error: "LP mint transaction reverted",
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    }

    // Parse Transfer event to get the new tokenId
    // ERC721 Transfer: Transfer(address from, address to, uint256 tokenId)
    // topic0 = keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
    let tokenId: bigint | undefined;
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === positionManager.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC &&
        log.topics.length === 4
      ) {
        tokenId = BigInt(log.topics[3]!);
        break;
      }
    }

    return {
      success: true,
      txHash: hash,
      tokenId,
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
 * Remove liquidity from a Uniswap V4 position.
 *
 * Uses V4 PositionManager pattern:
 *   actions = [DECREASE_LIQUIDITY, TAKE_PAIR]
 */
export async function executeLpBurn(
  deps: LpExecutorDeps,
  params: LpBurnParams,
): Promise<VenueOperationResult> {
  const startTime = Date.now();
  const config = getNetworkConfig(deps.network);

  try {
    const positionManager = config.contracts?.positionManager;
    if (!positionManager) {
      return {
        success: false,
        error: "Position manager not configured for this network",
        durationMs: Date.now() - startTime,
      };
    }

    const DECREASE_LIQUIDITY = 3;
    const TAKE_PAIR = 15;

    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 600;

    // Encode DECREASE_LIQUIDITY params:
    // (uint256 tokenId, PoolKey, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes hookData)
    const decreaseParams = encodeAbiParameters(
      parseAbiParameters([
        "uint256",
        "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
        "uint256",
        "uint128",
        "uint128",
        "bytes",
      ]),
      [
        params.tokenId,
        {
          currency0: getAddress(params.poolKey.currency0) as Address,
          currency1: getAddress(params.poolKey.currency1) as Address,
          fee: params.poolKey.fee,
          tickSpacing: params.poolKey.tickSpacing,
          hooks: getAddress(params.poolKey.hooks) as Address,
        },
        params.liquidity,
        params.amount0Min,
        params.amount1Min,
        "0x" as Hex, // hookData
      ],
    );

    // Encode TAKE_PAIR params: (address currency0, address currency1, address recipient)
    const takeParams = encodeAbiParameters(
      parseAbiParameters(["address", "address", "address"]),
      [
        getAddress(params.poolKey.currency0) as Address,
        getAddress(params.poolKey.currency1) as Address,
        deps.account.address,
      ],
    );

    // Pack actions + params
    const actions = new Uint8Array([DECREASE_LIQUIDITY, TAKE_PAIR]);
    const unlockData = encodeAbiParameters(
      parseAbiParameters(["bytes", "bytes[]"]),
      [
        ("0x" + Buffer.from(actions).toString("hex")) as Hex,
        [decreaseParams, takeParams],
      ],
    );

    const callData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [unlockData, BigInt(deadline)],
    });

    const hash = await deps.walletClient.sendTransaction({
      to: getAddress(positionManager),
      data: callData,
      account: deps.account,
      chain: chainFromKey(deps.network),
    });

    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      return {
        success: false,
        txHash: hash,
        error: "LP burn transaction reverted",
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
 * Collect fees from a Uniswap V4 position.
 *
 * In V4 fee collection is done by decreasing liquidity by 0 and then
 * taking the pair. This collects accrued fees without changing the position.
 */
export async function executeLpCollect(
  deps: LpExecutorDeps,
  params: LpCollectParams,
): Promise<VenueOperationResult & { amount0?: bigint; amount1?: bigint }> {
  const startTime = Date.now();
  const config = getNetworkConfig(deps.network);

  try {
    const positionManager = config.contracts?.positionManager;
    if (!positionManager) {
      return {
        success: false,
        error: "Position manager not configured for this network",
        durationMs: Date.now() - startTime,
      };
    }

    const DECREASE_LIQUIDITY = 3;
    const TAKE_PAIR = 15;

    const deadline = Math.floor(Date.now() / 1000) + 600;
    const recipient = params.recipient
      ? getAddress(params.recipient)
      : deps.account.address;

    // Decrease by 0 liquidity to collect fees only
    const decreaseParams = encodeAbiParameters(
      parseAbiParameters([
        "uint256",
        "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
        "uint256",
        "uint128",
        "uint128",
        "bytes",
      ]),
      [
        params.tokenId,
        {
          currency0: getAddress(params.poolKey.currency0) as Address,
          currency1: getAddress(params.poolKey.currency1) as Address,
          fee: params.poolKey.fee,
          tickSpacing: params.poolKey.tickSpacing,
          hooks: getAddress(params.poolKey.hooks) as Address,
        },
        0n, // zero liquidity = fee collection only
        0n, // no minimum for amount0
        0n, // no minimum for amount1
        "0x" as Hex,
      ],
    );

    // Take pair to recipient
    const takeParams = encodeAbiParameters(
      parseAbiParameters(["address", "address", "address"]),
      [
        getAddress(params.poolKey.currency0) as Address,
        getAddress(params.poolKey.currency1) as Address,
        recipient as Address,
      ],
    );

    const actions = new Uint8Array([DECREASE_LIQUIDITY, TAKE_PAIR]);
    const unlockData = encodeAbiParameters(
      parseAbiParameters(["bytes", "bytes[]"]),
      [
        ("0x" + Buffer.from(actions).toString("hex")) as Hex,
        [decreaseParams, takeParams],
      ],
    );

    const callData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [unlockData, BigInt(deadline)],
    });

    const hash = await deps.walletClient.sendTransaction({
      to: getAddress(positionManager),
      data: callData,
      account: deps.account,
      chain: chainFromKey(deps.network),
    });

    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      return {
        success: false,
        txHash: hash,
        error: "LP collect transaction reverted",
        durationMs: Date.now() - startTime,
        gasUsed: receipt.gasUsed,
      };
    }

    // Parse ERC20 Transfer events to determine collected amounts
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
    let amount0 = 0n;
    let amount1 = 0n;
    const c0 = params.poolKey.currency0.toLowerCase();
    const c1 = params.poolKey.currency1.toLowerCase();

    for (const log of receipt.logs) {
      if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
        const tokenAddr = log.address.toLowerCase();
        const value = BigInt(log.data);
        if (tokenAddr === c0) amount0 += value;
        else if (tokenAddr === c1) amount1 += value;
      }
    }

    return {
      success: true,
      txHash: hash,
      amount0,
      amount1,
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
