import type { Address, Hex, Log, PublicClient } from "viem";
import { poolManagerEvents } from "../abis/poolManager";
import { withBackoff, sleep, DiscoveryMode } from "./utils";

export interface DiscoveryOpts {
  client: PublicClient; // HTTP client
  poolManagerAddress: Address;
  trackedTokens: Address[];
  mode?: DiscoveryMode;
  fromBlock: bigint;
  toBlock: bigint;
  blockBatchSize?: bigint; // default 2500n
  maxRequestsPerSecond?: number; // soft throttle
}

export class UniswapV4Discovery {
  private client: PublicClient;
  private poolManager: Address;
  private tracked: Address[];
  private mode: DiscoveryMode;
  private batchSize: bigint;
  private rps?: number;

  constructor(opts: Omit<DiscoveryOpts, "fromBlock" | "toBlock">) {
    this.client = opts.client;
    this.poolManager = opts.poolManagerAddress;
    this.tracked = opts.trackedTokens.map((t) => (t as string).toLowerCase() as Address);
    this.mode = opts.mode ?? "bothTracked";
    this.batchSize = opts.blockBatchSize ?? 2500n;
    this.rps = opts.maxRequestsPerSecond;
  }

  async discoverInitializeLogs(
    fromBlock: bigint,
    toBlock: bigint,
    onLogs: (logs: Log[]) => Promise<void>
  ): Promise<{ poolIds: Set<Hex>; totalLogs: number }> {
    const poolIds = new Set<Hex>();
    let totalLogs = 0;

    for (let start = fromBlock; start <= toBlock; start += this.batchSize) {
      const end = start + this.batchSize - 1n > toBlock ? toBlock : start + this.batchSize - 1n;

      const calls: Array<Promise<Log[]>> = [];
      if (this.mode === "bothTracked") {
        calls.push(this.getInitializeLogs(start, end, this.tracked, this.tracked));
      } else {
        calls.push(this.getInitializeLogs(start, end, this.tracked, undefined));
        calls.push(this.getInitializeLogs(start, end, undefined, this.tracked));
      }

      const pages = await Promise.all(calls);
      for (const logs of pages) {
        if (!logs.length) continue;
        totalLogs += logs.length;
        await onLogs(logs);
        for (const l of logs) {
          // `args` present because we supplied `event`
          // @ts-expect-error decoded args
          poolIds.add(l.args.id as Hex);
        }
      }

      if (this.rps) await sleep(Math.ceil(1000 / this.rps));
    }

    return { poolIds, totalLogs };
  }

  private async getInitializeLogs(
    fromBlock: bigint,
    toBlock: bigint,
    currency0List?: Address[],
    currency1List?: Address[]
  ): Promise<Log[]> {
    return withBackoff(() =>
      this.client.getLogs({
        address: this.poolManager,
        event: poolManagerEvents.Initialize,
        args: {
          ...(currency0List ? { currency0: currency0List } : {}),
          ...(currency1List ? { currency1: currency1List } : {}),
        } as any,
        fromBlock,
        toBlock,
        strict: false,
      })
    );
  }
}
