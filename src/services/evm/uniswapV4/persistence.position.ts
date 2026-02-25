import { Prisma, PoolProtocol, type prisma } from "@infra";
import type { PositionDetails } from "../positionManager";
import type { EvmLogger } from "../logging";
import type { DbPort } from "./eventLogHandler";

import {
  metadataToRecord,
  buildPositionId,
} from "./persistence.utils";

/** Parameters for the upsertPositionFromModify helper. */
export interface UpsertPositionFromModifyParams {
  poolId: string;
  poolAddress: string;
  event: Parameters<DbPort["saveModifyLiquidity"]>[0];
  timestamp: Date;
  tokenId: bigint;
  details: PositionDetails;
}

/**
 * Insert or update a Position row (and its snapshot) after a ModifyLiquidity
 * event. Runs inside a Prisma transaction.
 */
export async function upsertPositionFromModify(
  db: typeof prisma,
  logger: EvmLogger,
  chainId: number,
  params: UpsertPositionFromModifyParams,
): Promise<void> {
  const ownerKey = params.details!.owner.toLowerCase();
  const deltaBig = BigInt(params.event.liquidityDelta.toString());
  const blockNumber = params.event.blockNumber;
  const tokenIdString = params.tokenId.toString();
  const liquidityNormalized = params.details!.liquidity < 0n ? 0n : params.details!.liquidity;

  const baseMetadata = {
    tokenId: tokenIdString,
    salt: params.event.salt,
    positionKey: buildPositionId(
      params.poolAddress,
      ownerKey,
      params.details!.tickLower,
      params.details!.tickUpper,
      params.event.salt,
    ),
    hasSubscriber: params.details!.hasSubscriber,
  };

  await db.$transaction(async (tx) => {
    const existingByToken = await tx.position.findFirst({
      where: {
        chainId,
        protocol: PoolProtocol.UNISWAP_V4,
        metadata: {
          path: ["tokenId"],
          equals: tokenIdString,
        },
      },
      select: {
        id: true,
        metadata: true,
      },
    });

    const data = {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
      poolId: params.poolId,
      owner: ownerKey,
      tickLower: params.details!.tickLower,
      tickUpper: params.details!.tickUpper,
      liquidity: new Prisma.Decimal(liquidityNormalized.toString()),
      lastUpdatedBlock: blockNumber,
      lastUpdatedAt: params.timestamp,
      metadata: {
        ...metadataToRecord(existingByToken?.metadata),
        ...baseMetadata,
        lastLiquidityDelta: deltaBig.toString(),
        lastTxHash: params.event.txHash,
        lastUpdatedAt: params.timestamp.toISOString(),
      },
    };

    const positionRecord = existingByToken
      ? await tx.position.update({
          where: { id: existingByToken.id },
          data,
          select: { id: true },
        })
      : await tx.position.upsert({
          where: {
            chainId_protocol_owner_poolId_tickLower_tickUpper: {
              chainId,
              protocol: PoolProtocol.UNISWAP_V4,
              owner: ownerKey,
              poolId: params.poolId,
              tickLower: params.details!.tickLower,
              tickUpper: params.details!.tickUpper,
            },
          },
          create: {
            ...data,
            metadata: {
              ...data.metadata,
              createdAt: params.timestamp.toISOString(),
            },
          },
          update: data,
          select: { id: true },
        });

    await tx.positionSnapshot.upsert({
      where: {
        positionId_blockNumber: {
          positionId: positionRecord.id,
          blockNumber,
        },
      },
      create: {
        positionId: positionRecord.id,
        blockNumber,
        blockTimestamp: params.timestamp,
        liquidity: new Prisma.Decimal(liquidityNormalized.toString()),
        metadata: {
          delta: deltaBig.toString(),
          salt: params.event.salt,
          txHash: params.event.txHash,
          tokenId: tokenIdString,
        },
      },
      update: {
        blockTimestamp: params.timestamp,
        liquidity: new Prisma.Decimal(liquidityNormalized.toString()),
        metadata: {
          delta: deltaBig.toString(),
          salt: params.event.salt,
          txHash: params.event.txHash,
          tokenId: tokenIdString,
        },
      },
    });
  });

  logger.info?.("[uniswapV4] synced position", {
    pool: params.poolAddress,
    owner: params.details!.owner,
    tokenId: tokenIdString,
  });
}
