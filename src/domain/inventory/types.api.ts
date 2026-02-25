import type { AssetId } from "@domain/types";
import type { AssetBase } from "@domain/assets/variants";

export interface InventoryVariantView {
  assetId: AssetId;
  amount: number;
  source: string;
}

export interface InventoryAssetView {
  key: AssetBase;
  total: number;
  variants: InventoryVariantView[];
}

export interface InventoryApiResponse {
  generatedAt: string;
  sources: {
    evm: boolean;
    paper: {
      mexc: boolean;
      zephyr: boolean;
    };
  };
  assets: InventoryAssetView[];
}
