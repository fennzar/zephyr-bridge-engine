import {
  PoolProtocol,
  Prisma,
  prisma,
  type Pool as DbPool,
} from "@infra";
import { fetchPositionDetails } from "../positionManager";
import type { EvmLogger } from "../logging";
import type { DbPort } from "./eventLogHandler";
import type { NetworkEnv } from "@shared";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import {
  priceFromSqrtPrice,
  Q96_DECIMAL,
} from "./persistence.math";

import {
  metadataToRecord,
  decimalFromBigInt,
  toLowerAddress,
  serializePoolKey,
  isUniqueConstraintError,
  indexTrackedTokens,
  parseTokenId,
  type DbTokenLike,
} from "./persistence.utils";

import { ensureToken } from "./persistence.token";
import { recomputePoolMetrics } from "./persistence.metrics";
import { upsertPositionFromModify } from "./persistence.position";

// Re-export sub-modules so the public API from persistence.ts remains unchanged
export * from "./persistence.math";
export * from "./persistence.utils";
export * from "./persistence.token";
export * from "./persistence.metrics";
export * from "./persistence.position";

export type PrismaDbPortOptions = {
  network: NetworkEnv;
  chainId: number;
  poolManagerAddress: Address;
  positionManagerAddress: Address;
  publicClient: PublicClient;
  logger: EvmLogger;
  prismaClient?: typeof prisma;
};

export class PrismaUniswapV4DbPort implements DbPort {
  private readonly network: NetworkEnv;
  private readonly chainId: number;
  private readonly poolManager: Address;
  private readonly positionManager: Address;
  private readonly client: PublicClient;
  private readonly logger: EvmLogger;
  private readonly db: typeof prisma;
  private readonly cursorKey: string;
  private readonly trackedByAddress: Record<string, DbTokenLike>;
  private readonly blockTimestampCache = new Map<bigint, Date>();

  constructor(options: PrismaDbPortOptions) {
    this.network = options.network;
    this.chainId = options.chainId;
    this.poolManager = getAddress(options.poolManagerAddress);
    this.positionManager = getAddress(options.positionManagerAddress);
    this.client = options.publicClient;
    this.logger = options.logger;
    this.db = options.prismaClient ?? prisma;
    this.cursorKey = `${this.network}:uniswap_v4_pool_manager`;
    this.trackedByAddress = indexTrackedTokens(this.network);
  }

  async saveInitialize(event: Parameters<DbPort["saveInitialize"]>[0]): Promise<void> {
    const timestamp = await this.getBlockTimestamp(event.blockNumber);
    const poolAddress = toLowerAddress(event.poolId);

    const [token0, token1] = await Promise.all([
      ensureToken(this.db, this.client, this.logger, this.chainId, this.trackedByAddress, event.currency0),
      ensureToken(this.db, this.client, this.logger, this.chainId, this.trackedByAddress, event.currency1),
    ]);

    const metadata = {
      poolId: poolAddress,
      hooks: getAddress(event.hooks),
      keyHash: serializePoolKey(
        poolAddress,
        token0.address,
        token1.address,
        event.fee,
        event.tickSpacing,
        event.hooks,
      ),
      lastSqrtPriceX96: event.sqrtPriceX96.toString(),
      lastTick: event.tick,
    };

    const pool = await this.db.pool.upsert({
      where: {
        chainId_protocol_address: {
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          address: poolAddress,
        },
      },
      create: {
        id: poolAddress,
        chainId: this.chainId,
        protocol: PoolProtocol.UNISWAP_V4,
        address: poolAddress,
        factoryAddress: toLowerAddress(this.poolManager),
        token0Id: token0.id,
        token1Id: token1.id,
        feeTierBps: event.fee,
        tickSpacing: event.tickSpacing,
        createdBlock: event.blockNumber ?? null,
        metadata,
        discoveredAt: timestamp,
        createdAt: timestamp,
      },
      update: {
        token0Id: token0.id,
        token1Id: token1.id,
        feeTierBps: event.fee,
        tickSpacing: event.tickSpacing,
        metadata,
        updatedAt: timestamp,
      },
    });

    await this.writeDiscoveryEvent(pool, event, timestamp);
    await this.updateCursor(event.blockNumber, event.logIndex, event.txHash, timestamp);

    this.logger.info?.("[uniswapV4] saved initialize", {
      pool: poolAddress,
      fee: event.fee,
      tickSpacing: event.tickSpacing,
    });
  }

  async saveSwap(event: Parameters<DbPort["saveSwap"]>[0]): Promise<void> {
    const poolId = toLowerAddress(event.poolId);
    const pool = await this.db.pool.findUnique({
      where: {
        chainId_protocol_address: {
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          address: poolId,
        },
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (!pool) {
      this.logger.warn?.("[uniswapV4] swap for unknown pool", { poolId });
      return;
    }

    const timestamp = await this.getBlockTimestamp(event.blockNumber);

    try {
      await this.db.swapEvent.create({
        data: {
          poolId: pool.id,
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          sender: getAddress(event.sender),
          amount0: decimalFromBigInt(event.amount0),
          amount1: decimalFromBigInt(event.amount1),
          sqrtPriceX96: decimalFromBigInt(event.sqrtPriceX96),
          liquidity: decimalFromBigInt(event.liquidity),
          tick: event.tick,
          fee: event.fee,
          txHash: event.txHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          blockTimestamp: timestamp,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        this.logger.error?.("[uniswapV4] failed to persist swap", { error });
      }
    }

    const metadata = metadataToRecord(pool.metadata);
    metadata.lastSwapAt = timestamp.toISOString();
    metadata.lastTick = event.tick;
    metadata.lastLiquidity = event.liquidity.toString();
    metadata.lastSqrtPriceX96 = event.sqrtPriceX96.toString();
    metadata.lastFeeBps = event.fee;

    const priceInfo = priceFromSqrtPrice(
      event.sqrtPriceX96,
      pool.token0.decimals,
      pool.token1.decimals,
    );
    metadata.lastPrice = priceInfo.price.toString();
    metadata.lastPriceInverse = priceInfo.priceInverse.toString();

    const sqrtPriceDecimal = new Prisma.Decimal(event.sqrtPriceX96.toString()).div(Q96_DECIMAL);
    const poolMetrics = await recomputePoolMetrics(this.db, {
      poolId: pool.id,
      sqrtPrice: sqrtPriceDecimal,
      sqrtPriceX96: event.sqrtPriceX96,
      token0Decimals: pool.token0.decimals,
      token1Decimals: pool.token1.decimals,
      priceToken1PerToken0: priceInfo.price,
    });
    metadata.totalToken0 = poolMetrics.totalToken0.toString();
    metadata.totalToken1 = poolMetrics.totalToken1.toString();
    metadata.tvlToken1 = poolMetrics.tvlToken1.toString();
    metadata.tvlToken1Symbol = pool.token1.symbol ?? pool.token1.address;
    metadata.lastLiquidity = poolMetrics.liquidity.toFixed(0);
    metadata.poolTicks = poolMetrics.ticks.map((tick) => ({
      tick: tick.tick,
      liquidityNet: tick.liquidityNet.toFixed(0),
    }));
    metadata.depthSamples = poolMetrics.depthSamples.map((sample) => ({
      targetBps: sample.targetBps,
      amountIn: sample.amountIn.toFixed(0),
      amountOut: sample.amountOut.toFixed(0),
      resultingTick: sample.resultingTick,
    }));
    metadata.currentTick = poolMetrics.currentTick;
    metadata.lastSqrtPriceX96 = poolMetrics.sqrtPriceX96;

    try {
      await this.db.pool.update({
        where: { id: pool.id },
        data: { metadata: metadata as Prisma.JsonObject },
      });
    } catch (error) {
      this.logger.error?.("[uniswapV4] failed to update pool metadata after swap", { error });
    }

    await this.updateCursor(event.blockNumber, event.logIndex, event.txHash, timestamp);
  }

  async saveModifyLiquidity(event: Parameters<DbPort["saveModifyLiquidity"]>[0]): Promise<void> {
    const poolAddress = toLowerAddress(event.poolId);
    const pool = await this.db.pool.findUnique({
      where: {
        chainId_protocol_address: {
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          address: poolAddress,
        },
      },
      select: {
        id: true,
      },
    });

    if (!pool) {
      this.logger.warn?.("[uniswapV4] modify liquidity for unknown pool", { poolAddress });
      return;
    }

    const tokenId = parseTokenId(event.salt);
    if (!tokenId) {
      this.logger.warn?.("[uniswapV4] unable to derive tokenId from salt", { poolAddress, salt: event.salt });
      return;
    }

    const details = await fetchPositionDetails(this.client, this.positionManager, tokenId);
    if (!details) {
      this.logger.warn?.("[uniswapV4] position details lookup failed", {
        tokenId: tokenId.toString(),
      });
      return;
    }

    if (details.poolId.toLowerCase() !== poolAddress) {
      this.logger.warn?.("[uniswapV4] position pool mismatch", {
        expected: poolAddress,
        received: details.poolId,
        tokenId: tokenId.toString(),
      });
    }

    const timestamp = await this.getBlockTimestamp(event.blockNumber);
    await upsertPositionFromModify(this.db, this.logger, this.chainId, {
      poolId: pool.id,
      poolAddress,
      event,
      timestamp,
      tokenId,
      details,
    });
    await this.updateCursor(event.blockNumber, event.logIndex, event.txHash, timestamp);

    const poolRecord = await this.db.pool.findUnique({
      where: {
        chainId_protocol_address: {
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          address: poolAddress,
        },
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (poolRecord) {
      const meta = metadataToRecord(poolRecord.metadata);
      const sqrtRaw = typeof meta.lastSqrtPriceX96 === "string" ? meta.lastSqrtPriceX96 : null;
      if (sqrtRaw) {
        try {
          const sqrtBig = BigInt(sqrtRaw);
          const sqrtDecimal = new Prisma.Decimal(sqrtBig.toString()).div(Q96_DECIMAL);
          const priceInfo = priceFromSqrtPrice(
            sqrtBig,
            poolRecord.token0.decimals,
            poolRecord.token1.decimals,
          );
          const poolMetrics = await recomputePoolMetrics(this.db, {
            poolId: poolRecord.id,
            sqrtPrice: sqrtDecimal,
            sqrtPriceX96: sqrtBig,
            token0Decimals: poolRecord.token0.decimals,
            token1Decimals: poolRecord.token1.decimals,
            priceToken1PerToken0: priceInfo.price,
          });

          meta.totalToken0 = poolMetrics.totalToken0.toString();
          meta.totalToken1 = poolMetrics.totalToken1.toString();
          meta.tvlToken1 = poolMetrics.tvlToken1.toString();
          meta.tvlToken1Symbol = poolRecord.token1.symbol ?? poolRecord.token1.address;
          meta.lastLiquidity = poolMetrics.liquidity.toFixed(0);
          meta.poolTicks = poolMetrics.ticks.map((tick) => ({
            tick: tick.tick,
            liquidityNet: tick.liquidityNet.toFixed(0),
          }));
          meta.depthSamples = poolMetrics.depthSamples.map((sample) => ({
            targetBps: sample.targetBps,
            amountIn: sample.amountIn.toFixed(0),
            amountOut: sample.amountOut.toFixed(0),
            resultingTick: sample.resultingTick,
          }));
          meta.currentTick = poolMetrics.currentTick;

          await this.db.pool.update({
            where: { id: poolRecord.id },
            data: { metadata: meta as Prisma.JsonObject },
          });
        } catch (error) {
          this.logger.error?.("[uniswapV4] failed to recompute pool metrics after modify", {
            pool: poolAddress,
            error,
          });
        }
      }
    }
  }

  async saveDonate(event: Parameters<DbPort["saveDonate"]>[0]): Promise<void> {
    // Placeholder for donate accounting — log for observability.
    this.logger.warn?.("[uniswapV4] donate event received (not persisted)", {
      poolId: event.poolId,
      amount0: event.amount0.toString(),
      amount1: event.amount1.toString(),
    });
    const timestamp = await this.getBlockTimestamp(event.blockNumber);
    await this.updateCursor(event.blockNumber, event.logIndex, event.txHash, timestamp);
  }

  // ============================================================
  // Infrastructure helpers
  // ============================================================

  private async writeDiscoveryEvent(
    pool: DbPool,
    event: Parameters<DbPort["saveInitialize"]>[0],
    timestamp: Date,
  ): Promise<void> {
    try {
      await this.db.poolDiscoveryEvent.create({
        data: {
          poolId: pool.id,
          chainId: this.chainId,
          protocol: PoolProtocol.UNISWAP_V4,
          factoryAddress: toLowerAddress(this.poolManager),
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          blockTimestamp: timestamp,
          logIndex: event.logIndex,
          metadata: {
            args: {
              poolId: event.poolId,
              currency0: event.currency0,
              currency1: event.currency1,
              fee: event.fee,
              tickSpacing: event.tickSpacing,
              hooks: event.hooks,
              sqrtPriceX96: event.sqrtPriceX96.toString(),
              tick: event.tick,
            },
          },
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      this.logger.error?.("[uniswapV4] failed to write discovery event", error);
    }
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<Date> {
    if (this.blockTimestampCache.has(blockNumber)) {
      return this.blockTimestampCache.get(blockNumber)!;
    }

    const block = await this.client.getBlock({ blockNumber });
    const date = new Date(Number(block.timestamp) * 1000);
    this.blockTimestampCache.set(blockNumber, date);
    if (this.blockTimestampCache.size > 512) {
      this.blockTimestampCache.clear();
    }
    return date;
  }

  private async updateCursor(
    blockNumber: bigint,
    logIndex: number,
    txHash: Hex,
    timestamp: Date,
  ): Promise<void> {
    await this.db.scanCursor.upsert({
      where: { cursorKey: this.cursorKey },
      create: {
        cursorKey: this.cursorKey,
        task: "pool_watcher",
        chainId: this.chainId,
        protocol: PoolProtocol.UNISWAP_V4,
        lastBlock: blockNumber,
        lastLogIndex: logIndex,
        lastTxHash: txHash,
        lastTimestamp: timestamp,
        metadata: {
          network: this.network,
        },
      },
      update: {
        lastBlock: blockNumber,
        lastLogIndex: logIndex,
        lastTxHash: txHash,
        lastTimestamp: timestamp,
        metadata: {
          network: this.network,
          heartbeat: new Date().toISOString(),
        },
      },
    });
  }
}
