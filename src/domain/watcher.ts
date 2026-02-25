import { EventEmitter } from 'eventemitter3';

export type BookTicker = { symbol: string; bid: number; ask: number; ts: number; venue: 'MEXC' | 'EVM' };

export type BookDepth = {
  symbol: string;
  bids: Array<{ price: number; qty: number }>;
  asks: Array<{ price: number; qty: number }>;
  ts: number;
  venue: 'MEXC';
};

export type BookTrade = {
  symbol: string;
  price: number;
  qty: number;
  ts: number;
  venue: 'MEXC';
  side?: 'buy' | 'sell';
};

export class Watcher extends EventEmitter<{
  ticker: [BookTicker];
  depth: [BookDepth];
  trade: [BookTrade];
}> {
  emitTicker(t: BookTicker) {
    this.emit('ticker', t);
  }

  emitDepth(d: BookDepth) {
    this.emit('depth', d);
  }

  emitTrade(t: BookTrade) {
    this.emit('trade', t);
  }
}
