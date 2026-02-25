/**
 * Zephyr reserve watcher.
 * Polls zephyrd for reserve state and updates the snapshot.
 */

import { getReserveInfo } from "@services/zephyr/zephyrd";
import { createLogger } from "@shared/logger";

import {
  markWatcherLive,
  markWatcherDisconnected,
  updateReserveState,
  startDbPersistence,
  stopDbPersistence,
  getZephyrSnapshot,
  getHealthSnapshot,
  type ZephyrHealthSnapshot,
} from "./snapshot";

export interface ZephyrWatcherInfo {
  type: "zephyr";
  getHealth: () => ZephyrHealthSnapshot;
}

export interface ZephyrWatcherHandle {
  watcher: ZephyrWatcherInfo;
  shutdown: () => Promise<void>;
}

export interface StartZephyrWatcherOptions {
  pollIntervalMs?: number;
}

const log = createLogger("Zephyr:Watcher");

export function startZephyrWatcher(
  options?: StartZephyrWatcherOptions,
): ZephyrWatcherHandle {
  const pollIntervalMs = options?.pollIntervalMs ?? Number(process.env.ZEPHYR_POLL_INTERVAL_MS ?? 10_000);

  const watcher: ZephyrWatcherInfo = {
    type: "zephyr" as const,
    getHealth: getHealthSnapshot,
  };

  let pollTimer: NodeJS.Timeout | undefined;
  let running = true;

  const pollReserve = async (): Promise<void> => {
    if (!running) return;

    try {
      const reserveInfo = await getReserveInfo();
      updateReserveState(reserveInfo);
      markWatcherLive();
    } catch (error) {
      log.error("Failed to fetch reserve info:", error);
      // Don't mark as disconnected on transient errors
      // Only mark disconnected after multiple failures
    }
  };

  const bootstrap = async (): Promise<void> => {
    log.info(`Starting reserve watcher (poll every ${pollIntervalMs}ms)`);

    try {
      await pollReserve();
      startDbPersistence();
      log.info("Watcher bootstrapped successfully");
    } catch (error) {
      log.warn("Failed to bootstrap:", error);
    }

    // Start polling
    pollTimer = setInterval(() => {
      void pollReserve();
    }, pollIntervalMs);
  };

  const shutdown = async (): Promise<void> => {
    log.info("Shutting down watcher...");
    running = false;

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }

    markWatcherDisconnected();
    stopDbPersistence();
    log.info("Watcher stopped");
  };

  void bootstrap();

  return { watcher, shutdown };
}

export { getZephyrSnapshot, getHealthSnapshot };

