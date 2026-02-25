import { NextResponse } from 'next/server';
import { zephyr } from '@services';
import { mapReserveInfo } from '@domain/zephyr';

export const runtime = 'nodejs';

function fromAtomic(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / 1_000_000_000_000; // 12 decimal places
}

export async function GET() {
  try {
    const result = await zephyr.getReserveInfo();

    const mapped = mapReserveInfo(result);
    if (!mapped) {
      throw new Error('Invalid reserve state');
    }

    const zephPriceUsd = mapped.rates.zeph.spot;
    const zephPriceUsdMa = mapped.rates.zeph.movingAverage;

    const { rates, reserveRatio, reserveRatioMovingAverage, policy } = mapped;

    const response = {
      height: result.height,
      hfVersion: result.hf_version,
      status: result.status,
      equity: fromAtomic(result.equity),
      equityMovingAverage: fromAtomic(result.equity_ma),
      assets: fromAtomic(result.assets),
      assetsMovingAverage: fromAtomic(result.assets_ma),
      liabilities: fromAtomic(result.liabilities),
      zrsCirc: mapped.zrsCirc,
      zsdCirc: mapped.zsdCirc,
      zysCirc: mapped.zysCirc,
      zephInReserve: mapped.zephInReserve,
      zsdInYieldReserve: mapped.zsdInYieldReserve,
      zephPriceUsd,
      zephPriceUsdMovingAverage: zephPriceUsdMa ?? null,
      rates,
      priceSignature: result.pr.signature,
      priceTimestamp: result.pr.timestamp,
      reserveRatio,
      reserveRatioMovingAverage,
      policy: {
        zsd: policy.zsd,
        zrs: policy.zrs,
        reserveRatioThresholds: {
          zsdMintingDisabledBelow: 4,
          zrsMintingDisabledBelow: 4,
          zrsMintingDisabledAbove: 8,
          redeemDiscountBelow: 1,
        },
      },
    };

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch network state';
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
