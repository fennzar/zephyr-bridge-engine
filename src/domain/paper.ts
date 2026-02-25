export type PaperBalance = Record<string, number>;

export class PaperLedger {
  balances: PaperBalance = {};
  constructor(init?: PaperBalance) {
    this.balances = { ...(init || {}) };
  }
  credit(asset: string, qty: number) { this.balances[asset] = (this.balances[asset] || 0) + qty; }
  debit(asset: string, qty: number) { this.balances[asset] = (this.balances[asset] || 0) - qty; }
  get(asset: string) { return this.balances[asset] || 0; }
}
