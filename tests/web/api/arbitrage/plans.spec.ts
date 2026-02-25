import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArbitragePlanReport } from "@services/arbitrage";

vi.mock("@services/arbitrage", () => ({
  buildArbPlanReport: vi.fn(),
}));

const ROUTE_PATH = "../../../../apps/web/app/api/arbitrage/plans/route";

describe("GET /api/arbitrage/plans", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns the plan report when the service succeeds", async () => {
    const mockReport: ArbitragePlanReport = {
      generatedAt: "2025-01-01T00:00:00.000Z",
      plans: [{ id: "plan-1" }] as ArbitragePlanReport["plans"],
      error: null,
    };

    const { buildArbPlanReport } = await import("@services/arbitrage");
    vi.mocked(buildArbPlanReport).mockResolvedValue(mockReport);

    const { GET } = await import(ROUTE_PATH);
    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(mockReport);
  });

  it("returns an error payload when the service throws", async () => {
    const { buildArbPlanReport } = await import("@services/arbitrage");
    vi.mocked(buildArbPlanReport).mockRejectedValue(new Error("boom"));

    const { GET } = await import(ROUTE_PATH);
    const response = await GET();

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.plans).toEqual([]);
    expect(payload.pricing).toEqual({});
    expect(payload.error).toContain("boom");
    expect(typeof payload.generatedAt).toBe("string");
  });
});
