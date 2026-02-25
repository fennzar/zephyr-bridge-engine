/**
 * Zephyr reserve snapshot management.
 * Tracks reserve state and persists to database.
 */

import { prisma } from "@infra";
import { createLogger } from "@shared/logger";
import type { ReserveInfoResult, ReservePriceReport } from "@services/zephyr/zephyrd";

const log = createLogger("Zephyr:Snapshot");

const DEFAULT_STALE_AFTER_MS = Number(process.env.ZEPHYR_WATCHER_STALE_AFTER_MS ?? 60_000);

interface ZephyrSnapshotState {
  raw?: ReserveInfoResult;
  lastUpdatedAt?: number;
  staleAfterMs: number;
  watcher: {
    live: boolean;
    lastUpdatedAt?: number;
  };
}

const state: ZephyrSnapshotState = {
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
  watcher: {
    live: false,
    lastUpdatedAt: undefined,
  },
};

export function markWatcherLive(): void {
  state.watcher.live = true;
  state.watcher.lastUpdatedAt = Date.now();
}

export function markWatcherDisconnected(): void {
  state.watcher.live = false;
}

export function updateReserveState(raw: ReserveInfoResult): void {
  state.raw = raw;
  state.lastUpdatedAt = Date.now();
  state.watcher.lastUpdatedAt = Date.now();
}

export interface ZephyrHealthSnapshot {
  isHealthy: boolean;
  isLive: boolean;
  isStale: boolean;
  lastUpdatedAt: number | undefined;
  ageMs: number | undefined;
}

export function getHealthSnapshot(): ZephyrHealthSnapshot {
  const now = Date.now();
  const age = state.lastUpdatedAt ? now - state.lastUpdatedAt : undefined;
  const isStale = age != null && age > state.staleAfterMs;

  return {
    isHealthy: state.watcher.live && !isStale && state.raw != null,
    isLive: state.watcher.live,
    isStale,
    lastUpdatedAt: state.lastUpdatedAt,
    ageMs: age,
  };
}

export interface ZephyrSnapshot {
  raw: ReserveInfoResult | undefined;
  health: ZephyrHealthSnapshot;
  reserveRatio: number | undefined;
  reserveRatioMa: number | undefined;
  height: number | undefined;
  prices: {
    zephSpot: number | undefined;
    zephMa: number | undefined;
    zsdSpot: number | undefined;
    zsdMa: number | undefined;
    zrsSpot: number | undefined;
    zrsMa: number | undefined;
    zysSpot: number | undefined;
  };
}

export function getZephyrSnapshot(): ZephyrSnapshot {
  const raw = state.raw;
  const pr = raw?.pr;

  return {
    raw,
    health: getHealthSnapshot(),
    reserveRatio: raw ? parseFloat(raw.reserve_ratio) : undefined,
    reserveRatioMa: raw ? parseFloat(raw.reserve_ratio_ma) : undefined,
    height: raw?.height,
    prices: {
      zephSpot: pr?.spot,
      zephMa: pr?.moving_average,
      zsdSpot: pr?.stable,
      zsdMa: pr?.stable_ma,
      zrsSpot: pr?.reserve,
      zrsMa: pr?.reserve_ma,
      zysSpot: pr?.yield_price,
    },
  };
}

// =============================================================================
// Database Persistence
// =============================================================================

const DB_FLUSH_INTERVAL_MS = Number(process.env.ZEPHYR_DB_FLUSH_INTERVAL_MS ?? 10_000);
let lastDbFlush = 0;
let flushPending = false;
let dbFlushTimer: NodeJS.Timeout | undefined;

/**
 * Persist the current reserve snapshot to the database.
 */
async function flushReserveSnapshotToDb(): Promise<void> {
  if (flushPending) return;
  flushPending = true;

  const now = Date.now();
  const raw = state.raw;

  if (!raw) {
    flushPending = false;
    return;
  }

  // Only flush if enough time has passed since the last flush
  if (now - lastDbFlush < DB_FLUSH_INTERVAL_MS) {
    flushPending = false;
    return;
  }

  try {
    const pr = raw.pr;
    const rr = parseFloat(raw.reserve_ratio);
    const rrMa = parseFloat(raw.reserve_ratio_ma);

    // Determine mint/redeem availability based on RR
    // ZSD: mintable if RR >= 4.0, redeemable always
    // ZRS: mintable if 4.0 <= RR <= 8.0, redeemable if RR >= 4.0
    const zsdMintable = rr >= 4.0 && rrMa >= 4.0;
    const zsdRedeemable = true; // Always (with haircut if RR < 1.0)
    const zrsMintable = rr >= 4.0 && rr <= 8.0 && rrMa >= 4.0 && rrMa <= 8.0;
    const zrsRedeemable = rr >= 4.0 && rrMa >= 4.0;
    
    await prisma.reserveSnapshot.create({
      data: {
        height: BigInt(raw.height),
        reserveRatio: rr,
        reserveRatioMa: rrMa,
        zephPriceUsd: pr.spot / 1e12,
        zephPriceMa: pr.moving_average / 1e12,
        zsdMintable,
        zsdRedeemable,
        zrsMintable,
        zrsRedeemable,
        zsdCirc: parseFloat(raw.num_stables) / 1e12,
        zrsCirc: parseFloat(raw.num_reserves) / 1e12,
        zysCirc: parseFloat(raw.num_zyield) / 1e12,
        zephInReserve: parseFloat(raw.zeph_reserve) / 1e12,
        capturedAt: new Date(pr.timestamp * 1000),
      },
    });

    lastDbFlush = now;
    log.info(`Persisted reserve snapshot (RR: ${(rr * 100).toFixed(2)}%)`);
  } catch (error) {
    log.error("Failed to persist reserve snapshot:", error);
  } finally {
    flushPending = false;
  }
}

/**
 * Start the periodic DB flush timer.
 */
export function startDbPersistence(): void {
  if (dbFlushTimer) {
    log.warn("DB persistence timer already running.");
    return;
  }
  log.info(`Starting DB persistence, flushing every ${DB_FLUSH_INTERVAL_MS}ms.`);
  dbFlushTimer = setInterval(() => {
    void flushReserveSnapshotToDb();
  }, DB_FLUSH_INTERVAL_MS);
}

/**
 * Stop the periodic DB flush timer.
 */
export function stopDbPersistence(): void {
  if (dbFlushTimer) {
    clearInterval(dbFlushTimer);
    dbFlushTimer = undefined;
    log.info("Stopped DB persistence.");
  }
}

