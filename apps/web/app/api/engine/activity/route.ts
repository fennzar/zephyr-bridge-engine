import { NextResponse } from "next/server";
import { prisma } from "@infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StepJson = {
  planStepId?: string;
  op?: string;
  from?: string;
  to?: string;
  venue?: string;
  assetIn?: string;
  assetOut?: string;
  amountIn?: string;
  amountOut?: string;
};

type StepResultJson = {
  step?: { planStepId?: string; op?: string };
  status?: string;
  error?: string;
  durationMs?: number;
  txHash?: string;
  amountIn?: string;
  amountOut?: string;
};

type PlanJson = {
  id?: string;
  opportunity?: {
    asset?: string;
    direction?: string;
    expectedPnl?: number;
  };
  steps?: StepJson[];
};

const OP_FILTERS: Record<string, string[]> = {
  swap: ["swapEVM", "swap"],
  wrap: ["wrap", "unwrap"],
  lp: ["lpMint", "lpBurn", "addLiquidity", "removeLiquidity"],
  mint: ["mintZSD", "redeemZSD", "mintZRS", "redeemZRS", "mintZYS", "redeemZYS"],
  cex: ["tradeCEX", "buyCEX", "sellCEX", "depositCEX", "withdrawCEX"],
};

/**
 * GET /api/engine/activity
 *
 * Query params:
 *   type     - filter by step op category: swap, wrap, lp, mint, cex
 *   strategy - filter by strategy name
 *   limit    - max entries (default 50, max 200)
 *   offset   - pagination offset
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const strategy = url.searchParams.get("strategy");
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      200,
    );
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

    const where: Record<string, unknown> = {};
    if (strategy) where.strategy = strategy;

    const [executions, total] = await Promise.all([
      prisma.executionHistory.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit + 1, // fetch one extra to determine hasMore
        skip: offset,
      }),
      prisma.executionHistory.count({ where }),
    ]);

    const hasMore = executions.length > limit;
    const slice = hasMore ? executions.slice(0, limit) : executions;

    const entries = slice
      .map((exec) => {
        const plan = exec.plan as PlanJson | null;
        const stepResults = exec.stepResults as StepResultJson[] | null;
        const planSteps = plan?.steps ?? [];

        // Merge plan steps with results
        const steps = planSteps.map((ps) => {
          const result = stepResults?.find(
            (sr) =>
              sr.step?.planStepId === ps.planStepId ||
              sr.step?.op === ps.op,
          );
          return {
            op: ps.op ?? "unknown",
            from: ps.from ?? ps.venue ?? "",
            to: ps.to ?? "",
            status: result?.status ?? "pending",
            amountIn: result?.amountIn ?? ps.amountIn,
            amountOut: result?.amountOut ?? ps.amountOut,
            txHash: result?.txHash,
            durationMs: result?.durationMs,
            error: result?.error,
          };
        });

        // If no plan steps, try to reconstruct from stepResults
        if (steps.length === 0 && stepResults) {
          for (const sr of stepResults) {
            steps.push({
              op: sr.step?.op ?? "unknown",
              from: "",
              to: "",
              status: sr.status ?? "unknown",
              amountIn: sr.amountIn,
              amountOut: sr.amountOut,
              txHash: sr.txHash,
              durationMs: sr.durationMs,
              error: sr.error,
            });
          }
        }

        // Determine status from result JSON or step statuses
        const resultJson = exec.result as Record<string, unknown> | null;
        const status =
          (resultJson?.status as string) ??
          (steps.some((s) => s.status === "failed")
            ? "failed"
            : steps.every((s) => s.status === "success")
              ? "completed"
              : "unknown");

        return {
          id: exec.id,
          strategy: exec.strategy,
          mode: exec.mode as "paper" | "devnet" | "live",
          status,
          startedAt: exec.startedAt.toISOString(),
          completedAt: exec.completedAt.toISOString(),
          durationMs: exec.durationMs,
          netPnlUsd: exec.netPnlUsd?.toNumber() ?? null,
          opportunity: plan?.opportunity
            ? {
                asset: plan.opportunity.asset,
                direction: plan.opportunity.direction,
                expectedPnl: plan.opportunity.expectedPnl ?? 0,
              }
            : null,
          steps,
        };
      })
      .filter((entry) => {
        if (!type) return true;
        const allowedOps = OP_FILTERS[type];
        if (!allowedOps) return true;
        return entry.steps.some((s) => allowedOps.includes(s.op));
      });

    return NextResponse.json({
      entries,
      total,
      hasMore,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch activity",
      },
      { status: 500 },
    );
  }
}
