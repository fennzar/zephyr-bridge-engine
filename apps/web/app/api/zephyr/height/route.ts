import { NextResponse } from 'next/server';
import { zephyr } from '@services';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { height } = await zephyr.getHeight();
    return NextResponse.json({ height }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch height';
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
