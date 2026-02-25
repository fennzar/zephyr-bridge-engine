const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export type Venue = "evm" | "native" | "cex";

export type AssetBase = "ETH" | "USDT" | "ZEPH" | "ZSD" | "ZRS" | "ZYS";
export type AssetKey = AssetBase;

export type AssetId =
  | "ETH.e"
  | "USDT.e"
  | "WZSD.e"
  | "WZEPH.e"
  | "WZRS.e"
  | "WZYS.e"
  | "ZSD.n"
  | "ZEPH.n"
  | "ZRS.n"
  | "ZYS.n"
  | "ZEPH.x"
  | "USDT.x";

export type AssetHoldingSource =
  | { type: "evm"; mode: "token" | "native" }
  | { type: "paper"; ledger: "mexc" | "zephyr" };

export interface AssetMetadata {
  assetId: AssetId;
  assetBase: AssetBase;
  venue: Venue;
  decimals: number;
  defaultSource: AssetHoldingSource;
  defaultSourceLabel: string;
}

const createEvmSource = (mode: "token" | "native"): AssetHoldingSource => ({
  type: "evm",
  mode,
});

const createPaperSource = (ledger: "mexc" | "zephyr"): AssetHoldingSource => ({
  type: "paper",
  ledger,
});

const METADATA_LIST: AssetMetadata[] = [
  {
    assetId: "ETH.e",
    assetBase: "ETH",
    venue: "evm",
    decimals: 18,
    defaultSource: createEvmSource("native"),
    defaultSourceLabel: "evm:native",
  },
  {
    assetId: "USDT.e",
    assetBase: "USDT",
    venue: "evm",
    decimals: 6,
    defaultSource: createEvmSource("token"),
    defaultSourceLabel: "evm",
  },
  {
    assetId: "USDT.x",
    assetBase: "USDT",
    venue: "cex",
    decimals: 6,
    defaultSource: createPaperSource("mexc"),
    defaultSourceLabel: "paper:mexc",
  },
  {
    assetId: "WZSD.e",
    assetBase: "ZSD",
    venue: "evm",
    decimals: 12,
    defaultSource: createEvmSource("token"),
    defaultSourceLabel: "evm",
  },
  {
    assetId: "ZSD.n",
    assetBase: "ZSD",
    venue: "native",
    decimals: 12,
    defaultSource: createPaperSource("zephyr"),
    defaultSourceLabel: "paper:zephyr",
  },
  {
    assetId: "WZEPH.e",
    assetBase: "ZEPH",
    venue: "evm",
    decimals: 12,
    defaultSource: createEvmSource("token"),
    defaultSourceLabel: "evm",
  },
  {
    assetId: "ZEPH.n",
    assetBase: "ZEPH",
    venue: "native",
    decimals: 12,
    defaultSource: createPaperSource("zephyr"),
    defaultSourceLabel: "paper:zephyr",
  },
  {
    assetId: "ZEPH.x",
    assetBase: "ZEPH",
    venue: "cex",
    decimals: 8,
    defaultSource: createPaperSource("mexc"),
    defaultSourceLabel: "paper:mexc",
  },
  {
    assetId: "WZRS.e",
    assetBase: "ZRS",
    venue: "evm",
    decimals: 12,
    defaultSource: createEvmSource("token"),
    defaultSourceLabel: "evm",
  },
  {
    assetId: "ZRS.n",
    assetBase: "ZRS",
    venue: "native",
    decimals: 12,
    defaultSource: createPaperSource("zephyr"),
    defaultSourceLabel: "paper:zephyr",
  },
  {
    assetId: "WZYS.e",
    assetBase: "ZYS",
    venue: "evm",
    decimals: 12,
    defaultSource: createEvmSource("token"),
    defaultSourceLabel: "evm",
  },
  {
    assetId: "ZYS.n",
    assetBase: "ZYS",
    venue: "native",
    decimals: 12,
    defaultSource: createPaperSource("zephyr"),
    defaultSourceLabel: "paper:zephyr",
  },
];

const METADATA_BY_ASSET_ID: Record<AssetId, AssetMetadata> = Object.fromEntries(
  METADATA_LIST.map((meta) => [meta.assetId, freeze(meta)]),
) as Record<AssetId, AssetMetadata>;

const METADATA_BY_BASE: Record<AssetBase, readonly AssetMetadata[]> = (() => {
  const grouped: Record<AssetBase, AssetMetadata[]> = {
    ETH: [],
    USDT: [],
    ZEPH: [],
    ZSD: [],
    ZRS: [],
    ZYS: [],
  };
  for (const meta of METADATA_LIST) {
    grouped[meta.assetBase].push(meta);
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([key, list]) => [key, freeze(list.slice())]),
  ) as Record<AssetBase, readonly AssetMetadata[]>;
})();

export const ASSET_IDS = freeze(Object.keys(METADATA_BY_ASSET_ID) as AssetId[]);

export function getAssetMetadata(assetId: AssetId): AssetMetadata {
  const meta = METADATA_BY_ASSET_ID[assetId];
  if (!meta) {
    throw new Error(`Unknown asset id: ${assetId}`);
  }
  return meta;
}

export function getAssetMetadataByBase(assetBase: AssetBase): readonly AssetMetadata[] {
  return METADATA_BY_BASE[assetBase];
}

export function getAllAssetMetadata(): readonly AssetMetadata[] {
  return freeze(METADATA_LIST.slice());
}

export function getAssetVenue(assetId: AssetId): Venue {
  return getAssetMetadata(assetId).venue;
}

export function getAssetDecimals(assetId: AssetId): number {
  return getAssetMetadata(assetId).decimals;
}

export function getDefaultHoldingSource(assetId: AssetId): AssetHoldingSource {
  return getAssetMetadata(assetId).defaultSource;
}

export function getDefaultHoldingSourceLabel(assetId: AssetId): string {
  return getAssetMetadata(assetId).defaultSourceLabel;
}

export function isAssetId(candidate: unknown): candidate is AssetId {
  return typeof candidate === "string" && candidate in METADATA_BY_ASSET_ID;
}

export function getAssetBase(assetId: AssetId): AssetBase {
  return getAssetMetadata(assetId).assetBase;
}

export function isAssetBase(candidate: unknown): candidate is AssetBase {
  return typeof candidate === "string" && candidate in METADATA_BY_BASE;
}

