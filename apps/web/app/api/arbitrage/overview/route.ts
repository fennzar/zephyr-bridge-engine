import { NextResponse } from "next/server";
import { buildArbSnapshot } from "@services/arbitrage";

export const runtime = "nodejs";

export async function GET() {
  const data = await buildArbSnapshot();
  return NextResponse.json(data, { status: 200 });
}
