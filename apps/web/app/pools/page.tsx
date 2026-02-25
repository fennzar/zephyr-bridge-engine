export const dynamic = "force-dynamic";

import { env } from "@shared";
import type { Address } from "viem";
import {
  evm,
  type PoolOverview,
  type PoolDiscoverySummary,
  type PoolWatcherStatus,
  type EvmWatcherHealth,
  type PositionOverview,
} from "@services";
import { readRecentLogs, type StructuredLogEntry } from "@services/evm/logging";

import { LogTerminal } from "@/components/LogTerminal";
import { PoolActionsPanel } from "./Actions";
import { colors, styles } from "@/components/theme";
import {
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  formatTimestamp,
} from "@/components/format";
import { SubNav } from "@/components/AppShell";
import type { EngineLPPosition } from "./pools.helpers";
import { StatsCard, TokenBalanceCell } from "./pools.helpers";
import { WatcherStatusCard } from "./WatcherStatusCard";
import { EngineLPPositions } from "./EngineLPPositions";

/* ------------------------------------------------------------------ */
/*  Helper functions                                                    */
/* ------------------------------------------------------------------ */

function summarizeWatcher(
  health: EvmWatcherHealth | null,
  status: PoolWatcherStatus | null,
): { value: string; helper?: string } {
  if (health) {
    const normalizedState =
      health.state === "historical_sync"
        ? "Historical Sync"
        : health.state.charAt(0).toUpperCase() + health.state.slice(1);
    const value =
      health.state === "running" && health.wsConnected
        ? "Running"
        : normalizedState;
    const helper = health.lastActivityAt
      ? `Activity ${formatRelativeTime(health.lastActivityAt)}`
      : health.lastError
        ? `Error: ${health.lastError}`
        : health.lastSyncAt
          ? `Synced ${formatRelativeTime(health.lastSyncAt)}`
          : undefined;
    return { value, helper };
  }

  if (status?.updatedAt) {
    return {
      value: "Active",
      helper: `Updated ${formatRelativeTime(status.updatedAt)}`,
    };
  }

  return { value: "Unknown", helper: "No health signal" };
}

function PoolsTable({ pools }: { pools: PoolOverview[] }) {
  if (pools.length === 0) {
    return (
      <div style={{ ...styles.card, padding: 24 }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>
          No pools discovered yet. Run the watcher to sync Uniswap v4 pools.
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          ...styles.table,
          minWidth: 720,
          background: colors.bg.card,
          border: `1px solid ${colors.border.primary}`,
          borderRadius: 8,
        }}
      >
        <thead>
          <tr style={styles.tableHeader}>
            <th style={{ textAlign: "left", padding: "10px 12px" }}>Pool</th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              Fee (bps)
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              Active Positions
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              Price
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              Base Balance
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              Quote Balance
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              TVL (USD)
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              24h Volume
            </th>
            <th style={{ textAlign: "right", padding: "10px 12px" }}>
              APR (bps)
            </th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr
              key={pool.id}
              style={{ borderTop: `1px solid ${colors.border.subtle}` }}
            >
              <td style={{ padding: "12px" }}>
                <div style={{ fontWeight: 600 }}>
                  {pool.base.symbol}/{pool.quote.symbol}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{pool.id}</div>
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {pool.feeBps}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {pool.activePositions}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {pool.lastPrice != null ? formatNumber(pool.lastPrice, 4) : "\u2014"}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                <TokenBalanceCell
                  amount={pool.totalToken0}
                  usd={pool.totalToken0Usd}
                  symbol={pool.base.symbol}
                />
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                <TokenBalanceCell
                  amount={pool.totalToken1}
                  usd={pool.totalToken1Usd}
                  symbol={pool.quote.symbol}
                />
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {formatCurrency(pool.tvlUsd)}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {formatNumber(pool.volume24hUsd)}
              </td>
              <td style={{ padding: "12px", textAlign: "right" }}>
                {pool.aprBps}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fetch helper for engine LP positions                               */
/* ------------------------------------------------------------------ */

async function fetchEnginePositions(
  walletAddr: string,
): Promise<EngineLPPosition[]> {
  try {
    // Server-side internal fetch — use localhost since this runs on the same process
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:7000";
    const res = await fetch(
      `${baseUrl}/api/positions?owner=${encodeURIComponent(walletAddr)}&include=engine`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.enginePositions ?? []) as EngineLPPosition[];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function PoolsPage() {
  const walletAddr = env.EVM_WALLET_ADDRESS ?? process.env.EVM_WALLET_ADDRESS;

  const [pools, summary, watcherStatus, watcherHealth, logEntries, positions] =
    await Promise.all([
      evm.getPools(),
      evm.getPoolDiscoverySummary(env.ZEPHYR_ENV),
      evm.getPoolWatcherStatus(env.ZEPHYR_ENV),
      evm.getEvmWatcherHealth(),
      Promise.resolve(readRecentLogs(150)).catch(
        () => [] as StructuredLogEntry[],
      ),
      walletAddr
        ? evm.getPositions(null, walletAddr as Address).catch(() => [] as PositionOverview[])
        : Promise.resolve([] as PositionOverview[]),
    ]);

  // Fetch engine-managed LP positions (status, targetMode, lastRebalanceAt)
  const enginePositions = walletAddr
    ? await fetchEnginePositions(walletAddr)
    : [];

  // Build a lookup from LPPosition id -> engine data for the on-chain positions
  const engineDataMap = new Map(
    enginePositions.map((ep) => [
      `${ep.poolId}:${ep.tickLower}:${ep.tickUpper}`,
      ep,
    ]),
  );

  const poolCount = summary.poolCount ?? 0;
  const tokenCount = summary.tokenCount ?? 0;
  const discoveryCount = summary.discoveryEventCount ?? 0;
  const watcherSummary = summarizeWatcher(watcherHealth, watcherStatus);

  return (
    <main
      style={{
        maxWidth: 1040,
        margin: "48px auto",
        padding: 24,
        display: "grid",
        gap: 24,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 28, margin: 0 }}>Liquidity Pools</h1>
            <div style={{ opacity: 0.7, fontSize: 14 }}>
              Manage and inspect tracked Uniswap v4 pools.
            </div>
          </div>
        </div>
        <SubNav links={[{ href: "/positions", label: "Positions" }]} />
        <PoolActionsPanel />
      </header>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Watcher Summary</h2>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          }}
        >
          <StatsCard label="Pools" value={poolCount.toString()} />
          <StatsCard label="Tokens" value={tokenCount.toString()} />
          <StatsCard
            label="Discovery Events"
            value={discoveryCount.toString()}
            helper={
              summary.latestEvent
                ? `Latest event: ${formatTimestamp(summary.latestEvent.blockTimestamp)}`
                : undefined
            }
          />
          <StatsCard
            label="Total TVL"
            value={formatCurrency(summary.totalTvlUsd)}
          />
          <StatsCard
            label="Watcher"
            value={watcherSummary.value}
            helper={watcherSummary.helper}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <WatcherStatusCard
            status={watcherStatus}
            health={watcherHealth}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <LogTerminal initialEntries={logEntries} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Tracked Pools</h2>
        <PoolsTable pools={pools as PoolOverview[]} />
      </section>

      <EngineLPPositions
        walletAddr={walletAddr}
        positions={positions}
        enginePositions={enginePositions}
        engineDataMap={engineDataMap}
      />
    </main>
  );
}
