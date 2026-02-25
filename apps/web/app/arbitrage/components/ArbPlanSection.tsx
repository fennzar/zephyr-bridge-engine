import { ArbPlanCard } from "../PlanCard.client";

import type { ArbPlan } from "@domain/arbitrage";
import type { InventoryApiResponse } from "@domain/inventory/types.api";

export function ArbPlanSection({
  plans,
  plannerError,
  statusColor,
  inventorySnapshot,
}: {
  plans: ArbPlan[];
  plannerError: string | null;
  statusColor: string;
  inventorySnapshot: InventoryApiResponse | null;
}) {
  if (plannerError) {
    return (
      <div
        style={{
          border: "1px solid rgba(244,91,105,0.4)",
          borderRadius: 10,
          padding: 12,
          background: "#261219",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>Planner error</div>
        <div style={{ fontSize: 13 }}>{plannerError}</div>
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <div
        style={{
          border: "1px dashed rgba(255,255,255,0.16)",
          borderRadius: 10,
          padding: 12,
          fontSize: 13,
          opacity: 0.75,
          background: "rgba(12,18,26,0.6)",
        }}
      >
        Planner output pending — evaluate this asset once inventory and state are available.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.65, textTransform: "uppercase" }}>Arbitrage Timeline</div>
      <div style={{ display: "grid", gap: 12 }}>
        {plans.map((plan) => (
          <ArbPlanCard
            key={`${plan.asset}-${plan.direction}`}
            plan={plan}
            statusColor={statusColor}
            inventorySnapshot={inventorySnapshot}
          />
        ))}
      </div>
    </div>
  );
}
