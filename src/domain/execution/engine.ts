import { randomUUID } from "node:crypto";

import type { ArbPlan } from "@domain/arbitrage/types.plan";

import type {
  ExecutionStep,
  ExecutionStepResult,
  ExecutionResult,
  ExecutionContext,
  VenueExecutors,
  BuildStepsOptions,
} from "./types";

import { dispatchToVenue } from "./execution.dispatch";
import { planStepToExecutionStep, buildSummary } from "./execution.mapping";

// Re-export types that were previously defined here
export type { VenueExecutors, BuildStepsOptions } from "./types";

// Re-export from sub-modules for external consumers
export { dispatchToVenue } from "./execution.dispatch";
export type { DispatchResult } from "./execution.dispatch";
export {
  planStepToExecutionStep,
  getVenueForOp,
  getTradeSymbol,
  getTradeSide,
  getWithdrawDestination,
  buildSummary,
} from "./execution.mapping";

/**
 * Execution engine for orchestrating arbitrage plan execution.
 */
export class ExecutionEngine {
  private executors: VenueExecutors;
  private context: ExecutionContext;

  constructor(executors: VenueExecutors, context?: Partial<ExecutionContext>) {
    this.executors = executors;
    this.context = {
      mode: context?.mode ?? "paper",
      simulateTiming: context?.simulateTiming ?? false,
      dryRun: context?.dryRun ?? false,
    };
  }

  /**
   * Execute an arbitrage plan.
   */
  async executePlan(plan: ArbPlan, options?: BuildStepsOptions): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startedAt = new Date().toISOString();
    const stepResults: ExecutionStepResult[] = [];

    // Build execution steps from plan
    const steps = this.buildExecutionSteps(plan, options);

    // Execute each step in sequence
    for (const step of steps) {
      const result = await this.executeStep(step);
      stepResults.push(result);

      // Stop on failure unless in dry-run mode
      if (result.status === "failed" && !this.context.dryRun) {
        break;
      }
    }

    const completedAt = new Date().toISOString();
    const summary = buildSummary(stepResults);

    return {
      executionId,
      planId: `${plan.asset}-${plan.direction}`,
      mode: this.context.mode,
      steps: stepResults,
      summary,
      startedAt,
      completedAt,
    };
  }

  /**
   * Execute a single step.
   */
  async executeStep(step: ExecutionStep): Promise<ExecutionStepResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    if (this.context.dryRun) {
      return {
        step,
        status: "skipped",
        durationMs: 0,
        timestamp,
      };
    }

    try {
      const result = await dispatchToVenue(step, this.executors, this.context);

      return {
        step,
        status: result.success ? "success" : "failed",
        amountOut: result.amountOut,
        txHash: result.txHash,
        orderId: result.orderId,
        error: result.error,
        durationMs: Date.now() - startTime,
        timestamp,
        gasUsed: result.gasUsed,
        feePaid: result.feePaid,
      };
    } catch (error) {
      return {
        step,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
        timestamp,
      };
    }
  }

  /**
   * Build execution steps from an arbitrage plan.
   */
  buildExecutionSteps(plan: ArbPlan, options?: BuildStepsOptions): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    const stages = options?.stages ?? ["preparation", "execution", "settlement", "realisation"];
    const closeFlavor = options?.closeFlavor ?? plan.summary.closeFlavor ?? "native";

    for (const stage of stages) {
      const stageSteps = plan.stages[stage] ?? [];

      for (const planStep of stageSteps) {
        // Skip if marked to skip
        if (planStep.skip) continue;

        // Skip if blocked and skipBlocked is set
        if (planStep.blocked && options?.skipBlocked) continue;

        // Filter by close flavor if applicable
        if (planStep.flavor && planStep.flavor !== closeFlavor) continue;

        // Extract execution step from plan step
        const execStep = planStepToExecutionStep(planStep, stage);
        if (execStep) {
          steps.push(execStep);
        }
      }
    }

    return steps;
  }
}

/**
 * Create an execution engine with the provided venue executors.
 */
export function createExecutionEngine(
  executors: VenueExecutors,
  context?: Partial<ExecutionContext>,
): ExecutionEngine {
  return new ExecutionEngine(executors, context);
}
