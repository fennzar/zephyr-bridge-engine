import { NextResponse } from "next/server";

import {
  loadInventorySnapshot,
  buildInventoryAssets,
  type InventorySourceOptions,
} from "@domain/inventory/balances";
import type { InventoryApiResponse } from "@domain/inventory/types.api";

export const runtime = "nodejs";

type BooleanParam = boolean | undefined;

function parseBooleanParam(value: string | null, name: string): BooleanParam {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean for '${name}': ${value}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let includeEvm: BooleanParam;
  let includePaperMexc: BooleanParam;
  let includePaperZephyr: BooleanParam;

  try {
    includeEvm = parseBooleanParam(url.searchParams.get("includeEvm"), "includeEvm");
    includePaperMexc = parseBooleanParam(url.searchParams.get("includePaperMexc"), "includePaperMexc");
    includePaperZephyr = parseBooleanParam(url.searchParams.get("includePaperZephyr"), "includePaperZephyr");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid query parameter";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const overrides: Partial<InventorySourceOptions> = {};
  if (includeEvm !== undefined) overrides.includeEvm = includeEvm;
  if (includePaperMexc !== undefined) overrides.includePaperMexc = includePaperMexc;
  if (includePaperZephyr !== undefined) overrides.includePaperZephyr = includePaperZephyr;

  try {
    const snapshot = await loadInventorySnapshot(overrides);
    const assets = buildInventoryAssets(snapshot);

    const response: InventoryApiResponse = {
      generatedAt: new Date().toISOString(),
      sources: {
        evm: snapshot.options.includeEvm,
        paper: {
          mexc: snapshot.options.includePaperMexc,
          zephyr: snapshot.options.includePaperZephyr,
        },
      },
      assets,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory snapshot failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
