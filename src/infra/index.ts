import { PrismaClient, Prisma, PoolProtocol as PoolProtocolEnum } from '@prisma/client';
import { env } from '@shared';
import type {
  Pool,
  PoolStateSnapshot,
  PoolDiscoveryEvent,
  ScanCursor,
  Token,
  Position,
  PositionSnapshot,
  SwapEvent,
  PoolProtocol as PoolProtocolType,
} from '@prisma/client';

type GlobalPrisma = PrismaClient & { _isGlobal?: true };

const globalForPrisma = globalThis as unknown as {
  prisma?: GlobalPrisma;
};

function resolveDatabaseUrl(): string {
  const url = env.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to initialize Prisma');
  }
  return url;
}

function createClientInstance(): PrismaClient {
  const logLevels: Prisma.LogLevel[] = env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'];

  return new PrismaClient({
    datasources: {
      db: {
        url: resolveDatabaseUrl(),
      },
    },
    log: logLevels,
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClientInstance();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma as GlobalPrisma;
  globalForPrisma.prisma._isGlobal = true;
}

export const PoolProtocol = PoolProtocolEnum;
export { Prisma };

export type {
  Pool,
  PoolStateSnapshot,
  PoolDiscoveryEvent,
  ScanCursor,
  Token,
  Position,
  PositionSnapshot,
  SwapEvent,
};
export type PoolProtocol = PoolProtocolType;
export type TransactionClient = Prisma.TransactionClient;

export function createPrismaClient(): PrismaClient {
  return createClientInstance();
}

export async function withTransaction<T>(handler: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => handler(tx));
}
