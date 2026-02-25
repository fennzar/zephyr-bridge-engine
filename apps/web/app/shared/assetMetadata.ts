import type { AssetId } from "@domain/types";

const DEFAULT_DECIMALS = 12;

const ASSET_DECIMALS: Record<AssetId, number> = {
  "ETH.e": 18,
  "USDT.e": 6,
  "WZSD.e": 12,
  "WZEPH.e": 12,
  "WZRS.e": 12,
  "WZYS.e": 12,
  "ZSD.n": 12,
  "ZEPH.n": 12,
  "ZRS.n": 12,
  "ZYS.n": 12,
  "ZEPH.x": 8, // TODO: confirm CEX precision; MEXC currently reports 8 decimals.
  "USDT.x": 6,
};

export function getAssetDecimals(asset: AssetId): number {
  return ASSET_DECIMALS[asset] ?? DEFAULT_DECIMALS;
}
