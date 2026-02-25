import { NextResponse } from "next/server";
import { prisma } from "@infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENUE_MAP: Record<string, { from: string; to: string }> = {
  wrap: { from: "native", to: "evm" },
  unwrap: { from: "evm", to: "native" },
  deposit_cex: { from: "native", to: "cex" },
  withdraw_cex: { from: "cex", to: "native" },
};

const ASSET_SYMBOLS = ["ZEPH", "ZSD", "ZRS", "ZYS"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, asset, amount } = body as {
      action: string;
      asset: string;
      amount: number;
    };

    // Validate
    if (!action || !VENUE_MAP[action]) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${Object.keys(VENUE_MAP).join(", ")}` },
        { status: 400 },
      );
    }
    if (!asset || !ASSET_SYMBOLS.includes(asset.toUpperCase())) {
      return NextResponse.json(
        { error: `Invalid asset. Must be one of: ${ASSET_SYMBOLS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!amount || typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount)) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 },
      );
    }

    const normalizedAsset = asset.toUpperCase();
    const { from: fromVenue, to: toVenue } = VENUE_MAP[action];

    // Map asset to the right symbol per venue
    const evmSymbol = `W${normalizedAsset}`;
    const fromSymbol = fromVenue === "evm" ? evmSymbol : normalizedAsset;
    const toSymbol = toVenue === "evm" ? evmSymbol : normalizedAsset;

    // Read current balances
    const [fromBalance, toBalance] = await Promise.all([
      prisma.inventoryBalance.findFirst({
        where: { assetId: fromSymbol, venue: fromVenue },
      }),
      prisma.inventoryBalance.findFirst({
        where: { assetId: toSymbol, venue: toVenue },
      }),
    ]);

    const fromAmount = fromBalance?.amount?.toNumber() ?? 0;
    const toAmount = toBalance?.amount?.toNumber() ?? 0;

    if (fromAmount < amount) {
      return NextResponse.json(
        {
          error: `Insufficient ${fromSymbol} balance on ${fromVenue}. Have: ${fromAmount}, need: ${amount}`,
        },
        { status: 400 },
      );
    }

    // Apply deltas
    await prisma.$transaction([
      prisma.inventoryBalance.upsert({
        where: {
          assetId_venue: { assetId: fromSymbol, venue: fromVenue },
        },
        update: { amount: { decrement: amount } },
        create: {
          assetId: fromSymbol,
          venue: fromVenue,
          amount: 0,
          valueUsd: 0,
        },
      }),
      prisma.inventoryBalance.upsert({
        where: {
          assetId_venue: { assetId: toSymbol, venue: toVenue },
        },
        update: { amount: { increment: amount } },
        create: {
          assetId: toSymbol,
          venue: toVenue,
          amount: amount,
          valueUsd: 0,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      action,
      asset: normalizedAsset,
      amount,
      before: {
        [fromVenue]: { symbol: fromSymbol, amount: fromAmount },
        [toVenue]: { symbol: toSymbol, amount: toAmount },
      },
      after: {
        [fromVenue]: { symbol: fromSymbol, amount: fromAmount - amount },
        [toVenue]: { symbol: toSymbol, amount: toAmount + amount },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
