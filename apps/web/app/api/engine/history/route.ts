import { NextResponse } from "next/server";
import { prisma } from "@infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/engine/history
 * List execution history
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const strategy = url.searchParams.get("strategy");
    const mode = url.searchParams.get("mode"); // paper or live

    const where: Record<string, unknown> = {};
    if (strategy) where.strategy = strategy;
    if (mode) where.mode = mode;

    const executions = await prisma.executionHistory.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: Math.min(limit, 100),
    });

    // Calculate summary stats
    const stats = await prisma.executionHistory.aggregate({
      where: {
        startedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      _count: true,
      _sum: {
        netPnlUsd: true,
      },
    });

    return NextResponse.json({
      executions,
      count: executions.length,
      stats24h: {
        count: stats._count,
        totalPnlUsd: stats._sum.netPnlUsd?.toNumber() ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch history" },
      { status: 500 }
    );
  }
}

