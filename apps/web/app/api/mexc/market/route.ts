import { mexc } from '@services';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') ?? 'ZEPHUSDT';
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 20;
  try {
    const summary = await mexc.summarizeDepth(symbol, limit);
    return NextResponse.json(summary, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch depth' },
      { status: 500 }
    );
  }
}
