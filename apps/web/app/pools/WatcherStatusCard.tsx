import type { PoolWatcherStatus, EvmWatcherHealth } from "@services";
import { colors, styles } from "@/components/theme";
import { formatRelativeTime, formatTimestamp } from "@/components/format";

export function WatcherStatusCard({
  status,
  health,
}: {
  status: PoolWatcherStatus | null;
  health: EvmWatcherHealth | null;
}) {
  if (!status && !health) {
    return (
      <div style={{ ...styles.card, padding: 16, fontSize: 13 }}>
        Watcher health endpoint unreachable and no cursor data available.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        ...styles.card,
        padding: 16,
        fontSize: 13,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ ...styles.label, fontSize: 12 }}>Process</div>
        {health ? (
          <>
            <div>
              <strong>State:</strong> {health.state}
              {health.wsConnected ? (
                <span style={{ marginLeft: 6, color: colors.accent.green }}>
                  WS Connected
                </span>
              ) : (
                <span style={{ marginLeft: 6, color: colors.accent.orange }}>
                  WS Disconnected
                </span>
              )}
            </div>
            <div>
              <strong>Last Activity:</strong>{" "}
              {health.lastActivityAt
                ? `${formatRelativeTime(health.lastActivityAt)} (${health.lastActivitySource ?? "event"})`
                : "\u2014"}
            </div>
            <div>
              <strong>Last Sync:</strong>{" "}
              {health.lastSyncAt ? formatRelativeTime(health.lastSyncAt) : "\u2014"}
            </div>
            <div>
              <strong>Started:</strong> {formatTimestamp(health.startedAt)}
            </div>
            {health.lastError ? (
              <div style={{ color: colors.accent.red }}>
                <strong>Error:</strong> {health.lastError}
              </div>
            ) : null}
          </>
        ) : (
          <div>Health endpoint unavailable.</div>
        )}
      </div>

      <div
        style={{
          borderTop: `1px solid ${colors.border.subtle}`,
          paddingTop: 8,
          display: "grid",
          gap: 4,
        }}
      >
        <div style={{ ...styles.label, fontSize: 12 }}>Cursor</div>
        {status ? (
          <>
            <div>
              <strong>Cursor Key:</strong> {status.cursorKey}
            </div>
            <div>
              <strong>Last Block:</strong> {status.lastBlock ?? "\u2014"}
            </div>
            <div>
              <strong>Last Timestamp:</strong>{" "}
              {formatTimestamp(status.lastTimestamp)}
            </div>
            <div>
              <strong>Updated:</strong> {formatTimestamp(status.updatedAt)}
            </div>
          </>
        ) : (
          <div>No cursor entries found.</div>
        )}
      </div>
    </div>
  );
}
