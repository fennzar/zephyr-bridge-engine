import { NextResponse } from "next/server";
import { z } from "zod";

import { performPoolAction } from "@services/evm/poolMaintenance";
import { parseJsonBody } from "../../_lib/parseBody";

const ActionSchema = z.object({
  action: z.enum(["refresh", "backfill", "reset"]),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, ActionSchema);
  if ("error" in parsed) return parsed.error;

  const result = await performPoolAction(parsed.data.action);
  return NextResponse.json({ success: true, result });
}
