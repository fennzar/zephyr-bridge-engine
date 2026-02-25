import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@infra";
import { parseJsonBody } from "../../_lib/parseBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/engine/queue
 * List operations in the queue
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    const where = status ? { status } : {};

    const operations = await prisma.operationQueue.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: Math.min(limit, 100),
    });

    return NextResponse.json({
      operations,
      count: operations.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch queue" },
      { status: 500 }
    );
  }
}

const QueueActionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel", "retry"]),
  operationId: z.string().optional(),
  operationIds: z.array(z.string()).optional(),
}).refine(
  (d) => (d.operationIds?.length ?? 0) > 0 || !!d.operationId,
  { message: "operationId or operationIds required" }
);

/**
 * POST /api/engine/queue
 * Actions: approve, reject, cancel, retry
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, QueueActionSchema);
  if ("error" in parsed) return parsed.error;

  const { action, operationId, operationIds } = parsed.data;
  const ids = operationIds ?? (operationId ? [operationId] : []);

  try {
    switch (action) {
      case "approve": {
        const result = await prisma.operationQueue.updateMany({
          where: { id: { in: ids }, status: "pending" },
          data: { status: "approved", approvedAt: new Date() },
        });
        return NextResponse.json({ updated: result.count, status: "approved" });
      }

      case "reject": {
        const result = await prisma.operationQueue.updateMany({
          where: { id: { in: ids }, status: "pending" },
          data: { status: "rejected" },
        });
        return NextResponse.json({ updated: result.count, status: "rejected" });
      }

      case "cancel": {
        const result = await prisma.operationQueue.updateMany({
          where: { id: { in: ids }, status: { in: ["pending", "approved"] } },
          data: { status: "cancelled" },
        });
        return NextResponse.json({ updated: result.count, status: "cancelled" });
      }

      case "retry": {
        const result = await prisma.operationQueue.updateMany({
          where: { id: { in: ids }, status: "failed" },
          data: { status: "pending", error: null },
        });
        return NextResponse.json({ updated: result.count, status: "pending" });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Queue action failed" },
      { status: 500 }
    );
  }
}
