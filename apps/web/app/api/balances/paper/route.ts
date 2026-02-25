import { NextResponse } from "next/server";
import { z } from "zod";

import { readPaperBalances, upsertPaperBalance } from "@services/paperBalanceStore";
import type { PaperBalanceStore } from "@shared/paper";
import { parseJsonBody } from "../../_lib/parseBody";

export const runtime = "nodejs";

export async function GET() {
  const store = await readPaperBalances();
  return NextResponse.json(store satisfies PaperBalanceStore);
}

const PaperBalanceSchema = z.object({
  source: z.enum(["mexc", "zephyr"]),
  asset: z.string().min(1, "asset must be a non-empty string"),
  amount: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite("amount must be a finite number")),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, PaperBalanceSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const updated = await upsertPaperBalance(parsed.data.source, parsed.data.asset, parsed.data.amount);
    return NextResponse.json(updated satisfies PaperBalanceStore);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update paper balance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
