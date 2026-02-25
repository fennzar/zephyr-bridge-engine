-- CreateTable
CREATE TABLE "EngineSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "cooldownMs" INTEGER NOT NULL DEFAULT 60000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineSettings_pkey" PRIMARY KEY ("id")
);
