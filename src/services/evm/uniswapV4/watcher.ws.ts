import type { Address, Hex, Log, PublicClient } from "viem";
import { createLogger } from "@shared/logger";
import { poolManagerEvents, POOL_MANAGER_EVENT_NAMES } from "../abis/poolManager";
import { UniswapV4EventLogHandler } from "./eventLogHandler";
import { DiscoveryMode } from "./utils";

const log = createLogger("EVM:WS");

export interface WsWatcherOpts {
  wsClient: PublicClient; // viem client with webSocket()
  poolManagerAddress: Address;
  handler: UniswapV4EventLogHandler;
  trackedTokens: Address[];
  mode?: DiscoveryMode; // default "bothTracked"
  onEvent?: (event: "initialize" | "swap" | "modify" | "donate", logs: Log[]) => void;
  onError?: (context: string, error: unknown) => void;
}

export class UniswapV4WatcherWS {
  private client: PublicClient;
  private poolManager: Address;
  private handler: UniswapV4EventLogHandler;
  private tracked: Address[];
  private mode: DiscoveryMode;
  private unwatchers: Array<() => void> = [];
  private onEvent?: (event: "initialize" | "swap" | "modify" | "donate", logs: Log[]) => void;
  private onError?: (context: string, error: unknown) => void;

  constructor(opts: WsWatcherOpts) {
    this.client = opts.wsClient;
    this.poolManager = opts.poolManagerAddress;
    this.handler = opts.handler;
    this.tracked = opts.trackedTokens.map((t) => (t as string).toLowerCase() as Address);
    this.mode = opts.mode ?? "bothTracked";
    this.onEvent = opts.onEvent;
    this.onError = opts.onError;
  }

  /** Watch Initialize with token filters (no inline event defs) */
  startInitializeWatch() {
    if (this.mode === "bothTracked") {
      const unwatch = this.client.watchContractEvent({
        address: this.poolManager,
        abi: [poolManagerEvents.Initialize], // <— pre-defined
        eventName: POOL_MANAGER_EVENT_NAMES.Initialize,
        args: { currency0: this.tracked, currency1: this.tracked },
        onLogs: async (logs: Log[]) => {
          await this.handler.handleInitializeLogs(logs);
          if (logs.length) this.onEvent?.("initialize", logs);
        },
        onError: (e) => {
          this.onError?.("initialize", e);
          log.error("Initialize error:", e);
        },
      });
      this.unwatchers.push(unwatch);
      return;
    }

    const un0 = this.client.watchContractEvent({
      address: this.poolManager,
      abi: [poolManagerEvents.Initialize],
      eventName: POOL_MANAGER_EVENT_NAMES.Initialize,
      args: { currency0: this.tracked },
      onLogs: async (logs: Log[]) => {
        await this.handler.handleInitializeLogs(logs);
        if (logs.length) this.onEvent?.("initialize", logs);
      },
      onError: (e) => {
        this.onError?.("initialize", e);
        log.error("Initialize currency0=* error:", e);
      },
    });

    const un1 = this.client.watchContractEvent({
      address: this.poolManager,
      abi: [poolManagerEvents.Initialize],
      eventName: POOL_MANAGER_EVENT_NAMES.Initialize,
      args: { currency1: this.tracked },
      onLogs: async (logs: Log[]) => {
        await this.handler.handleInitializeLogs(logs);
        if (logs.length) this.onEvent?.("initialize", logs);
      },
      onError: (e) => {
        this.onError?.("initialize", e);
        log.error("Initialize currency1=* error:", e);
      },
    });

    this.unwatchers.push(un0, un1);
  }

  /** Watch Swap/Modify/Donate for a moving set of poolIds (no inline event defs) */
  startActivityWatch(poolIds: Hex[]) {
    const filter =
      poolIds.length > 0 ? ({ id: poolIds } as { id: Hex[] }) : undefined;
    const unSwap = this.client.watchContractEvent({
      address: this.poolManager,
      abi: [poolManagerEvents.Swap],
      eventName: POOL_MANAGER_EVENT_NAMES.Swap,
      args: filter,
      onLogs: async (logs: Log[]) => {
        await this.handler.handleSwapLogs(logs);
        if (logs.length) this.onEvent?.("swap", logs);
      },
      onError: (e) => {
        this.onError?.("swap", e);
        log.error("Swap error:", e);
      },
    });

    const unModify = this.client.watchContractEvent({
      address: this.poolManager,
      abi: [poolManagerEvents.ModifyLiquidity],
      eventName: POOL_MANAGER_EVENT_NAMES.ModifyLiquidity,
      args: filter,
      onLogs: async (logs: Log[]) => {
        await this.handler.handleModifyLiquidityLogs(logs);
        if (logs.length) this.onEvent?.("modify", logs);
      },
      onError: (e) => {
        this.onError?.("modify", e);
        log.error("ModifyLiquidity error:", e);
      },
    });

    const unDonate = this.client.watchContractEvent({
      address: this.poolManager,
      abi: [poolManagerEvents.Donate],
      eventName: POOL_MANAGER_EVENT_NAMES.Donate,
      args: filter,
      onLogs: async (logs: Log[]) => {
        await this.handler.handleDonateLogs(logs);
        if (logs.length) this.onEvent?.("donate", logs);
      },
      onError: (e) => {
        this.onError?.("donate", e);
        log.error("Donate error:", e);
      },
    });

    this.unwatchers.push(unSwap, unModify, unDonate);
  }

  stop() {
    for (const u of this.unwatchers) {
      try {
        u();
      } catch {}
    }
    this.unwatchers = [];
  }
}
