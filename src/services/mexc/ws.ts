import WebSocket, { type RawData, type ErrorEvent } from 'ws';
import { EventEmitter } from 'eventemitter3';

import { decodeMexcPush, type MexcPushMessage } from './parser';

export type MexcWsBookTickerEvent = {
  type: 'bookTicker';
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
};

export type MexcWsDepthEvent = {
  type: 'depth';
  symbol: string;
  bids: Array<{ price: number; qty: number }>;
  asks: Array<{ price: number; qty: number }>;
  ts: number;
};

export type MexcWsAggTradeEvent = {
  type: 'aggTrade';
  symbol: string;
  price: number;
  qty: number;
  ts: number;
  side?: 'buy' | 'sell';
};

export type MexcWsEvent = MexcWsBookTickerEvent | MexcWsDepthEvent | MexcWsAggTradeEvent;

export type MexcWsError = {
  type: 'socket' | 'subscription' | 'parse';
  message: string;
  code?: number | string;
  details?: unknown;
};

export type MexcWsOptions = {
  depth?: boolean;
  depthLevels?: number;
  aggTrades?: boolean;
  tickerInterval?: string;
  depthInterval?: string;
  dealsInterval?: string;
};

const FAKE_ORDERBOOK_ENABLED = process.env.FAKE_ORDERBOOK_ENABLED === 'true';
const FAKE_ORDERBOOK_PORT = process.env.FAKE_ORDERBOOK_PORT || '5556';
const DEFAULT_WS_URL = FAKE_ORDERBOOK_ENABLED
  ? `ws://127.0.0.1:${FAKE_ORDERBOOK_PORT}`
  : 'wss://wbs-api.mexc.com/ws';

export class MexcWs extends EventEmitter<{
  event: [MexcWsEvent];
  error: [MexcWsError];
}> {
  private ws?: WebSocket;

  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;

  constructor(private url = DEFAULT_WS_URL) {
    super();
  }

  connect(symbols: string[], options: MexcWsOptions = {}) {
    const depthLevels = options.depthLevels ?? 50;
    const topics = buildTopics(symbols, options);

    if (topics.length === 0) {
      throw new Error('At least one topic must be subscribed');
    }

    this.ws = new WebSocket(this.url);
    this.ws.on('open', () => {
      this.ws?.send(JSON.stringify({ method: 'SUBSCRIPTION', params: topics, id: Date.now() }));
      this.startPing();
    });

    this.ws.on('message', (raw: RawData) => {
      this.handleMessage(raw, depthLevels);
    });

    this.ws.on('close', () => {
      this.scheduleReconnect(symbols, options);
    });

    this.ws.on('error', (err: ErrorEvent) => {
      const socketError = err.error as NodeJS.ErrnoException | undefined;
      this.emit('error', {
        type: 'socket',
        message: err.message || socketError?.message || 'MEXC websocket error',
        code: socketError?.code,
        details: socketError ?? err,
      });
      this.ws?.close();
    });
  }

  private scheduleReconnect(symbols: string[], options: MexcWsOptions) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.stopPing();
    this.reconnectTimer = setTimeout(() => this.connect(symbols, options), 1000);
  }

  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopPing();
    this.ws?.close();
  }

  private handleMessage(raw: RawData, depthLevels: number) {
    const buffer = normalizeRawData(raw);
    if (!buffer) return;

    if (buffer.length === 0) return;
    if (buffer[0] === 0x7b) {
      try {
        const msg = JSON.parse(buffer.toString('utf8'));

        // Handle fake orderbook JSON depth messages
        if (FAKE_ORDERBOOK_ENABLED && msg.c && msg.d) {
          const data = msg.d;
          const symbol = data.s?.toUpperCase();
          if (symbol && msg.c.includes('depth')) {
            const bids = (data.b || [])
              .map(([price, qty]: [string, string]) => ({
                price: Number(price),
                qty: Number(qty),
              }))
              .filter((l: { price: number; qty: number }) => Number.isFinite(l.price) && Number.isFinite(l.qty))
              .slice(0, depthLevels);
            const asks = (data.a || [])
              .map(([price, qty]: [string, string]) => ({
                price: Number(price),
                qty: Number(qty),
              }))
              .filter((l: { price: number; qty: number }) => Number.isFinite(l.price) && Number.isFinite(l.qty))
              .slice(0, depthLevels);

            if (bids.length > 0 || asks.length > 0) {
              this.emit('event', {
                type: 'depth',
                symbol,
                bids,
                asks,
                ts: data.t || Date.now(),
              });
            }
            return;
          }
        }

        const subscriptionError = parseSubscriptionError(msg);
        if (subscriptionError) {
          this.emit('error', subscriptionError);
        }
      } catch {
        // ignore malformed acknowledgements
      }
      return;
    }

    const message = decodeMexcPush(buffer);
    if (!message) {
      this.emit('error', {
        type: 'parse',
        message: 'Unrecognized MEXC protobuf payload',
      });
      return;
    }

    const symbol = extractSymbol(message);
    if (!symbol) return;

    if (message.type === 'bookTicker') {
      const bid = Number(message.bidPrice);
      const ask = Number(message.askPrice);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;

      this.emit('event', {
        type: 'bookTicker',
        symbol,
        bid,
        ask,
        ts: message.ts,
      });
      return;
    }

    if (message.type === 'depth') {
      const bids = message.bids
        .map((level) => ({
          price: Number(level.price),
          qty: Number(level.quantity),
        }))
        .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.qty))
        .slice(0, depthLevels);
      const asks = message.asks
        .map((level) => ({
          price: Number(level.price),
          qty: Number(level.quantity),
        }))
        .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.qty))
        .slice(0, depthLevels);

      if (bids.length === 0 && asks.length === 0) return;

      this.emit('event', {
        type: 'depth',
        symbol,
        bids,
        asks,
        ts: message.ts,
      });
      return;
    }

    if (message.type === 'deals') {
      for (const deal of message.deals) {
        const price = Number(deal.price);
        const qty = Number(deal.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
        const ts = Number.isFinite(deal.time) && deal.time > 0 ? deal.time : message.ts;
        const side = deal.tradeType === 2 ? 'sell' : 'buy';
        this.emit('event', {
          type: 'aggTrade',
          symbol,
          price,
          qty,
          ts,
          side,
        });
      }
    }
  }

  private startPing() {
    if (this.pingTimer) return;
    const interval = Number(process.env.MEXC_WS_PING_INTERVAL_MS ?? 20_000);
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ method: 'PING' }));
      } catch (error) {
        this.emit('error', {
          type: 'socket',
          message: error instanceof Error ? error.message : 'Failed to send MEXC ping',
          details: error,
        });
      }
    }, interval);
  }

  private stopPing() {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}

function parseSubscriptionError(message: unknown): MexcWsError | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const knownSuccessCodes = new Set([0, 200]);

  const msgObject = message as Record<string, unknown>;
  const topLevelCode = normalizeNumeric(msgObject.code);
  const topLevelMessage = extractMessage(msgObject);

  if (topLevelCode !== undefined && !knownSuccessCodes.has(topLevelCode)) {
    return {
      type: 'subscription',
      message: topLevelMessage ?? `MEXC subscription failed (code ${topLevelCode})`,
      code: topLevelCode,
      details: message,
    };
  }

  const data = msgObject.data ?? msgObject.d;
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    const nestedCode = normalizeNumeric(nested.code ?? nested.s ?? nested.status);
    const nestedMessage = extractMessage(nested);

    if (nestedCode !== undefined && !knownSuccessCodes.has(nestedCode)) {
      return {
        type: 'subscription',
        message: nestedMessage ?? `MEXC subscription failed (code ${nestedCode})`,
        code: nestedCode,
        details: message,
      };
    }

    if (
      typeof nestedMessage === 'string' &&
      nestedMessage.toLowerCase().includes('error')
    ) {
      return {
        type: 'subscription',
        message: nestedMessage,
        details: message,
      };
    }
  }

  if (
    typeof msgObject.c === 'string' &&
    msgObject.c.toLowerCase() === 'error' &&
    typeof topLevelMessage === 'string'
  ) {
    return {
      type: 'subscription',
      message: topLevelMessage,
      details: message,
    };
  }

  return undefined;
}

function normalizeNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

function extractMessage(value: Record<string, unknown>): string | undefined {
  const messageKeys = ['msg', 'message', 'm', 'error'];
  for (const key of messageKeys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
  }
  return undefined;
}

function normalizeRawData(raw: RawData): Buffer | undefined {
  if (typeof raw === 'string') {
    return Buffer.from(raw);
  }
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
  }
  return undefined;
}

function extractSymbol(message: MexcPushMessage): string | undefined {
  if (message.symbol && message.symbol.length > 0) {
    return message.symbol.toUpperCase();
  }
  const parts = message.channel.split('@');
  const maybeSymbol = parts[parts.length - 1];
  if (!maybeSymbol) return undefined;
  return maybeSymbol.toUpperCase();
}

function buildTopics(symbols: string[], options: MexcWsOptions): string[] {
  const uniq = new Set<string>();
  const params: string[] = [];
  const tickerInterval = options.tickerInterval ?? '100ms';
  const depthInterval = options.depthInterval ?? '100ms';
  const dealsInterval = options.dealsInterval ?? '100ms';

  for (const symbolRaw of symbols) {
    const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!symbol) continue;

    const tickerTopic = `spot@public.aggre.bookTicker.v3.api.pb@${tickerInterval}@${symbol}`;
    uniq.add(tickerTopic);

    if (options.depth ?? true) {
      uniq.add(`spot@public.aggre.depth.v3.api.pb@${depthInterval}@${symbol}`);
    }

    if (options.aggTrades ?? true) {
      uniq.add(`spot@public.aggre.deals.v3.api.pb@${dealsInterval}@${symbol}`);
    }
  }

  uniq.forEach((topic) => params.push(topic));
  return params;
}
