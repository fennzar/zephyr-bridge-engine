-- CreateTable
CREATE TABLE "SwapEvent" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocol" "PoolProtocol" NOT NULL,
    "sender" TEXT NOT NULL,
    "amount0" DECIMAL(65,30) NOT NULL,
    "amount1" DECIMAL(65,30) NOT NULL,
    "sqrtPriceX96" DECIMAL(65,30) NOT NULL,
    "liquidity" DECIMAL(65,30) NOT NULL,
    "tick" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SwapEvent_txHash_logIndex_key" ON "SwapEvent"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "SwapEvent_poolId_blockNumber_idx" ON "SwapEvent"("poolId", "blockNumber");

-- AddForeignKey
ALTER TABLE "SwapEvent" ADD CONSTRAINT "SwapEvent_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
