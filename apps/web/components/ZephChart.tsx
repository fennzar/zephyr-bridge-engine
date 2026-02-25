'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { colors, styles } from '@/components/theme';

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartMode = 'candles' | 'line';

type FetchState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  candles: Candle[];
  error?: string;
};

const REFRESH_MS = 60_000;

export function ZephChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);

  const [mode, setMode] = useState<ChartMode>('candles');
  const [{ status, candles, error }, setState] = useState<FetchState>({ status: 'idle', candles: [] });

  const fetchCandles = useCallback(async () => {
    setState((prev) => ({ ...prev, status: prev.candles.length ? 'ready' : 'loading' }));
    try {
      const res = await fetch('/api/mexc/klines?symbol=ZEPHUSDT&interval=1m&limit=300', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const data = (json?.candles ?? []) as Candle[];
      setState({ status: 'ready', candles: data, error: undefined });
    } catch (err) {
      setState({ status: 'error', candles: [], error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: colors.bg.section },
        textColor: colors.text.primary,
      },
      grid: {
        vertLines: { color: colors.border.subtle },
        horzLines: { color: colors.border.subtle },
      },
      timeScale: {
        borderColor: colors.border.subtle,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: colors.border.subtle,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.4)', labelBackgroundColor: colors.border.primary },
        horzLine: { color: 'rgba(255,255,255,0.4)', labelBackgroundColor: colors.border.primary },
      },
      width: container.clientWidth,
      height: 320,
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (!container || !chartRef.current) return;
      chartRef.current.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    fetchCandles();
    const id = window.setInterval(fetchCandles, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchCandles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (mode === 'candles') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: colors.accent.green,
        downColor: colors.accent.red,
        wickUpColor: colors.accent.green,
        wickDownColor: colors.accent.red,
        borderVisible: false,
      });
      series.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }))
      );
      chart.timeScale().fitContent();
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(AreaSeries, {
        lineColor: colors.accent.green,
        topColor: 'rgba(22,199,132,0.35)',
        bottomColor: 'rgba(22,199,132,0.05)',
        lineWidth: 2,
      });
      series.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          value: candle.close,
        }))
      );
      chart.timeScale().fitContent();
      seriesRef.current = series;
    }
  }, [candles, mode]);

  const statusLabel = useMemo(() => {
    if (status === 'loading' && candles.length === 0) return 'Loading candles…';
    if (status === 'error') return error ?? 'Failed to load data';
    if (candles.length === 0) return 'No candle data available';
    return null;
  }, [status, error, candles.length]);

  return (
    <section style={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>ZEPH/USDT Chart</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setMode('candles')}
            style={{
              ...styles.button,
              background: mode === 'candles' ? colors.border.primary : 'transparent',
              border: `1px solid ${colors.border.input}`,
            }}
          >
            Candles
          </button>
          <button
            type="button"
            onClick={() => setMode('line')}
            style={{
              ...styles.button,
              background: mode === 'line' ? colors.border.primary : 'transparent',
              border: `1px solid ${colors.border.input}`,
            }}
          >
            Line
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: 320,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      />
      {statusLabel ? (
        <div style={{ marginTop: 8, fontSize: 12, color: colors.text.dimmed }}>{statusLabel}</div>
      ) : null}
    </section>
  );
}

export default ZephChart;
