import type {
  PoolWatcherStatus,
  PoolDiscoverySummary,
  EvmWatcherHealth,
} from "@services";
import {
  formatRelativeTime,
  formatTimestamp,
  formatAddress,
} from "../_lib/dashboard-format";

export function WatcherStatus({
  status,
  summary,
  health,
}: {
  status: PoolWatcherStatus | null;
  summary: PoolDiscoverySummary;
  health?: EvmWatcherHealth | null;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <WatcherSummary summary={summary} />
      {health ? (
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <div>
            <span style={{ opacity: 0.6 }}>Process State:</span>{" "}
            <span style={{ fontFamily: "ui-monospace" }}>{health.state}</span>
            {health.wsConnected ? (
              <span style={{ marginLeft: 6, color: "#16c784" }}>
                WS Connected
              </span>
            ) : (
              <span style={{ marginLeft: 6, color: "#f7ad4c" }}>
                WS Disconnected
              </span>
            )}
          </div>
          <div>
            <span style={{ opacity: 0.6 }}>Last Activity:</span>{" "}
            <span>
              {health.lastActivityAt
                ? `${formatRelativeTime(health.lastActivityAt)} (${health.lastActivitySource ?? "event"})`
                : "—"}
            </span>
          </div>
          {health.lastError ? (
            <div style={{ color: "#f45b69" }}>
              <span style={{ opacity: 0.6 }}>Last Error:</span>{" "}
              <span>{health.lastError}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {status ? (
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <div>
            <span style={{ opacity: 0.6 }}>Last Block:</span>{" "}
            <span style={{ fontFamily: "ui-monospace" }}>
              {status.lastBlock != null
                ? status.lastBlock.toLocaleString()
                : "—"}
            </span>
          </div>
          <div>
            <span style={{ opacity: 0.6 }}>Last Timestamp:</span>{" "}
            <span>{formatTimestamp(status.lastTimestamp ?? undefined)}</span>
          </div>
          <div>
            <span style={{ opacity: 0.6 }}>Updated At:</span>{" "}
            <span>{formatTimestamp(status.updatedAt)}</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          No watcher runs recorded.
        </div>
      )}
    </div>
  );
}

export function WatcherSummary({ summary }: { summary: PoolDiscoverySummary }) {
  return (
    <div style={{ display: "grid", gap: 2, fontSize: 12 }}>
      <div>
        <span style={{ opacity: 0.6 }}>Pools:</span>{" "}
        <span>{summary.poolCount.toLocaleString()}</span>
        <span style={{ opacity: 0.6, marginLeft: 8 }}>Tokens:</span>{" "}
        <span>{summary.tokenCount.toLocaleString()}</span>
        <span style={{ opacity: 0.6, marginLeft: 8 }}>Events:</span>{" "}
        <span>{summary.discoveryEventCount.toLocaleString()}</span>
      </div>
      {summary.latestEvent && (
        <div>
          <span style={{ opacity: 0.6 }}>Latest:</span>{" "}
          <span>{formatTimestamp(summary.latestEvent.blockTimestamp)}</span>
          {summary.latestEvent.poolAddress && (
            <span style={{ opacity: 0.6, marginLeft: 6 }}>
              ({formatAddress(summary.latestEvent.poolAddress)})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function WatcherHealthIndicator({
  health,
}: {
  health: EvmWatcherHealth | null;
}) {
  let color = "#f7ad4c";
  let label = "Watcher Offline";
  let detail = "Health endpoint not reachable";

  if (health) {
    const activity = health.lastActivityAt
      ? `Activity ${formatRelativeTime(health.lastActivityAt)}`
      : "Awaiting activity";
    switch (health.state) {
      case "running":
        if (health.wsConnected) {
          color = "#16c784";
          label = "Watcher Online";
          detail = activity;
        } else {
          color = "#f7ad4c";
          label = "Watcher Running";
          detail = "WS disconnected";
        }
        break;
      case "starting":
        color = "#f7ad4c";
        label = "Watcher Starting";
        detail = activity;
        break;
      case "historical_sync":
        color = "#f7ad4c";
        label = "Watcher Syncing";
        detail = "Backfilling historical events";
        break;
      case "stopped":
        color = "#f45b69";
        label = "Watcher Stopped";
        detail = health.stoppedAt
          ? `Stopped ${formatRelativeTime(health.stoppedAt)}`
          : "Process halted";
        break;
      case "error":
        color = "#f45b69";
        label = "Watcher Error";
        detail = health.lastError ?? "Check watcher logs";
        break;
      default:
        color = "#f7ad4c";
        label = `Watcher ${health.state}`;
        detail = activity;
    }
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}88`,
        }}
      />
      <span style={{ fontWeight: 600 }}>{label}</span>
      {detail && <span style={{ opacity: 0.7, fontSize: 12 }}>{detail}</span>}
    </div>
  );
}
