import { env, type NetworkEnv } from "@shared";
import { createLogger } from "@shared/logger";

const log = createLogger("EVM:Config");

export function normalizeNetwork(value?: string): NetworkEnv | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "local" || normalized === "sepolia" || normalized === "mainnet") {
    return normalized;
  }
  log.warn(`Unknown network "${value}". Falling back to env configuration.`);
  return undefined;
}

export function parseBigInt(value?: string, context?: string): bigint | undefined {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      log.warn(`${context ?? "value"} must be non-negative. Ignoring override.`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    log.warn(`Invalid ${context ?? "value"} "${value}". Ignoring override.`, error);
    return undefined;
  }
}

export function parseOptionalBigInt(value?: string): bigint | undefined {
  return parseBigInt(value, "from-block");
}

export function resolveDefaultStartBlock(network: NetworkEnv): bigint | undefined {
  const raw =
    network === "local"
      ? env.UNISWAP_V4_START_BLOCK_LOCAL
      : network === "sepolia"
        ? env.UNISWAP_V4_START_BLOCK_SEPOLIA
        : env.UNISWAP_V4_START_BLOCK_MAINNET;

  const configured = parseBigInt(raw, `${network} env start block`);
  if (configured !== undefined) {
    return configured;
  }

  if (network === "local") return 0n;
  if (network === "sepolia") return 9_265_810n;
  return undefined;
}
