import { getPools } from "@services/evm/uniswapV4";
import { getMexcDepth } from "@services/mexc/market";
import { getReserve } from "@services/zephyr";

import {
  buildArbitrageSnapshotView,
  type ArbAsset,
  type ArbitrageSnapshot,
  type CexPricing,
  type DexPricing,
  type NativePricing,
} from "@domain/arbitrage/snapshotView";

import { loadBalanceSnapshot } from "./balances";

export type { ArbAsset, ArbitrageSnapshot, CexPricing, DexPricing, NativePricing } from "@domain/arbitrage/snapshotView";

export async function buildArbSnapshot(): Promise<ArbitrageSnapshot> {
  const [pools, mexcMarket, reserveInfo, balances] = await Promise.all([
    getPools().catch(() => []),
    getMexcDepth("ZEPH_USDT").catch(() => null),
    getReserve().catch(() => null),
    loadBalanceSnapshot(),
  ]);

  return buildArbitrageSnapshotView({
    pools,
    mexcMarket,
    reserveInfo,
    balances,
  });
}
