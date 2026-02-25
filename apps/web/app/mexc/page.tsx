'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { colors, styles } from '@/components/theme';
import { formatUsd, formatNumber, formatTimestamp } from '@/components/format';
import type { MarketSummary } from '@/types/api';

import { createEmptyMarket, formatTradeTime, PAPER_REFRESH_MS, type PaperAccount, type TradeRow } from './mexc.helpers';
import { OrderBook } from './OrderBook';
import { useMexcWebSocket } from './useMexcWebSocket';

const ZephChart = dynamic(() => import('@/components/ZephChart'), {
  ssr: false,
  loading: () => (
    <section style={{ ...styles.section, height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ opacity: 0.5, fontSize: 13 }}>Loading chart...</span>
    </section>
  ),
});

export default function MexcPage() {
  const [market, setMarket] = useState<MarketSummary>(createEmptyMarket());
  const [paper, setPaper] = useState<PaperAccount | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);

  const { wsStatus, wsError } = useMexcWebSocket(setMarket, setTrades);

  const fetchPaper = useCallback(async () => {
    try {
      const paperRes = await fetch('/api/paper/account', { cache: 'no-store' });
      if (!paperRes.ok) {
        throw new Error(`Paper fetch failed (${paperRes.status})`);
      }
      const paperJson = (await paperRes.json()) as PaperAccount;
      setPaper(paperJson);
      setPaperError(null);
    } catch (err) {
      setPaperError(err instanceof Error ? err.message : 'Failed to load balances');
    }
  }, []);

  useEffect(() => {
    fetchPaper();
    const id = setInterval(fetchPaper, PAPER_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPaper]);

  const bestBidDisplay = market.bestBid > 0 ? market.bestBid.toFixed(4) : '\u2014';
  const bestAskDisplay = market.bestAsk > 0 ? market.bestAsk.toFixed(4) : '\u2014';
  const spreadDisplay = market.spread > 0 ? `${market.spread.toFixed(4)} (${market.spreadBps.toFixed(2)} bps)` : '\u2014';
  const depthDisplay = `${formatUsd(market.depthUsd.bidUsd)} / ${formatUsd(market.depthUsd.askUsd)}`;
  const recentTrades = trades.slice(0, 20);

  return (
    <main style={{ ...styles.pageContainer, maxWidth: 1120 }}>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>MEXC: ZEPH/USDT Market</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <span style={styles.label}>
          WS Status:{' '}
          <strong style={{ color: wsStatus === 'live' ? colors.accent.green : wsStatus === 'connecting' ? colors.accent.orange : colors.accent.red }}>
            {wsStatus}
          </strong>
        </span>
        {wsError ? <span style={{ fontSize: 12, color: colors.accent.red }}>{wsError}</span> : null}
        {paperError ? <span style={{ fontSize: 12, color: colors.accent.red }}>{paperError}</span> : null}
      </div>

      <div style={{ marginBottom: 24 }}>
        <ZephChart />
      </div>

      <section
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          marginBottom: 24,
        }}
      >
        <div style={styles.section}>
          <div style={styles.label}>Top of Book</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: colors.text.muted }}>Best Bid</span>
              <strong style={{ color: colors.accent.green }}>{bestBidDisplay}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: colors.text.muted }}>Best Ask</span>
              <strong style={{ color: colors.accent.orange }}>{bestAskDisplay}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: colors.text.muted }}>Spread</span>
              <span>{spreadDisplay}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: colors.text.muted }}>Depth (bid/ask)</span>
              <span>{depthDisplay}</span>
            </div>
            <div style={{ fontSize: 12, color: colors.text.dimmed }}>
              Updated: {formatTimestamp(market.generatedAt)}
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.label}>Paper Balances</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {paper
              ? Object.entries(paper.balances).map(([asset, balance]) => (
                  <div key={asset} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.text.muted }}>{asset}</span>
                    <span>
                      {formatNumber(balance.available, 4)}
                      {balance.hold > 0 ? (
                        <span style={{ color: colors.text.dimmed }}> (hold {formatNumber(balance.hold, 4)})</span>
                      ) : null}
                    </span>
                  </div>
                ))
              : null}
            <div style={{ fontSize: 12, color: colors.text.dimmed }}>Ledger: {paper ? formatTimestamp(paper.updatedAt) : '\u2014'}</div>
          </div>
        </div>
      </section>

      <section style={{ ...styles.section, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Recent Trades</div>
          <div style={{ fontSize: 12, color: colors.text.dimmed }}>Latest {recentTrades.length || '-'} events</div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {recentTrades.map((trade, idx) => {
            const priceColor = trade.side === 'buy' ? colors.accent.green : colors.accent.red;
            return (
              <div
                key={`${trade.ts}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 90px 90px 120px 1fr',
                  gap: 12,
                  fontSize: 13,
                  fontFamily: 'ui-monospace',
                }}
              >
                <span style={{ color: colors.text.dimmed }}>{formatTradeTime(trade.ts)}</span>
                <span style={{ color: priceColor }}>{trade.price.toFixed(4)}</span>
                <span>{trade.qty.toFixed(2)}</span>
                <span style={{ color: colors.text.muted }}>{formatUsd(trade.price * trade.qty)}</span>
                <span style={{ color: priceColor, fontWeight: 600 }}>{trade.side.toUpperCase()}</span>
              </div>
            );
          })}
          {recentTrades.length === 0 ? (
            <div style={{ color: colors.text.dimmed, fontSize: 13 }}>Waiting for trades...</div>
          ) : null}
        </div>
      </section>

      <OrderBook bids={market.bids} asks={market.asks} />

      <section style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Recent Paper Events</div>
          <div style={{ fontSize: 12, color: colors.text.dimmed }}>Latest 10</div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {paper?.events.slice(0, 10).map((event) => (
            <div
              key={event.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 160px',
                gap: 12,
                fontSize: 13,
                fontFamily: 'ui-monospace',
              }}
            >
              <span style={{ color: colors.text.dimmed }}>{formatTimestamp(event.timestamp)}</span>
              <span>
                {event.type === 'trade'
                  ? `${event.symbol} ${event.side} qty=${event.quantity.toFixed(4)} px=${event.price.toFixed(4)} fee=${event.fee.toFixed(4)} ${event.feeAsset}`
                  : `${event.type.toUpperCase()} ${event.amount.toFixed(4)} ${event.asset}`}
              </span>
              <span style={{ color: colors.text.dimmed }}>
                {event.type === 'trade'
                  ? `\u0394base=${event.baseDelta.toFixed(4)} \u0394quote=${event.quoteDelta.toFixed(2)}`
                  : event.note ?? ''}
              </span>
            </div>
          ))}
          {paper && paper.events.length === 0 ? (
            <div style={{ color: colors.text.dimmed, fontSize: 13 }}>No events yet.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
