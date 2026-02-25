import { NextResponse } from "next/server";
import { prisma } from "@infra";
import { buildGlobalState } from "@domain/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const timestamp = new Date().toISOString();

    // Check database connection
    let dbConnected = false;
    let pendingOperations = 0;
    let approvedOperations = 0;
    let recentExecutions = 0;

    try {
      pendingOperations = await prisma.operationQueue.count({
        where: { status: "pending" },
      });
      approvedOperations = await prisma.operationQueue.count({
        where: { status: "approved" },
      });
      recentExecutions = await prisma.executionHistory.count({
        where: {
          startedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });
      dbConnected = true;
    } catch {
      // Database not connected
    }

    // Fetch runner settings
    let runner = { autoExecute: false, manualApproval: false, cooldownMs: 60000 };
    try {
      const settings = await prisma.engineSettings.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      runner = {
        autoExecute: settings.autoExecute,
        manualApproval: (settings as Record<string, unknown>).manualApproval as boolean ?? false,
        cooldownMs: settings.cooldownMs,
      };
    } catch {
      // Use defaults if table doesn't exist yet
    }

    // Check state availability
    let zephyrAvailable = false;
    let evmAvailable = false;
    let cexAvailable = false;
    let reserveRatio: number | null = null;
    let rrMode: string = "unknown";

    try {
      const state = await buildGlobalState();
      zephyrAvailable = state.zephyr?.reserve != null;
      evmAvailable = state.evm != null;
      cexAvailable = state.cex != null;
      
      if (state.zephyr?.reserve) {
        reserveRatio = state.zephyr.reserve.reserveRatio * 100;
        rrMode = reserveRatio >= 400 ? "normal" : reserveRatio >= 200 ? "defensive" : "crisis";
      }
    } catch {
      // State unavailable
    }

    return NextResponse.json({
      timestamp,
      database: {
        connected: dbConnected,
        pendingOperations,
        approvedOperations,
        recentExecutions,
      },
      state: {
        zephyrAvailable,
        evmAvailable,
        cexAvailable,
        reserveRatio,
        rrMode,
      },
      runner,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 }
    );
  }
}

