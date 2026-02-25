import { NextResponse } from "next/server";

import { buildGlobalState } from "@domain/state/state.builder";
import { analyzeArbMarkets, buildPricingFromState } from "@domain/arbitrage/analysis";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await buildGlobalState();
    const analysis = analyzeArbMarkets(state);
    const pricing = buildPricingFromState(state);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        assets: analysis,
        pricing,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute arbitrage analysis";
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        assets: [],
        pricing: {},
        error: message,
      },
      { status: 500 },
    );
  }
}
