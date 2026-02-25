import type { NetworkEnv } from '@shared';
import addressesLocal from './addresses.local.json' with { type: 'json' };
import addressesSepolia from './addresses.sepolia.json' with { type: 'json' };
import addressesMainnet from './addresses.mainnet.json' with { type: 'json' };

export type TokenEntry = {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
};

export type PoolPlanPosition = {
  pct: number;
  bandBps: number;
};

export type PoolPlanConfig = {
  key: {
    tokenA: string;
    tokenB: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  pricing: {
    base: string;
    quote: string;
    price: string;
  };
  budget: {
    quoteSymbol: string;
    totalQuoteHuman: string;
    positions: PoolPlanPosition[];
  };
};

export type PoolConfig = {
  id: string;
  address?: string;
  plan?: PoolPlanConfig;
};

export type AddressConfig = {
  version: number;
  chainId: number;
  contracts: Record<string, string>;
  tokens: Record<string, TokenEntry>;
  pools?: PoolConfig[];
};

export type TrackedToken = TokenEntry & { key: string };

const CONFIGS: Record<NetworkEnv, AddressConfig> = {
  local: addressesLocal as AddressConfig,
  sepolia: addressesSepolia as AddressConfig,
  mainnet: addressesMainnet as AddressConfig,
};

export function getNetworkConfig(env: NetworkEnv): AddressConfig {
  return CONFIGS[env] ?? CONFIGS.local;
}

export function getTrackedTokens(env: NetworkEnv): TrackedToken[] {
  const config = getNetworkConfig(env);
  return Object.entries(config.tokens).map(([key, token]) => ({
    key,
    ...token,
  }));
}

export function getTrackedTokenMap(env: NetworkEnv): Record<string, TrackedToken> {
  return getTrackedTokens(env).reduce<Record<string, TrackedToken>>((acc, token) => {
    acc[token.key] = token;
    return acc;
  }, {});
}

export function getTrackedTokenAddressIndex(env: NetworkEnv): Record<string, TrackedToken> {
  return getTrackedTokens(env).reduce<Record<string, TrackedToken>>((acc, token) => {
    acc[token.address.toLowerCase()] = token;
    return acc;
  }, {});
}
