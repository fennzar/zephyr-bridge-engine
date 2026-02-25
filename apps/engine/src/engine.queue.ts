import { prisma } from "@infra";
import type { OperationPlan } from "@domain/strategies";
import type { Logger } from "@shared/logger";

import { calculatePriority } from "./engine.helpers";
import { executePlan, type ExecutionDeps } from "./engine.execution";

export async function queueForApproval(plan: OperationPlan, log: Logger): Promise<void> {
  log.info(`Queuing for approval: ${plan.id} (${plan.strategy})`);

  await prisma.operationQueue.create({
    data: {
      strategy: plan.strategy,
      status: "pending",
      priority: calculatePriority(plan),
      plan: JSON.parse(JSON.stringify(plan, (_, v) =>
        typeof v === "bigint" ? v.toString() : v
      )),
    },
  });
}

export async function processApprovedQueue(
  deps: ExecutionDeps,
  maxOps: number,
  log: Logger
): Promise<void> {
  const approved = await prisma.operationQueue.findMany({
    where: { status: "approved" },
    orderBy: { priority: "desc" },
    take: maxOps,
  });

  for (const op of approved) {
    log.info(`Processing approved operation: ${op.id}`);

    await prisma.operationQueue.update({
      where: { id: op.id },
      data: { status: "executing" },
    });

    try {
      const plan = op.plan as unknown as OperationPlan;
      await executePlan(plan, deps, op.id);

      await prisma.operationQueue.update({
        where: { id: op.id },
        data: { status: "completed", executedAt: new Date() },
      });
    } catch (error) {
      log.error(`Execution failed for ${op.id}:`, error);

      await prisma.operationQueue.update({
        where: { id: op.id },
        data: {
          status: "failed",
          result: { error: error instanceof Error ? error.message : "Unknown error" },
        },
      });
    }
  }
}
