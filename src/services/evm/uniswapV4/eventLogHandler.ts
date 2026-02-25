import type { Address, Hex, Log } from "viem";

export type ChainId = number;

export interface DbPort {
  // Implement these in your repo layer. Use (chainId, txHash, logIndex) as a unique key.
  saveInitialize: (e: {
    chainId: ChainId;
    blockNumber: bigint;
    blockHash: Hex;
    txHash: Hex;
    logIndex: number;
    poolId: Hex;
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
    sqrtPriceX96: bigint;
    tick: number;
  }) => Promise<void>;

  saveSwap: (e: {
    chainId: ChainId;
    blockNumber: bigint;
    blockHash: Hex;
    txHash: Hex;
    logIndex: number;
    poolId: Hex;
    sender: Address;
    amount0: bigint;
    amount1: bigint;
    sqrtPriceX96: bigint;
    liquidity: bigint;
    tick: number;
    fee: number;
  }) => Promise<void>;

  saveModifyLiquidity: (e: {
    chainId: ChainId;
    blockNumber: bigint;
    blockHash: Hex;
    txHash: Hex;
    logIndex: number;
    poolId: Hex;
    sender: Address;
    tickLower: number;
    tickUpper: number;
    liquidityDelta: bigint;
    salt: Hex;
  }) => Promise<void>;

  saveDonate: (e: {
    chainId: ChainId;
    blockNumber: bigint;
    blockHash: Hex;
    txHash: Hex;
    logIndex: number;
    poolId: Hex;
    sender: Address;
    amount0: bigint;
    amount1: bigint;
  }) => Promise<void>;
}

export interface HandlerDeps {
  chainId: ChainId;
  db: DbPort;
}

export class UniswapV4EventLogHandler {
  private chainId: ChainId;
  private db: DbPort;

  constructor(deps: HandlerDeps) {
    this.chainId = deps.chainId;
    this.db = deps.db;
  }

  // ---- Initialize ---------------------------------------------------------
  async handleInitializeLogs(logs: Log[]): Promise<void> {
    for (const log of logs) {
      // @ts-expect-error viem attaches decoded args when you supply `event` in getLogs/watchContractEvent
      const a = log.args as {
        id: Hex;
        currency0: Address;
        currency1: Address;
        fee: number;
        tickSpacing: number;
        hooks: Address;
        sqrtPriceX96: bigint;
        tick: number;
      };

      await this.db.saveInitialize({
        chainId: this.chainId,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: Number(log.logIndex),
        poolId: a.id,
        currency0: a.currency0,
        currency1: a.currency1,
        fee: a.fee,
        tickSpacing: a.tickSpacing,
        hooks: a.hooks,
        sqrtPriceX96: a.sqrtPriceX96,
        tick: a.tick,
      });
    }
  }

  // ---- Swap ---------------------------------------------------------------
  async handleSwapLogs(logs: Log[]): Promise<void> {
    for (const log of logs) {
      // @ts-expect-error decoded args present if `event` specified
      const a = log.args as {
        id: Hex;
        sender: Address;
        amount0: bigint;
        amount1: bigint;
        sqrtPriceX96: bigint;
        liquidity: bigint;
        tick: number;
        fee: number;
      };

      await this.db.saveSwap({
        chainId: this.chainId,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: Number(log.logIndex),
        poolId: a.id,
        sender: a.sender,
        amount0: a.amount0,
        amount1: a.amount1,
        sqrtPriceX96: a.sqrtPriceX96,
        liquidity: a.liquidity,
        tick: a.tick,
        fee: a.fee,
      });
    }
  }

  // ---- ModifyLiquidity ----------------------------------------------------
  async handleModifyLiquidityLogs(logs: Log[]): Promise<void> {
    for (const log of logs) {
      // @ts-expect-error decoded args present if `event` specified
      const a = log.args as {
        id: Hex;
        sender: Address;
        tickLower: number;
        tickUpper: number;
        liquidityDelta: bigint;
        salt: Hex;
      };

      await this.db.saveModifyLiquidity({
        chainId: this.chainId,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: Number(log.logIndex),
        poolId: a.id,
        sender: a.sender,
        tickLower: a.tickLower,
        tickUpper: a.tickUpper,
        liquidityDelta: a.liquidityDelta,
        salt: a.salt,
      });
    }
  }

  // ---- Donate -------------------------------------------------------------
  async handleDonateLogs(logs: Log[]): Promise<void> {
    for (const log of logs) {
      // @ts-expect-error decoded args present if `event` specified
      const a = log.args as {
        id: Hex;
        sender: Address;
        amount0: bigint;
        amount1: bigint;
      };

      await this.db.saveDonate({
        chainId: this.chainId,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: Number(log.logIndex),
        poolId: a.id,
        sender: a.sender,
        amount0: a.amount0,
        amount1: a.amount1,
      });
    }
  }
}
