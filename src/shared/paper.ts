export type PaperSource = 'mexc' | 'zephyr';

export type PaperBalanceRecord = Record<string, number>;

export type PaperBalanceStore = {
  mexc: PaperBalanceRecord;
  zephyr: PaperBalanceRecord;
  updatedAt: string;
};
