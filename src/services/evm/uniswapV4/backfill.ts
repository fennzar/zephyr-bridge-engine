import type { Address, Hex, Log, PublicClient } from "viem";
import { poolManagerEvents } from "../abis/poolManager";
import { chunk, sleep, withBackoff } from "./utils";
import { UniswapV4EventLogHandler } from "./eventLogHandler";

export interface BackfillOpts {
  client: PublicClient; // HTTP client
  poolManagerAddress: Address;
  handler: UniswapV4EventLogHandler; // central DB writer
  poolIds: Hex[];
  fromBlock: bigint;
  toBlock: bigint;
  blockBatchSize?: bigint; // default 2500n
  idChunkSize?: number; // default 50
  maxRequestsPerSecond?: number;
}

export class UniswapV4Backfill {
  private client: PublicClient;
  private poolManager: Address;
  private handler: UniswapV4EventLogHandler;
  private batchSize: bigint;
  private idChunkSize: number;
  private rps?: number;

  constructor(opts: Omit<BackfillOpts, "poolIds" | "fromBlock" | "toBlock">) {
    this.client = opts.client;
    this.poolManager = opts.poolManagerAddress;
    this.handler = opts.handler;
    this.batchSize = opts.blockBatchSize ?? 2500n;
    this.idChunkSize = opts.idChunkSize ?? 50;
    this.rps = opts.maxRequestsPerSecond;
  }

  async backfill(
    poolIds: Hex[],
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<{ swaps: number; modifies: number; donates: number }> {
    let swaps = 0,
      modifies = 0,
      donates = 0;

    const idChunks = chunk(poolIds, this.idChunkSize);

    for (let start = fromBlock; start <= toBlock; start += this.batchSize) {
      const end = start + this.batchSize - 1n > toBlock ? toBlock : start + this.batchSize - 1n;

      for (const ids of idChunks) {
        const [swapLogs, modifyLogs, donateLogs] = await Promise.all([
          this.getLogs(poolManagerEvents.Swap, ids, start, end),
          this.getLogs(poolManagerEvents.ModifyLiquidity, ids, start, end),
          this.getLogs(poolManagerEvents.Donate, ids, start, end),
        ]);

        if (swapLogs.length) {
          await this.handler.handleSwapLogs(swapLogs);
          swaps += swapLogs.length;
        }
        if (modifyLogs.length) {
          await this.handler.handleModifyLiquidityLogs(modifyLogs);
          modifies += modifyLogs.length;
        }
        if (donateLogs.length) {
          await this.handler.handleDonateLogs(donateLogs);
          donates += donateLogs.length;
        }
      }

      if (this.rps) await sleep(Math.ceil(1000 / this.rps));
    }

    return { swaps, modifies, donates };
  }

  private async getLogs(
    eventItem: (typeof poolManagerEvents)[keyof typeof poolManagerEvents],
    poolIds: Hex[],
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<Log[]> {
    return withBackoff(() =>
      this.client.getLogs({
        address: this.poolManager,
        event: eventItem,
        args: { id: poolIds } as any,
        fromBlock,
        toBlock,
        strict: false,
      })
    );
  }
}
