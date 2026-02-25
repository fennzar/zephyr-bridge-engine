import { env } from "@shared";

export type EvmWatcherHealthState =
  | "starting"
  | "historical_sync"
  | "running"
  | "stopped"
  | "error";

export type EvmWatcherHealth = {
  task: string;
  network: string;
  state: EvmWatcherHealthState;
  wsConnected: boolean;
  lastActivityAt?: string;
  lastActivitySource?: "initialize" | "swap" | "modify" | "donate";
  lastError?: string;
  lastSyncAt?: string;
  startedAt: string;
  stoppedAt?: string;
  pid?: number;
  port?: number;
};

const DEFAULT_HOST = process.env.EVM_WATCHER_HEALTH_HOST ?? "127.0.0.1";

export async function getEvmWatcherHealth(
  timeoutMs = 2_000,
): Promise<EvmWatcherHealth | null> {
  const port = env.EVM_WATCHER_PORT ?? 7010;
  const url = `http://${DEFAULT_HOST}:${port}`;

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as EvmWatcherHealth;
    return data;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
