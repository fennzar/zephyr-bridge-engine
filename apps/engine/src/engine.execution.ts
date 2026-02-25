import { prisma, type Prisma } from "@infra";
import type { OperationPlan } from "@domain/strategies";
import {
  type ExecutionEngine,
  type ExecutionResult,
  type ExecutionMode,
} from "@domain/execution";
import {
  type CircuitBreaker,
  checkOperationAllowed,
  type RiskLimits,
} from "@domain/risk";
import type { Logger } from "@shared/logger";
import type { InventorySnapshot } from "@domain/inventory/balances";
import { findAssetBaseByVariant } from "@domain/assets/variants";
import type { AssetId } from "@domain/types";

import { serializeForJson, calculatePnlFromSteps } from "./engine.helpers";

export interface ExecutionDeps {
  executionEngine: ExecutionEngine | null;
  circuitBreaker: CircuitBreaker;
  riskLimits: RiskLimits;
  mode: ExecutionMode;
  log: Logger;
  inventory?: InventorySnapshot;
}

export async function executePlan(
  plan: OperationPlan,
  deps: ExecutionDeps,
  operationId?: string
): Promise<ExecutionResult | null> {
  const { executionEngine, circuitBreaker, riskLimits, mode, log } = deps;

  log.info(`Executing plan: ${plan.id}`);

  // Risk check: Circuit breaker
  const circuitCheck = circuitBreaker.canExecute();
  if (!circuitCheck.allowed) {
    log.error(`Circuit breaker BLOCKED execution: ${circuitCheck.reason}`);
    await recordBlockedExecution(plan, mode, operationId, circuitCheck.reason ?? "Circuit breaker open");
    return null;
  }

  // Risk check: Operation limits
  const estimatedSizeUsd = Math.abs(plan.opportunity.expectedPnl || 0) * 10;
  const assetExposurePct = computeAssetExposure(plan.steps[0]?.from, deps.inventory);
  const riskCheck = checkOperationAllowed(estimatedSizeUsd, assetExposurePct, riskLimits);
  if (!riskCheck.allowed) {
    log.warn(`Risk check BLOCKED: ${riskCheck.reason}`);
    await recordBlockedExecution(plan, mode, operationId, riskCheck.reason ?? "Risk limit exceeded");
    return null;
  }

  const startedAt = new Date();
  let result: ExecutionResult | null = null;
  let stepResults: unknown[] = [];
  let netPnlUsd: number | null = null;
  let gasUsed: bigint | null = null;
  let executionSuccess = true;

  // If we have an execution engine and steps, actually execute
  if (executionEngine && plan.steps.length > 0) {
    log.info(`Running ${plan.steps.length} steps through execution engine`);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      try {
        const stepResult = await executionEngine.executeStep(step);
        stepResults.push(serializeForJson(stepResult));

        if (stepResult.gasUsed) {
          gasUsed = (gasUsed ?? 0n) + stepResult.gasUsed;
        }

        log.info(`Step ${step.planStepId}: ${stepResult.status}`);

        if (stepResult.status === "failed") {
          log.error(`Step failed: ${stepResult.error}`);
          executionSuccess = false;
          break;
        }

        // Thread actual output to next step's input
        if (stepResult.amountOut && i + 1 < plan.steps.length) {
          plan.steps[i + 1].amountIn = stepResult.amountOut;
        }
      } catch (error) {
        log.error("Step execution error:", error);
        stepResults.push({
          step: serializeForJson(step),
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        executionSuccess = false;
        break;
      }
    }
  } else if (plan.steps.length === 0) {
    log.info("No steps in plan - skipping execution");
    stepResults = [{ status: "skipped", reason: "No steps in plan" }];
  } else {
    log.info("No execution engine available - logging only");
    stepResults = [{ status: "skipped", reason: "Execution engine not available" }];
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  netPnlUsd = calculatePnlFromSteps(stepResults, plan);

  if (executionSuccess) {
    circuitBreaker.recordSuccess(netPnlUsd ?? 0);
  } else {
    circuitBreaker.recordFailure(`Plan ${plan.id} failed`);
  }

  const serializedPlan = serializeForJson(plan);
  const serializedResult = {
    stepCount: plan.steps.length,
    stepsExecuted: stepResults.length,
    success: executionSuccess,
  };

  await prisma.executionHistory.create({
    data: {
      operationId,
      strategy: plan.strategy,
      mode,
      plan: serializedPlan as Prisma.InputJsonValue,
      result: serializedResult as Prisma.InputJsonValue,
      stepResults: stepResults as Prisma.InputJsonValue,
      startedAt,
      completedAt,
      durationMs,
      netPnlUsd,
      gasUsed: gasUsed ? gasUsed.toString() : null,
    },
  });

  log.info(`Execution complete for: ${plan.id} (${durationMs}ms, PnL: $${netPnlUsd?.toFixed(2) ?? "N/A"})`);
  return result;
}

function computeAssetExposure(
  fromAsset: AssetId | undefined,
  inventory?: InventorySnapshot,
): number {
  if (!fromAsset || !inventory?.totals) return 0;
  const base = findAssetBaseByVariant(fromAsset);
  if (!base) return 0;
  const assetTotal = inventory.totals[base] ?? 0;
  const portfolioTotal = Object.values(inventory.totals).reduce(
    (sum, v) => sum + (v ?? 0),
    0,
  );
  if (portfolioTotal === 0) return 0;
  return (assetTotal / portfolioTotal) * 100;
}

export async function recordBlockedExecution(
  plan: OperationPlan,
  mode: ExecutionMode,
  operationId: string | undefined,
  reason: string
): Promise<void> {
  const serializedPlan = serializeForJson(plan);

  await prisma.executionHistory.create({
    data: {
      operationId,
      strategy: plan.strategy,
      mode,
      plan: serializedPlan as Prisma.InputJsonValue,
      result: { success: false, blocked: true, reason } as Prisma.InputJsonValue,
      stepResults: [] as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      netPnlUsd: null,
      gasUsed: null,
    },
  });
}
