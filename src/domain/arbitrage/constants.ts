// src/domain/arbitrage/constants.ts

export const FEES = {
  STABLE: 0.0003, // 0.03% USDT/WZSD
  WZEPH: 0.003, // 0.30% WZEPH/WZSD
  WZYS: 0.0005, // 0.05% WZYS/WZSD
  CEX: 0.001, // 0.10% taker
  WRAP: 0.0005, // 0.05% round-trip overhead (wrap+unwrap)
};
export const THRESHOLDS_BPS = {
  STABLE: 12, // 8–12 bps is typical; start with 12 bps
  ZEPH: 100, // 80–100 bps is typical; start with 100 bps
  ZYS: 30, // 20–35 bps is typical; start with 30 bps
  ZRS: 100,
};
export const MAX_POOL_SHARE = 0.1; // 10% of quoted pool depth cap
