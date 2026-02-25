import { buildArbPlans, type ArbPlan } from "@domain/arbitrage";
import { ARB_DEFS, type ArbDirection } from "@domain/arbitrage/routing";
import { analyzeArbMarkets } from "@domain/arbitrage/analysis";
import { loadInventoryBalances } from "@domain/pathing";
import type { GlobalState } from "@domain/state/types";
import { buildGlobalState } from "@domain/state/state.builder";
import { buildArbPlanView } from "./view";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SerializedArbPlan = { [key: string]: JsonValue };

export interface ArbitragePlanReport {
  generatedAt: string;
  plans: SerializedArbPlan[];
  error: string | null;
}

export async function buildArbPlanReport(): Promise<ArbitragePlanReport> {
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];

  let state: GlobalState | null = null;
  try {
    state = await buildGlobalState();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to build global state");
  }

  let plans: ArbPlan[] = [];
  let inventory: Awaited<ReturnType<typeof loadInventoryBalances>> | undefined;
  if (state) {
    try {
      inventory = await loadInventoryBalances();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to load inventory balances");
    }

    try {
      const marketAnalysis = analyzeArbMarkets(state);
      const activeDirections = new Map<string, ArbDirection>();
      for (const entry of marketAnalysis) {
        if (entry.direction === "aligned") continue;
        activeDirections.set(entry.asset, entry.direction);
        activeDirections.set(entry.wrappedSymbol, entry.direction);
      }

      const eligibleLegs = ARB_DEFS.filter(
        (leg) =>
          activeDirections.get(leg.asset) === leg.direction ||
          activeDirections.get(leg.asset.toUpperCase()) === leg.direction,
      );

      if (eligibleLegs.length > 0) {
        plans = await buildArbPlans({ state, inventory, legs: eligibleLegs });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to build arbitrage plans");
    }
  }

  if (state) {
    await Promise.all(
      plans.map(async (plan) => {
        const view = await buildArbPlanView(plan, state, inventory).catch(() => null);
        if (view) {
          plan.view = view;
          if (view.clipOptions.length > 0) {
            const clipOptions = view.clipOptions.map((entry) => entry.option);
            plan.summary.clipOptions = clipOptions;
            plan.summary.clipOption = clipOptions[0] ?? null;
          }
        }
      }),
    );
  }

  const serializedPlans = plans.map((plan) => serializeForJson(plan));

  return {
    generatedAt,
    plans: serializedPlans,
    error: errors.length > 0 ? errors.join(" | ") : null,
  };
}

function serializeForJson<T>(value: T): SerializedArbPlan {
  return sanitizeValue(value) as SerializedArbPlan;
}

function sanitizeValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = sanitizeValue(entry);
    }
    return result;
  }
  return null;
}
