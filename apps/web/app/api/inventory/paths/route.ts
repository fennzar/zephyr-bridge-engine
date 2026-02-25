import { NextResponse } from "next/server";

import type { AssetId } from "@domain/types";
import { ASSET_STEPS, findAssetPaths } from "@domain/inventory/graph";

export const runtime = "nodejs";

const ASSET_IDS = Object.keys(ASSET_STEPS) as AssetId[];
const ASSET_SET = new Set<AssetId>(ASSET_IDS);

function toAssetId(value: string | null): AssetId | null {
  if (!value) return null;
  return ASSET_SET.has(value as AssetId) ? (value as AssetId) : null;
}

function parseMaxDepth(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.NaN;
  }
  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = toAssetId(searchParams.get("from"));
  const to = toAssetId(searchParams.get("to"));
  const maxDepthParam = parseMaxDepth(searchParams.get("maxDepth"));

  if (!from || !to) {
    return NextResponse.json(
      {
        error: "Query params 'from' and 'to' are required and must be valid asset ids.",
        assets: ASSET_IDS,
      },
      { status: 400 },
    );
  }

  if (Number.isNaN(maxDepthParam)) {
    return NextResponse.json(
      { error: "maxDepth must be a positive integer when provided." },
      { status: 400 },
    );
  }

  const paths = findAssetPaths(from, to, maxDepthParam);

  return NextResponse.json({
    from,
    to,
    maxDepth: maxDepthParam ?? null,
    count: paths.length,
    paths,
  });
}
