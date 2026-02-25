-- CreateEnum
CREATE TYPE "PoolProtocol" AS ENUM ('UNISWAP_V3', 'UNISWAP_V4', 'PANCAKE_V3', 'CUSTOM');

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocol" "PoolProtocol" NOT NULL,
    "address" TEXT NOT NULL,
    "factoryAddress" TEXT,
    "token0Id" TEXT NOT NULL,
    "token1Id" TEXT NOT NULL,
    "feeTierBps" INTEGER,
    "tickSpacing" INTEGER,
    "createdBlock" BIGINT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolStateSnapshot" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "liquidity" DECIMAL(65,30),
    "sqrtPriceX96" DECIMAL(65,30),
    "tick" INTEGER,
    "volumeUsd24h" DECIMAL(40,10),
    "totalValueLocked" DECIMAL(65,30),
    "feeGrowth0" DECIMAL(65,30),
    "feeGrowth1" DECIMAL(65,30),
    "reserves0" DECIMAL(65,30),
    "reserves1" DECIMAL(65,30),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanCursor" (
    "id" TEXT NOT NULL,
    "poolId" TEXT,
    "chainId" INTEGER,
    "protocol" "PoolProtocol",
    "task" TEXT NOT NULL,
    "cursorKey" TEXT NOT NULL,
    "lastBlock" BIGINT,
    "lastLogIndex" INTEGER,
    "lastTxHash" TEXT,
    "lastTimestamp" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDiscoveryEvent" (
    "id" TEXT NOT NULL,
    "poolId" TEXT,
    "chainId" INTEGER NOT NULL,
    "protocol" "PoolProtocol" NOT NULL,
    "factoryAddress" TEXT,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "logIndex" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolDiscoveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Token_symbol_idx" ON "Token"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Token_chainId_address_key" ON "Token"("chainId", "address");

-- CreateIndex
CREATE INDEX "Pool_token0Id_idx" ON "Pool"("token0Id");

-- CreateIndex
CREATE INDEX "Pool_token1Id_idx" ON "Pool"("token1Id");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_chainId_protocol_address_key" ON "Pool"("chainId", "protocol", "address");

-- CreateIndex
CREATE INDEX "PoolStateSnapshot_blockNumber_idx" ON "PoolStateSnapshot"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PoolStateSnapshot_poolId_blockNumber_key" ON "PoolStateSnapshot"("poolId", "blockNumber");

-- CreateIndex
CREATE INDEX "ScanCursor_task_protocol_chainId_idx" ON "ScanCursor"("task", "protocol", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanCursor_cursorKey_key" ON "ScanCursor"("cursorKey");

-- CreateIndex
CREATE INDEX "PoolDiscoveryEvent_chainId_protocol_blockNumber_idx" ON "PoolDiscoveryEvent"("chainId", "protocol", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PoolDiscoveryEvent_txHash_logIndex_key" ON "PoolDiscoveryEvent"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_token0Id_fkey" FOREIGN KEY ("token0Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_token1Id_fkey" FOREIGN KEY ("token1Id") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolStateSnapshot" ADD CONSTRAINT "PoolStateSnapshot_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanCursor" ADD CONSTRAINT "ScanCursor_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDiscoveryEvent" ADD CONSTRAINT "PoolDiscoveryEvent_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

