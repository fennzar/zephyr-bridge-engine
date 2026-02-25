-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocol" "PoolProtocol" NOT NULL,
    "poolId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "liquidity" DECIMAL(65,30),
    "amount0" DECIMAL(65,30),
    "amount1" DECIMAL(65,30),
    "fees0" DECIMAL(65,30),
    "fees1" DECIMAL(65,30),
    "lastUpdatedBlock" BIGINT,
    "lastUpdatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "liquidity" DECIMAL(65,30),
    "amount0" DECIMAL(65,30),
    "amount1" DECIMAL(65,30),
    "fees0" DECIMAL(65,30),
    "fees1" DECIMAL(65,30),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Position_chainId_protocol_owner_idx" ON "Position"("chainId", "protocol", "owner");

-- CreateIndex
CREATE INDEX "Position_poolId_idx" ON "Position"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_chainId_protocol_owner_poolId_tickLower_tickUpper_key" ON "Position"("chainId", "protocol", "owner", "poolId", "tickLower", "tickUpper");

-- CreateIndex
CREATE INDEX "PositionSnapshot_blockNumber_idx" ON "PositionSnapshot"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_positionId_blockNumber_key" ON "PositionSnapshot"("positionId", "blockNumber");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSnapshot" ADD CONSTRAINT "PositionSnapshot_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
