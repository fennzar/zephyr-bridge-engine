import crypto from 'node:crypto';
import fetch from 'cross-fetch';

export type MexcConfig = {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string; // default https://api.mexc.com
  recvWindow?: number; // default 5000
};

export class MexcRest {
  private base: string;
  private key: string;
  private secret: string;
  private recvWindow: number;
  constructor(cfg: MexcConfig) {
    this.base = cfg.baseUrl || 'https://api.mexc.com';
    this.key = cfg.apiKey;
    this.secret = cfg.apiSecret;
    this.recvWindow = cfg.recvWindow ?? 5000;
  }

  private sign(params: Record<string, string|number|undefined>) {
    const kv = Object.entries(params)
      .filter(([,v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const sig = crypto.createHmac('sha256', this.secret).update(kv).digest('hex');
    return { query: kv + `&signature=${sig}`, signature: sig };
  }

  private async authed(path: string, params: Record<string, string|number|undefined> = {}, method = 'GET') {
    const timestamp = Date.now();
    const common = { ...params, recvWindow: this.recvWindow, timestamp };
    const { query } = this.sign(common);
    const url = this.base + path + (method === 'GET' || method === 'DELETE' ? `?${query}` : '');
    const res = await fetch(url, {
      method,
      headers: { 'X-MEXC-APIKEY': this.key, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(common) : undefined
    });
    if (!res.ok) throw new Error(`MEXC ${method} ${path} ${res.status}`);
    return res.json().catch(() => ({}));
  }

  async time() { return fetch(this.base + '/api/v3/time').then(r => r.json()); }
  async ping() { return fetch(this.base + '/api/v3/ping').then(r => r.json()); }

  // Account
  async account() { return this.authed('/api/v3/account'); }
  async tradeFee(symbol: string) { return this.authed('/api/v3/tradeFee', { symbol }); }

  // Orders
  async orderTest(params: { symbol: string; side: 'BUY'|'SELL'; type: 'LIMIT'|'MARKET'; quantity?: string; quoteOrderQty?: string; price?: string; }) {
    return this.authed('/api/v3/order/test', params, 'POST');
  }
  async order(params: { symbol: string; side: 'BUY'|'SELL'; type: 'LIMIT'|'MARKET'; quantity?: string; quoteOrderQty?: string; price?: string; }) {
    return this.authed('/api/v3/order', params, 'POST');
  }
  async cancel(symbol: string, orderId?: string, origClientOrderId?: string) {
    return this.authed('/api/v3/order', { symbol, orderId, origClientOrderId }, 'DELETE');
  }
}
