import { jsonResponse } from "../../shared/json";

import type { GlobalState } from "@domain/state/types";
import { buildGlobalState } from "@domain/state/state.builder";

export async function GET() {
  const start = Date.now();
  let state: GlobalState | null = null;

  try {
    state = await buildGlobalState();
  } catch (error) {
    return jsonResponse(
      {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        error: (error as Error).message ?? "Failed to build global state snapshot.",
      },
      { status: 500 },
    );
  }

  return jsonResponse({
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
    state,
  });
}
