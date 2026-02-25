import { type prisma, type Token as DbToken } from "@infra";
import { erc20Abi } from "../abis/erc20";
import type { EvmLogger } from "../logging";
import type { Address, PublicClient } from "viem";

import { toLowerAddress, type DbTokenLike } from "./persistence.utils";

/**
 * Ensure a token row exists in the database, creating it on-chain-read
 * if necessary. Returns the token record.
 */
export async function ensureToken(
  db: typeof prisma,
  client: PublicClient,
  logger: EvmLogger,
  chainId: number,
  trackedByAddress: Record<string, DbTokenLike>,
  address: Address,
): Promise<DbToken> {
  const lower = toLowerAddress(address);
  const existing = await db.token.findUnique({
    where: {
      chainId_address: {
        chainId,
        address: lower,
      },
    },
  });
  if (existing) return existing;

  const tracked = trackedByAddress[lower];
  let symbol = tracked?.symbol ?? null;
  let name = tracked?.name ?? null;
  let decimals = tracked?.decimals ?? null;

  if (!decimals || !symbol || !name) {
    try {
      decimals = Number(
        await client.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      );
    } catch (error) {
      logger.warn?.("[uniswapV4] failed reading token decimals", { address, error });
    }

    try {
      symbol = (await client.readContract({
        address,
        abi: erc20Abi,
        functionName: "symbol",
      })) as string;
    } catch (error) {
      logger.warn?.("[uniswapV4] failed reading token symbol", { address, error });
    }

    try {
      name = (await client.readContract({
        address,
        abi: erc20Abi,
        functionName: "name",
      })) as string;
    } catch (error) {
      logger.warn?.("[uniswapV4] failed reading token name", { address, error });
    }
  }

  const created = await db.token.create({
    data: {
      chainId,
      address: lower,
      decimals: decimals ?? tracked?.decimals ?? 18,
      symbol: symbol ?? tracked?.symbol ?? "UNKNOWN",
      name: name ?? tracked?.name ?? "Unknown Token",
      metadata: tracked ? { source: "config", key: tracked.key } : { source: "onchain" },
    },
  });

  logger.info?.("[uniswapV4] registered token", {
    address: created.address,
    symbol: created.symbol,
  });
  return created;
}
