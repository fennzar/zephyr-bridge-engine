import { env } from "@shared";
import {
  evm,
  mexc,
  zephyr,
  type PoolDiscoveryLog,
  type PoolWatcherStatus,
  type PoolDiscoverySummary,
  type EvmWatcherHealth,
  type PoolOverview,
} from "@services";
import { mapReserveInfo } from "@domain/zephyr";
import { colors, styles } from "@/components/theme";

import { formatCurrency } from "@/components/format";
import { getDatabaseStatus, DbStatusIndicator } from "./_components/DbStatusIndicator";
import { WatcherStatus, WatcherHealthIndicator } from "./_components/WatcherStatus";
import { TokenCard } from "./_components/TokenCard";
import { SubNav } from "@/components/AppShell";
import {
  LiquidityStatusCard,
  MexcCard,
  RecentPoolEventsCard,
  ZephyrNetworkCard,
} from "./DashboardCards";

export const runtime = "nodejs";

export default async function Page() {
  const [
    mexcMarket,
    zephyrRaw,
    tokens,
    dbStatus,
    recentEvents,
    watcherStatus,
    discoverySummary,
    watcherHealth,
    pools,
  ] = await Promise.all([
    mexc.summarizeDepth("ZEPHUSDT", 10).catch(() => null),
    zephyr.getReserveInfo().catch(() => null),
    Promise.resolve(evm.getTrackedTokens(env.ZEPHYR_ENV)).catch(() => []),
    getDatabaseStatus(),
    evm
      .getRecentPoolDiscoveryEvents(20, env.ZEPHYR_ENV)
      .catch(() => [] as PoolDiscoveryLog[]),
    evm
      .getPoolWatcherStatus(env.ZEPHYR_ENV)
      .catch(() => null as PoolWatcherStatus | null),
    evm.getPoolDiscoverySummary(env.ZEPHYR_ENV).catch(
      () =>
        ({
          poolCount: 0,
          tokenCount: 0,
          discoveryEventCount: 0,
          latestEvent: null,
        }) as PoolDiscoverySummary,
    ),
    evm.getEvmWatcherHealth().catch(() => null),
    evm.getPools().catch(() => [] as PoolOverview[]),
  ]);

  const zephyrState = mapReserveInfo(zephyrRaw);

  return (
    <main style={styles.pageContainer}>
      <SubNav links={[{ href: "/state", label: "Global State" }]} />
      <div style={{ display: "grid", gap: 12 }}>
        <section
          style={styles.section}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Status</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            <div>
              ENV: <code>{env.ZEPHYR_ENV}</code>
            </div>
            <div>
              RPC HTTP: <code>{env.RPC_URL_HTTP}</code>
            </div>
            <div>
              RPC WS: <code>{env.RPC_URL_WS || "n/a"}</code>
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: `1px solid ${colors.border.subtle}`,
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={styles.label}
            >
              Database
            </div>
            <DbStatusIndicator status={dbStatus} />
            <div
              style={styles.label}
            >
              EVM Watcher
            </div>
            <WatcherHealthIndicator health={watcherHealth} />
            <div
              style={styles.label}
            >
              Total TVL
            </div>
            <div style={{ fontSize: 13 }}>
              {discoverySummary.totalTvlUsd != null
                ? formatCurrency(discoverySummary.totalTvlUsd)
                : "\u2014"}
            </div>
            <div
              style={styles.label}
            >
              Pool Watcher
            </div>
            <WatcherStatus
              status={watcherStatus}
              summary={discoverySummary}
              health={watcherHealth}
            />
          </div>
        </section>

        <LiquidityStatusCard pools={pools} />

        <MexcCard mexcMarket={mexcMarket} />

        <RecentPoolEventsCard recentEvents={recentEvents} />

        <ZephyrNetworkCard zephyrState={zephyrState} />

        <section
          style={styles.section}
        >
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Tracked Tokens
          </div>
          {tokens.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 14 }}>
              No token configuration found for {env.ZEPHYR_ENV}.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {tokens.map((token) => (
                <TokenCard key={token.address} token={token} />
              ))}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
