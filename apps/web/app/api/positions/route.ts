import { NextResponse } from "next/server";
import { prisma } from "@infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/positions
 * List LP positions, optionally filtered by owner, pool, or status.
 *
 * Query params:
 *   owner   - filter by wallet address
 *   poolId  - filter by pool ID
 *   status  - filter by position status (active/closed/pending)
 *   limit   - max results (default 100, cap 500)
 *   include - comma-separated extras; "engine" adds enginePositions from LPPosition
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const owner = url.searchParams.get("owner");
    const poolId = url.searchParams.get("poolId");
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const include = url.searchParams.get("include")?.split(",") ?? [];

    const where: Record<string, unknown> = {};
    if (owner) where.owner = owner.toLowerCase();
    if (poolId) where.poolId = poolId.toLowerCase();
    if (status) where.status = status;

    const positions = await prisma.lPPosition.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 500),
    });

    // Get pool info for each position
    const poolIds = [...new Set(positions.map((p) => p.poolId))];
    const pools = await prisma.pool.findMany({
      where: { id: { in: poolIds } },
      include: {
        token0: true,
        token1: true,
      },
    });
    const poolMap = new Map(pools.map((p) => [p.id, p]));

    // Enrich positions with pool info
    const enriched = positions.map((pos) => {
      const pool = poolMap.get(pos.poolId);
      return {
        ...pos,
        liquidity: pos.liquidity.toString(),
        token0Amount: pos.token0Amount?.toString() ?? null,
        token1Amount: pos.token1Amount?.toString() ?? null,
        fees0Unclaimed: pos.fees0Unclaimed?.toString() ?? null,
        fees1Unclaimed: pos.fees1Unclaimed?.toString() ?? null,
        pool: pool
          ? {
              id: pool.id,
              address: pool.address,
              token0: pool.token0
                ? { symbol: pool.token0.symbol, decimals: pool.token0.decimals }
                : null,
              token1: pool.token1
                ? { symbol: pool.token1.symbol, decimals: pool.token1.decimals }
                : null,
              feeTierBps: pool.feeTierBps,
              tickSpacing: pool.tickSpacing,
            }
          : null,
      };
    });

    const response: Record<string, unknown> = {
      positions: enriched,
      count: positions.length,
    };

    // When ?include=engine, also return engine-managed LPPositions with management fields
    if (include.includes("engine")) {
      const engineWhere: Record<string, unknown> = {};
      if (owner) engineWhere.owner = owner.toLowerCase();
      if (poolId) engineWhere.poolId = poolId.toLowerCase();

      const enginePositions = await prisma.lPPosition.findMany({
        where: engineWhere,
        orderBy: { updatedAt: "desc" },
        take: Math.min(limit, 500),
      });

      // Enrich engine positions with pool info (reuse existing poolMap + fetch any missing)
      const enginePoolIds = [
        ...new Set(enginePositions.map((p) => p.poolId).filter((id) => !poolMap.has(id))),
      ];
      if (enginePoolIds.length > 0) {
        const extraPools = await prisma.pool.findMany({
          where: { id: { in: enginePoolIds } },
          include: { token0: true, token1: true },
        });
        for (const p of extraPools) poolMap.set(p.id, p);
      }

      response.enginePositions = enginePositions.map((pos) => {
        const pool = poolMap.get(pos.poolId);
        return {
          id: pos.id,
          poolId: pos.poolId,
          chainId: pos.chainId,
          owner: pos.owner,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          liquidity: pos.liquidity.toString(),
          token0Amount: pos.token0Amount?.toString() ?? null,
          token1Amount: pos.token1Amount?.toString() ?? null,
          fees0Unclaimed: pos.fees0Unclaimed?.toString() ?? null,
          fees1Unclaimed: pos.fees1Unclaimed?.toString() ?? null,
          status: pos.status,
          targetMode: pos.targetMode,
          lastRebalanceAt: pos.lastRebalanceAt?.toISOString() ?? null,
          createdAt: pos.createdAt.toISOString(),
          updatedAt: pos.updatedAt.toISOString(),
          pool: pool
            ? {
                id: pool.id,
                address: pool.address,
                token0: pool.token0
                  ? { symbol: pool.token0.symbol, decimals: pool.token0.decimals }
                  : null,
                token1: pool.token1
                  ? { symbol: pool.token1.symbol, decimals: pool.token1.decimals }
                  : null,
                feeTierBps: pool.feeTierBps,
                tickSpacing: pool.tickSpacing,
              }
            : null,
        };
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch positions" },
      { status: 500 }
    );
  }
}
