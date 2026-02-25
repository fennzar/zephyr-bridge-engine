import type { Prisma } from "@infra";
import type { OperationPlan } from "@domain/strategies";

export function serializeForJson(obj: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  ));
}

export function calculatePriority(plan: OperationPlan): number {
  let priority = 0;

  if (plan.opportunity.urgency === "critical") priority += 100;
  else if (plan.opportunity.urgency === "high") priority += 50;
  else if (plan.opportunity.urgency === "medium") priority += 25;

  if (plan.opportunity.expectedPnl > 0) {
    priority += Math.min(50, plan.opportunity.expectedPnl);
  }

  return priority;
}

export function calculatePnlFromSteps(stepResults: unknown[], plan: OperationPlan): number | null {
  if (plan.opportunity.expectedPnl !== undefined) {
    return plan.opportunity.expectedPnl;
  }

  let totalPnl = 0;
  let hasAmountData = false;

  for (const sr of stepResults) {
    const rec = sr as { amountIn?: string; amountOut?: string; status?: string };
    if (rec.status === "success" && rec.amountIn && rec.amountOut) {
      const amountIn = parseFloat(rec.amountIn);
      const amountOut = parseFloat(rec.amountOut);
      if (!isNaN(amountIn) && !isNaN(amountOut)) {
        totalPnl += amountOut - amountIn;
        hasAmountData = true;
      }
    }
  }

  return hasAmountData ? totalPnl : null;
}
