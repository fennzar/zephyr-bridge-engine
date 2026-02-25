import {
  getAllAssetMetadata,
  type AssetId,
  type AssetMetadata,
} from "@domain/core/assets";
import type { AssetBase } from "@domain/core/assets";

export type { AssetKey, AssetBase } from "@domain/core/assets";
export type { AssetMetadata };

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

const ALL_METADATA = getAllAssetMetadata();

const VARIANTS_BY_BASE = (() => {
  const grouped = new Map<AssetBase, AssetMetadata[]>();
  for (const meta of ALL_METADATA) {
    const bucket = grouped.get(meta.assetBase);
    if (bucket) {
      bucket.push(meta);
    } else {
      grouped.set(meta.assetBase, [meta]);
    }
  }
  const entries = Array.from(grouped.entries(), ([key, list]) => [
    key,
    freeze(list.slice()) as readonly AssetMetadata[],
  ]);
  return Object.fromEntries(entries) as Record<AssetBase, readonly AssetMetadata[]>;
})();

const BASE_BY_VARIANT = (() => {
  const map: Partial<Record<AssetId, AssetBase>> = {};
  for (const meta of ALL_METADATA) {
    map[meta.assetId] = meta.assetBase;
  }
  return freeze(map);
})();

export type AssetVariant = AssetMetadata;

export const ASSET_VARIANTS: Record<AssetBase, readonly AssetVariant[]> = VARIANTS_BY_BASE;

export const ASSET_BASE_BY_VARIANT: Partial<Record<AssetId, AssetBase>> = BASE_BY_VARIANT;

export function findAssetBaseByVariant(assetId: AssetId): AssetBase | null {
  return BASE_BY_VARIANT[assetId] ?? null;
}
