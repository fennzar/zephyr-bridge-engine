import { NextResponse } from "next/server";
import { getCexBalances } from "@services/cex/client";
import { cexRpc } from "@services/cex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [balances, walletReady] = await Promise.all([
      getCexBalances().catch(() => ({ ZEPH: 0, USDT: 0 })),
      cexRpc.isReady(),
    ]);

    return NextResponse.json({
      balances,
      walletReady,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch CEX status" },
      { status: 500 },
    );
  }
}
