import http, { type Server as HttpServer } from "node:http";

import {
  createPublicClient,
  getAddress,
  http as httpTransport,
  webSocket,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { chainFromKey, type ChainKey } from "../viemClient";
import type { NetworkEnv } from "@shared";
import { env } from "@shared";
import { getNetworkConfig } from "../config";
import { resolveDefaultStartBlock } from "../networkConfig";
import { createEvmLogger, type EvmLogger } from "../logging";
import { UniswapV4EventLogHandler, type HandlerDeps } from "./eventLogHandler";
import { UniswapV4Discovery } from "./discovery";
import { UniswapV4Backfill } from "./backfill";
import { UniswapV4WatcherWS } from "./watcher.ws";
import { PrismaUniswapV4DbPort } from "./persistence";
import { prisma, PoolProtocol } from "@infra";
import type { PrismaClient } from "@prisma/client";
import type { DiscoveryMode } from "./utils";

const DEFAULT_LOOKBACK = 5_000n;
const DEFAULT_SYNC_INTERVAL_MS = 5_000;

type WatcherActivitySource = "initialize" | "swap" | "modify" | "donate";

type WatcherHealthState = {
  task: "EVM_WATCHER";
  network: NetworkEnv;
  state: "starting" | "historical_sync" | "running" | "stopped" | "error";
  wsConnected: boolean;
  lastActivityAt?: string;
  lastActivitySource?: WatcherActivitySource;
  lastError?: string;
  lastSyncAt?: string;
  startedAt: string;
  stoppedAt?: string;
  pid: number;
  port?: number;
};

class InstrumentedEventLogHandler extends UniswapV4EventLogHandler {
  constructor(
    deps: HandlerDeps,
    private readonly record: (source: WatcherActivitySource) => void,
  ) {
    super(deps);
  }

  async handleInitializeLogs(logs: Log[]): Promise<void> {
    if (logs.length === 0) return;
    await super.handleInitializeLogs(logs);
    this.record("initialize");
  }

  async handleSwapLogs(logs: Log[]): Promise<void> {
    if (logs.length === 0) return;
    await super.handleSwapLogs(logs);
    this.record("swap");
  }

  async handleModifyLiquidityLogs(logs: Log[]): Promise<void> {
    if (logs.length === 0) return;
    await super.handleModifyLiquidityLogs(logs);
    this.record("modify");
  }

  async handleDonateLogs(logs: Log[]): Promise<void> {
    if (logs.length === 0) return;
    await super.handleDonateLogs(logs);
    this.record("donate");
  }
}

export type UniswapV4WatcherRunnerOptions = {
  network?: NetworkEnv;
  startBlock?: bigint;
  rpcHttpUrl?: string;
  rpcWsUrl?: string;
  discoveryMode?: DiscoveryMode;
  blockBatchSize?: bigint;
  idChunkSize?: number;
  maxRequestsPerSecond?: number;
  pollIntervalMs?: number;
  logger?: EvmLogger;
  prismaClient?: PrismaClient;
};

export type UniswapV4WatcherHandle = {
  stop: () => Promise<void>;
};

export class UniswapV4WatcherRunner {
  private readonly options: UniswapV4WatcherRunnerOptions;
  private readonly network: NetworkEnv;
  private readonly logger: EvmLogger;
  private readonly prisma: PrismaClient;
  private readonly healthPort: number;
  private httpClient?: PublicClient;
  private wsClient?: PublicClient;
  private dbPort?: PrismaUniswapV4DbPort;
  private handler?: UniswapV4EventLogHandler;
  private discovery?: UniswapV4Discovery;
  private backfill?: UniswapV4Backfill;
  private wsWatcher?: UniswapV4WatcherWS;
  private chainId?: number;
  private pollTimer?: NodeJS.Timeout;
  private running = false;
  private healthServer?: HttpServer;
  private healthStatus: WatcherHealthState;

  constructor(options: UniswapV4WatcherRunnerOptions = {}) {
    this.options = options;
    this.network = options.network ?? env.ZEPHYR_ENV;
    this.logger = options.logger ?? createEvmLogger("uniswapV4:runner");
    this.prisma = (options.prismaClient ?? (prisma as unknown as PrismaClient));
    const desiredPort = Number(process.env.EVM_WATCHER_PORT ?? env.EVM_WATCHER_PORT ?? 7010);
    this.healthPort = Number.isFinite(desiredPort) ? desiredPort : 7010;
    this.healthStatus = {
      task: "EVM_WATCHER",
      network: this.network,
      state: "starting",
      wsConnected: false,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    };
  }

  async start(): Promise<UniswapV4WatcherHandle> {
    if (this.running) {
      throw new Error("UniswapV4WatcherRunner already started");
    }

    this.ensureHealthServer();

    try {
      await this.ensureClients();
      await this.ensureServices();

      this.updateHealthStatus({ state: "historical_sync", lastError: undefined });
      await this.runHistoricalSync();

      await this.startRealtime();
      this.updateHealthStatus({
        state: "running",
        lastSyncAt: new Date().toISOString(),
      });

      const interval = this.options.pollIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
      this.pollTimer = setInterval(() => {
        this.syncLatest().catch((error) => {
          this.logger.error?.("[uniswapV4] periodic sync failed", error);
          this.updateHealthStatus({
            lastError: error instanceof Error ? error.message : String(error),
          });
        });
      }, interval);

      this.running = true;
    } catch (error) {
      this.updateHealthStatus({
        state: "error",
        lastError: error instanceof Error ? error.message : String(error),
        wsConnected: false,
      });
      throw error;
    }

    return {
      stop: async () => {
        if (!this.running) return;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = undefined;
        }
        if (this.wsWatcher) {
          this.wsWatcher.stop();
          this.wsWatcher = undefined;
        }
        this.updateHealthStatus({
          state: "stopped",
          wsConnected: false,
          stoppedAt: new Date().toISOString(),
        });
        await this.shutdownHealthServer();
        this.running = false;
      },
    };
  }

  private async ensureClients(): Promise<void> {
    if (this.httpClient) return;

    const chainKey = this.network as ChainKey;
    const rpcHttpUrl = this.options.rpcHttpUrl ?? resolveRpcHttp(this.network);
    if (!rpcHttpUrl) {
      throw new Error(`Missing RPC HTTP URL for network ${this.network}`);
    }

    this.httpClient = createPublicClient({
      chain: chainFromKey(chainKey),
      transport: httpTransport(rpcHttpUrl),
    });

    const rpcWsUrl = this.options.rpcWsUrl ?? resolveRpcWs(this.network);
    if (rpcWsUrl) {
      this.wsClient = createPublicClient({
        chain: chainFromKey(chainKey),
        transport: webSocket(rpcWsUrl),
      });
    }
  }

  private async ensureServices(): Promise<void> {
    if (this.dbPort) return;

    const httpClient = this.httpClient!;
    this.chainId = Number(await httpClient.getChainId());
    const config = getNetworkConfig(this.network);
    const poolManager = config.contracts.poolManager;
    const positionManager = config.contracts.positionManager;
    if (!poolManager || !positionManager) {
      throw new Error(`Missing essential contracts in config for network ${this.network}`);
    }

    this.dbPort = new PrismaUniswapV4DbPort({
      network: this.network,
      chainId: this.chainId,
      poolManagerAddress: poolManager as Address,
      positionManagerAddress: positionManager as Address,
      publicClient: httpClient,
      logger: this.logger,
      prismaClient: this.prisma,
    });

    this.handler = new InstrumentedEventLogHandler(
      {
        chainId: this.chainId,
        db: this.dbPort,
      },
      (source) => this.recordActivity(source),
    );

    const trackedTokenAddresses = Object.values(config.tokens).map(
      (token) => getAddress(token.address) as Address,
    );

    this.discovery = new UniswapV4Discovery({
      client: httpClient,
      poolManagerAddress: poolManager as Address,
      trackedTokens: trackedTokenAddresses,
      mode: this.options.discoveryMode,
      blockBatchSize: this.options.blockBatchSize,
      maxRequestsPerSecond: this.options.maxRequestsPerSecond,
    });
    this.backfill = new UniswapV4Backfill({
      client: httpClient,
      poolManagerAddress: poolManager as Address,
      handler: this.handler,
      blockBatchSize: this.options.blockBatchSize,
      idChunkSize: this.options.idChunkSize,
      maxRequestsPerSecond: this.options.maxRequestsPerSecond,
    });
  }

  private async runHistoricalSync(): Promise<void> {
    const httpClient = this.httpClient!;
    const discovery = this.discovery!;
    const backfill = this.backfill!;

    const cursor = await this.prisma.scanCursor.findUnique({
      where: { cursorKey: `${this.network}:uniswap_v4_pool_manager` },
    });
    const latest = await httpClient.getBlockNumber();
    const startOverride = this.options.startBlock;

    let fromBlock: bigint;
    if (cursor?.lastBlock && cursor.lastBlock > 0n) {
      fromBlock = cursor.lastBlock + 1n;
    } else if (startOverride && startOverride > 0n) {
      fromBlock = startOverride;
    } else {
      const defaultStart = resolveDefaultStartBlock(this.network);
      if (defaultStart !== undefined) {
        fromBlock = defaultStart;
      } else {
        fromBlock = latest > DEFAULT_LOOKBACK ? latest - DEFAULT_LOOKBACK : 0n;
      }
    }

    if (fromBlock > latest) {
      this.logger.info?.("[uniswapV4] historical discovery skipped; already synced", {
        fromBlock: fromBlock.toString(),
        latest: latest.toString(),
      });
      this.updateHealthStatus({ lastSyncAt: new Date().toISOString() });
      return;
    }

    this.logger.info?.("[uniswapV4] historical discovery", {
      fromBlock: fromBlock.toString(),
      toBlock: latest.toString(),
    });

    const { poolIds } = await discovery.discoverInitializeLogs(fromBlock, latest, async (logs) => {
      await this.handler!.handleInitializeLogs(logs);
    });

    const poolIdsToSync = await this.getTrackedPoolIds(poolIds);
    if (poolIdsToSync.length > 0) {
      this.logger.info?.("[uniswapV4] backfilling pool activity", {
        pools: poolIdsToSync.length,
        fromBlock: fromBlock.toString(),
        toBlock: latest.toString(),
      });

      await backfill.backfill(poolIdsToSync, fromBlock, latest);
    }

    this.updateHealthStatus({ lastSyncAt: new Date().toISOString() });
  }

  private async startRealtime(): Promise<void> {
    const wsClient = this.wsClient;
    if (!wsClient) {
      this.logger.warn?.("[uniswapV4] websocket url not configured; relying on polling only");
      this.updateHealthStatus({ wsConnected: false });
      return;
    }

    const config = getNetworkConfig(this.network);
    const trackedTokens = Object.values(config.tokens).map((token) => getAddress(token.address) as Address);

    this.wsWatcher = new UniswapV4WatcherWS({
      wsClient,
      poolManagerAddress: config.contracts.poolManager as Address,
      handler: this.handler!,
      trackedTokens,
      mode: this.options.discoveryMode,
      onEvent: () => {
        this.updateHealthStatus({ wsConnected: true, lastError: undefined });
      },
      onError: (_context, error) => {
        this.updateHealthStatus({
          wsConnected: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
      },
    });

    this.wsWatcher.startInitializeWatch();
    this.wsWatcher.startActivityWatch([]);
    this.updateHealthStatus({ wsConnected: true, lastError: undefined });
    this.logger.info?.("[uniswapV4] websocket watchers started");
  }

  private async syncLatest(): Promise<void> {
    const backfill = this.backfill!;
    const httpClient = this.httpClient!;

    const cursor = await this.prisma.scanCursor.findUnique({
      where: { cursorKey: `${this.network}:uniswap_v4_pool_manager` },
      select: { lastBlock: true },
    });

    const latest = await httpClient.getBlockNumber();
    const fromBlock = cursor?.lastBlock ?? latest;
    if (fromBlock >= latest) {
      this.updateHealthStatus({ lastSyncAt: new Date().toISOString() });
      return;
    }

    const poolIds = await this.getTrackedPoolIds();
    if (poolIds.length === 0) {
      this.updateHealthStatus({ lastSyncAt: new Date().toISOString() });
      return;
    }

    this.logger.info?.("[uniswapV4] syncing new logs", {
      fromBlock: (fromBlock + 1n).toString(),
      toBlock: latest.toString(),
      pools: poolIds.length,
    });

    await backfill.backfill(poolIds, fromBlock + 1n, latest);
    this.updateHealthStatus({ lastSyncAt: new Date().toISOString() });
  }

  private async getTrackedPoolIds(extra: Iterable<Hex> = []): Promise<Hex[]> {
    const existing = await this.prisma.pool.findMany({
      where: {
        chainId: this.chainId,
        protocol: PoolProtocol.UNISWAP_V4,
      },
      select: { address: true },
    });

    const set = new Set<string>();
    for (const addr of existing) {
      set.add(toLowerAddress(addr.address));
    }
    for (const id of extra) {
      set.add(toLowerAddress(id));
    }

    return Array.from(set).map((addr) => addr as Hex);
  }

  private ensureHealthServer(): void {
    if (this.healthServer) return;

    this.healthServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.healthStatus));
    });

    this.healthServer.on("error", (error) => {
      this.logger.error?.("[uniswapV4] health server error", error);
    });

    this.healthServer.listen(this.healthPort, () => {
      this.logger.info?.("[uniswapV4] health endpoint listening", { port: this.healthPort });
      this.updateHealthStatus({ port: this.healthPort });
    });
  }

  private async shutdownHealthServer(): Promise<void> {
    if (!this.healthServer) return;
    await new Promise<void>((resolve) => {
      this.healthServer!.close(() => resolve());
    });
    this.healthServer = undefined;
  }

  private updateHealthStatus(patch: Partial<WatcherHealthState>): void {
    this.healthStatus = { ...this.healthStatus, ...patch };
  }

  private recordActivity(source: WatcherActivitySource): void {
    this.updateHealthStatus({
      lastActivityAt: new Date().toISOString(),
      lastActivitySource: source,
      lastError: undefined,
    });
  }
}

function resolveRpcHttp(network: NetworkEnv): string | undefined {
  switch (network) {
    case "mainnet":
      return env.RPC_URL_MAINNET_HTTP || env.RPC_URL_MAINNET || env.RPC_URL_HTTP;
    case "sepolia":
      return env.RPC_URL_SEPOLIA_HTTP || env.RPC_URL_SEPOLIA || env.RPC_URL_HTTP;
    case "local":
    default:
      return env.RPC_URL_LOCAL_HTTP || env.RPC_URL_HTTP || env.RPC_URL_LOCAL;
  }
}

function resolveRpcWs(network: NetworkEnv): string | undefined {
  switch (network) {
    case "mainnet":
      return env.RPC_URL_MAINNET_WS || toWsUrl(env.RPC_URL_MAINNET_HTTP);
    case "sepolia":
      return env.RPC_URL_SEPOLIA_WS || toWsUrl(env.RPC_URL_SEPOLIA_HTTP);
    case "local":
    default:
      return env.RPC_URL_LOCAL_WS || toWsUrl(env.RPC_URL_LOCAL_HTTP) || toWsUrl(env.RPC_URL_HTTP);
  }
}

function toWsUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  if (url.startsWith("http://")) return url.replace("http://", "ws://");
  if (url.startsWith("https://")) return url.replace("https://", "wss://");
  return undefined;
}

function toLowerAddress(address: Address | string): string {
  const value = address as string;
  if (!value.startsWith("0x")) {
    return `0x${value.toLowerCase()}`;
  }

  if (value.length === 42) {
    return getAddress(value as Address).toLowerCase();
  }

  if (value.length === 66) {
    return (`0x${value.slice(2).toLowerCase()}`) as string;
  }

  return value.toLowerCase();
}
