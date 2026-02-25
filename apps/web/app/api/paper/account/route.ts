import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPaperStore } from '@/lib/mexcPaperStore';
import { parseJsonBody } from '../../_lib/parseBody';

export const runtime = 'nodejs';

export async function GET() {
  const store = getPaperStore();
  return NextResponse.json(store.snapshot(), { headers: { 'Cache-Control': 'no-store' } });
}

const PostSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('deposit'), asset: z.string().min(1), amount: z.number(), note: z.string().optional() }),
  z.object({ action: z.literal('withdraw'), asset: z.string().min(1), amount: z.number(), note: z.string().optional() }),
  z.object({ action: z.literal('trade'), symbol: z.string().min(1), side: z.enum(['BUY', 'SELL']), quantity: z.number().positive() }),
  z.object({ action: z.literal('reset'), balances: z.record(z.string(), z.number()) }),
]);

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, PostSchema);
  if ('error' in parsed) return parsed.error;

  const store = getPaperStore();
  try {
    switch (parsed.data.action) {
      case 'deposit':
        store.deposit(parsed.data.asset, parsed.data.amount, parsed.data.note);
        break;
      case 'withdraw':
        store.withdraw(parsed.data.asset, parsed.data.amount, parsed.data.note);
        break;
      case 'trade':
        await store.marketOrder({
          symbol: parsed.data.symbol,
          side: parsed.data.side,
          quantity: parsed.data.quantity,
        });
        break;
      case 'reset':
        store.reset(parsed.data.balances);
        break;
    }
    return NextResponse.json(store.snapshot(), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Paper action failed' },
      { status: 400 }
    );
  }
}
