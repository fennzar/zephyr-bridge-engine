import { env } from "@shared";
import { createLogger } from "@shared/logger";
import { loadBalanceSnapshot } from "@services/arbitrage";
import { prisma } from "@infra";

const log = createLogger("Inventory");
import type { AssetId } from "@domain/types";
import type { InventoryBalances } from "@domain/pathing/types";
import type { BalanceSnapshot } from "./types";
export type { BalanceSnapshot } from "./types";
export {
  getEvmTokenBalance,
  getPaperBalance,
  getPaperTotalBalance,
  getEvmBalanceForSymbol,
} from "./types";
import { ASSET_VARIANTS, type AssetBase } from "@domain/assets/variants";
import type { InventoryAssetView, InventoryVariantView } from "./types.api";

const DEFAULT_OPTIONS = {
  includeEvm: true,
  includePaperMexc: Boolean(env.MEXC_PAPER),
  includePaperZephyr: Boolean(env.ZEPHYR_PAPER),
} satisfies InventorySourceOptions;

const EVM_TOKEN_TO_ASSET: Partial<Record<string, AssetId>> = {
  USDT: "USDT.e",
  WZSD: "WZSD.e",
  WZEPH: "WZEPH.e",
  WZRS: "WZRS.e",
  WZYS: "WZYS.e",
};

const NATIVE_SYMBOL_TO_ASSET: Partial<Record<string, AssetId>> = {
  ZSD: "ZSD.n",
  ZEPH: "ZEPH.n",
  ZRS: "ZRS.n",
  ZYS: "ZYS.n",
};

const CEX_SYMBOL_TO_ASSET: Partial<Record<string, AssetId>> = {
  USDT: "USDT.x",
  ZEPH: "ZEPH.x",
};

const EVM_NATIVE_ASSET: AssetId = "ETH.e";

export type InventoryAssetKey = AssetBase;

export type InventoryAssetTotals = Partial<Record<InventoryAssetKey, number>>;

export interface InventorySourceOptions {
  includeEvm: boolean;
  includePaperMexc: boolean;
  includePaperZephyr: boolean;
}

export interface InventorySnapshot {
  balances: InventoryBalances;
  totals: InventoryAssetTotals;
  options: InventorySourceOptions;
}

export async function loadInventorySnapshot(
  options?: Partial<InventorySourceOptions>,
): Promise<InventorySnapshot> {
  let snapshot: BalanceSnapshot | null = null;
  try {
    snapshot = await loadBalanceSnapshot();
  } catch {
    snapshot = null;
  }

  const { balances, options: resolvedOptions } = snapshot
    ? mapBalanceSnapshot(snapshot, options)
    : { balances: {}, options: resolveOptions(null, options) };
  const totals = computeAssetTotals(balances);
  return { balances, totals, options: resolvedOptions };
}

export async function loadInventoryBalances(options?: Partial<InventorySourceOptions>): Promise<InventoryBalances> {
  const { balances } = await loadInventorySnapshot(options);
  return balances;
}

function resolveOptions(
  snapshot: BalanceSnapshot | null,
  overrides?: Partial<InventorySourceOptions>,
): InventorySourceOptions {
  return {
    includeEvm: overrides?.includeEvm ?? DEFAULT_OPTIONS.includeEvm,
    includePaperMexc:
      overrides?.includePaperMexc ?? snapshot?.config?.mexcPaper ?? DEFAULT_OPTIONS.includePaperMexc,
    includePaperZephyr:
      overrides?.includePaperZephyr ?? snapshot?.config?.zephyrPaper ?? DEFAULT_OPTIONS.includePaperZephyr,
  };
}

export function mapBalanceSnapshot(
  snapshot: BalanceSnapshot,
  options?: Partial<InventorySourceOptions>,
): { balances: InventoryBalances; options: InventorySourceOptions } {
  const resolved = resolveOptions(snapshot, options);
  const balances: InventoryBalances = {};

  if (resolved.includeEvm && snapshot.evm.status === "ok") {
    if (Number.isFinite(snapshot.evm.native)) {
      balances[EVM_NATIVE_ASSET] = (balances[EVM_NATIVE_ASSET] ?? 0) + (snapshot.evm.native ?? 0);
    }

    Object.entries(snapshot.evm.tokens ?? {}).forEach(([symbol, amount]) => {
      if (!Number.isFinite(amount)) return;
      const asset = EVM_TOKEN_TO_ASSET[symbol.toUpperCase()];
      if (!asset) return;
      balances[asset] = (balances[asset] ?? 0) + (amount as number);
    });
  }

  if (resolved.includePaperZephyr && snapshot.paper?.zephyr) {
    Object.entries(snapshot.paper.zephyr).forEach(([symbol, amount]) => {
      if (!Number.isFinite(amount)) return;
      const asset = NATIVE_SYMBOL_TO_ASSET[symbol.toUpperCase()];
      if (!asset) return;
      balances[asset] = (balances[asset] ?? 0) + (amount as number);
    });
  }

  // Real zephyr wallet (when not using paper)
  if (!resolved.includePaperZephyr && snapshot.zephyr?.status === "ok" && snapshot.zephyr.balances) {
    const zb = snapshot.zephyr.balances;
    // Use UNLOCKED balances — those are spendable
    for (const [symbol, amount] of [
      ["ZEPH", zb.unlockedZeph],
      ["ZSD", zb.unlockedZsd],
      ["ZRS", zb.unlockedZrs],
      ["ZYS", zb.unlockedZys],
    ] as const) {
      if (!Number.isFinite(amount) || amount === 0) continue;
      const asset = NATIVE_SYMBOL_TO_ASSET[symbol];
      if (asset) balances[asset] = (balances[asset] ?? 0) + amount;
    }
  }

  // CEX balances from real wallets (preferred when available)
  if (snapshot.cex?.status === "ok" && snapshot.cex.balances) {
    for (const [symbol, amount] of Object.entries(snapshot.cex.balances)) {
      if (!Number.isFinite(amount) || amount === 0) continue;
      const asset = CEX_SYMBOL_TO_ASSET[symbol.toUpperCase()];
      if (asset) balances[asset] = (balances[asset] ?? 0) + amount;
    }
  } else if (resolved.includePaperMexc && snapshot.paper?.mexc) {
    // Fallback to paper balance store if CEX wallets unavailable
    Object.entries(snapshot.paper.mexc).forEach(([symbol, amount]) => {
      if (!Number.isFinite(amount)) return;
      const asset = CEX_SYMBOL_TO_ASSET[symbol.toUpperCase()];
      if (!asset) return;
      balances[asset] = (balances[asset] ?? 0) + (amount as number);
    });
  }

  return { balances, options: resolved };
}

export function computeAssetTotals(balances: InventoryBalances): InventoryAssetTotals {
  const totals: InventoryAssetTotals = {};
  (Object.keys(ASSET_VARIANTS) as InventoryAssetKey[]).forEach((key) => {
    const variants = ASSET_VARIANTS[key];
    const sum = variants.reduce<number>((acc, variant) => {
      const value = balances[variant.assetId];
      if (value == null || !Number.isFinite(value)) return acc;
      return acc + (value as number);
    }, 0);
    totals[key] = sum;
  });
  return totals;
}

export function buildInventoryAssets(snapshot: InventorySnapshot): InventoryAssetView[] {
  return (Object.keys(ASSET_VARIANTS) as AssetBase[]).map((key) => {
    const variantsDef = ASSET_VARIANTS[key];
    const variants: InventoryVariantView[] = variantsDef.map<InventoryVariantView>((variant) => ({
      assetId: variant.assetId,
      amount: snapshot.balances[variant.assetId] ?? 0,
      source: variant.defaultSourceLabel,
    }));
    const total = snapshot.totals[key] ?? variants.reduce((acc, entry) => acc + entry.amount, 0);
    return { key, total, variants } satisfies InventoryAssetView;
  });
}

// =============================================================================
// Database Sync
// =============================================================================

/**
 * Get venue for an asset ID based on its suffix.
 */
function getVenueForAsset(assetId: AssetId): string {
  if (assetId.endsWith(".e")) return "evm";
  if (assetId.endsWith(".n")) return "native";
  if (assetId.endsWith(".x")) return "cex";
  return "unknown";
}

/**
 * Sync the current inventory snapshot to the database.
 * Uses upsert to update existing records or create new ones.
 */
export async function syncInventoryToDb(
  snapshot: InventorySnapshot,
  priceMap?: Partial<Record<AssetId, number>>,
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  const entries = Object.entries(snapshot.balances) as [AssetId, number][];

  for (const [assetId, amount] of entries) {
    if (amount === 0) continue; // Skip zero balances

    const venue = getVenueForAsset(assetId);
    const valueUsd = priceMap?.[assetId] != null ? priceMap[assetId]! * amount : null;

    try {
      await prisma.inventoryBalance.upsert({
        where: {
          assetId_venue: {
            assetId,
            venue,
          },
        },
        update: {
          amount,
          valueUsd,
        },
        create: {
          assetId,
          venue,
          amount,
          valueUsd,
        },
      });
      synced++;
    } catch (error) {
      log.error(`Failed to sync ${assetId}:`, error);
      errors++;
    }
  }

  return { synced, errors };
}

/**
 * Load the latest inventory balances from the database.
 */
export async function loadInventoryFromDb(): Promise<InventoryBalances> {
  const records = await prisma.inventoryBalance.findMany();
  
  const balances: InventoryBalances = {};
  for (const record of records) {
    const assetId = record.assetId as AssetId;
    balances[assetId] = Number(record.amount);
  }
  
  return balances;
}
