import { config as loadEnvFile } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const WS_URL_REGEX = /^wss?:\/\/.+/i;
const DATABASE_URL_REGEX = /^postgres(?:ql)?:\/\/.+/i;
const wsUrlSchema = z
  .string()
  .regex(WS_URL_REGEX, 'Must be a ws:// or wss:// URL');

const ENV_LOADED_FLAG = Symbol.for('zephyr.shared.env.loaded');

function loadEnvOnce(): void {
  if (typeof process === 'undefined') return;
  const globalRef = globalThis as Record<string | symbol, unknown>;
  if (globalRef[ENV_LOADED_FLAG]) return;

  const roots = new Set<string>();
  const cwd = process.cwd();
  let current = cwd;
  for (let i = 0; i < 4; i += 1) {
    roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  roots.add(resolve(moduleDir, '..', '..'));
  roots.add(resolve(moduleDir, '..', '..', '..'));
  roots.add(resolve(moduleDir, '..', '..', '..', '..'));

  for (const root of roots) {
    for (const name of ['.env.local', '.env']) {
      const path = resolve(root, name);
      if (existsSync(path)) {
        loadEnvFile({ path, override: false });
      }
    }
  }

  globalRef[ENV_LOADED_FLAG] = true;
}

loadEnvOnce();

const emptyToUndefined = (val: unknown) => {
  if (typeof val === 'string' && val.trim() === '') return undefined;
  return val;
};

const optionalUrl = () => z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalWsUrl = () => z.preprocess(emptyToUndefined, wsUrlSchema.optional());
const optionalNumericString = () =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d+$/, 'Must be a positive integer')
      .optional()
  );
const optionalNumber = () =>
  z.preprocess(
    emptyToUndefined,
    z
      .coerce
      .number({ invalid_type_error: 'Must be a number' })
      .refine((value) => Number.isFinite(value), 'Must be a finite number')
      .optional(),
  );

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  ZEPHYR_ENV: z.enum(['local', 'sepolia', 'mainnet']).default('local'),

  ZEPHYR_D_RPC_URL: z.string().url().default('http://remote-node.zephyrprotocol.com:17767'),
  ZEPHYR_WALLET_RPC_URL: optionalUrl(),
  ZEPHYR_WALLET_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  ZEPHYR_BRIDGE_ADDRESS: z.preprocess(emptyToUndefined, z.string().optional()),
  BRIDGE_API_URL: optionalUrl(),
  EXECUTION_TIMING: z.enum(['instant', 'realistic']).default('instant'),

  // CEX wallet (real Zephyr wallet + EVM address for simulated exchange)
  CEX_WALLET_RPC_URL: optionalUrl(),
  CEX_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed address')
    .optional(),
  CEX_PK: z.string().min(2).optional(),

  RPC_URL_LOCAL_HTTP: z.string().url().default('http://127.0.0.1:8545'),
  RPC_URL_LOCAL_WS: wsUrlSchema.default('ws://127.0.0.1:8545'),

  RPC_URL_SEPOLIA_HTTP: optionalUrl(),
  RPC_URL_SEPOLIA_WS: optionalWsUrl(),

  RPC_URL_MAINNET_HTTP: optionalUrl(),
  RPC_URL_MAINNET_WS: optionalWsUrl(),

  // Legacy single-endpoint variables for backward compatibility. Prefer the *_HTTP/*_WS variants.
  RPC_URL_LOCAL: z.preprocess(emptyToUndefined, z.string().optional()),
  RPC_URL_SEPOLIA: z.preprocess(emptyToUndefined, z.string().optional()),
  RPC_URL_MAINNET: z.preprocess(emptyToUndefined, z.string().optional()),

  EVM_PRIVATE_KEY: z.string().min(2).optional(), // 0x...
  EVM_WALLET_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed address')
    .optional(),

  MEXC_API_KEY: z.string().optional(),
  MEXC_API_SECRET: z.string().optional(),
  MEXC_PAPER: z.preprocess(
    (val) => {
      if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
      if (typeof val === 'boolean') return val;
      return undefined;
    },
    z.boolean().default(false)
  ),
  ZEPHYR_PAPER: z.preprocess(
    (val) => {
      if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
      if (typeof val === 'boolean') return val;
      return undefined;
    },
    z.boolean().default(false)
  ),

  NEXT_PUBLIC_APP_NAME: z.string().optional(),
  DATABASE_URL: z
    .preprocess(emptyToUndefined, z.string().regex(DATABASE_URL_REGEX, 'Must be a postgres:// connection string'))
    .optional(),
  UNISWAP_V4_START_BLOCK_LOCAL: optionalNumericString(),
  UNISWAP_V4_START_BLOCK_SEPOLIA: optionalNumericString(),
  UNISWAP_V4_START_BLOCK_MAINNET: optionalNumericString(),
  EVM_WATCHER_PORT: optionalNumericString(),
  MEXC_WATCHER_PORT: optionalNumericString(),
  GAS_TOKEN_USD_PRICE: optionalNumber(),
  ADMIN_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type NetworkEnv = 'local'|'sepolia'|'mainnet';

type EnvValues = z.infer<typeof EnvSchema>;

function toWsUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  return undefined;
}

function pickRpcHttp(env: EnvValues): string {
  switch (env.ZEPHYR_ENV) {
    case 'mainnet':
      return env.RPC_URL_MAINNET_HTTP || env.RPC_URL_MAINNET || '';
    case 'sepolia':
      return env.RPC_URL_SEPOLIA_HTTP || env.RPC_URL_SEPOLIA || '';
    case 'local':
    default:
      return env.RPC_URL_LOCAL_HTTP || env.RPC_URL_LOCAL || '';
  }
}

function pickRpcWs(env: EnvValues): string {
  switch (env.ZEPHYR_ENV) {
    case 'mainnet':
      return (
        env.RPC_URL_MAINNET_WS
        || toWsUrl(env.RPC_URL_MAINNET_HTTP)
        || toWsUrl(env.RPC_URL_MAINNET)
        || ''
      );
    case 'sepolia':
      return (
        env.RPC_URL_SEPOLIA_WS
        || toWsUrl(env.RPC_URL_SEPOLIA_HTTP)
        || toWsUrl(env.RPC_URL_SEPOLIA)
        || ''
      );
    case 'local':
    default:
      return env.RPC_URL_LOCAL_WS || toWsUrl(env.RPC_URL_LOCAL_HTTP) || toWsUrl(env.RPC_URL_LOCAL) || '';
  }
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = {
  ...parsed.data,
  RPC_URL_HTTP: pickRpcHttp(parsed.data),
  RPC_URL_WS: pickRpcWs(parsed.data),
  RPC_URL: pickRpcHttp(parsed.data), // alias for compatibility
  EVM_WATCHER_PORT: parsed.data.EVM_WATCHER_PORT
    ? Number(parsed.data.EVM_WATCHER_PORT)
    : 7010,
  MEXC_WATCHER_PORT: parsed.data.MEXC_WATCHER_PORT
    ? Number(parsed.data.MEXC_WATCHER_PORT)
    : 7020,
  GAS_TOKEN_USD_PRICE: parsed.data.GAS_TOKEN_USD_PRICE,
};
