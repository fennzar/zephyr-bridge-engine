import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type KlineRow = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote asset volume
  number, // number of trades
  string, // taker buy base asset volume
  string, // taker buy quote asset volume
  string // ignore
];

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(Math.max(Math.floor(value), 5), 1000);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') ?? 'ZEPHUSDT').toUpperCase();
  const interval = searchParams.get('interval') ?? '1m';
  const limitParam = searchParams.get('limit');
  const limit = clampLimit(limitParam ? Number(limitParam) : 200);

  const url = new URL('/api/v3/klines', 'https://api.mexc.com');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `MEXC klines ${res.status}: ${text}` },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const data = (await res.json()) as KlineRow[];
    const candles = data.map((row) => ({
      time: Math.floor(row[0] / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));

    return NextResponse.json(
      {
        symbol,
        interval,
        candles,
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch klines' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
