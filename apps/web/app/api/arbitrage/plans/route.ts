import { NextResponse } from "next/server";

import { buildArbPlanReport } from "@services/arbitrage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const report = await buildArbPlanReport();
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build arbitrage plans";
    return NextResponse.json({ generatedAt: new Date().toISOString(), plans: [], pricing: {}, error: message }, { status: 500 });
  }
}
