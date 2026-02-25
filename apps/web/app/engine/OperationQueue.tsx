"use client";

import type { QueueOperation } from "@/types/api";
import { colors, styles } from "@/components/theme";

export function OperationQueue({
  queue,
  onApprove,
  onReject,
}: {
  queue: QueueOperation[];
  onApprove: (operationId: string) => void;
  onReject: (operationId: string) => void;
}) {
  return (
    <div style={styles.section}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
        Operation Queue
      </div>

      {queue.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.4, textAlign: "center", padding: "24px 0" }}>
          No pending operations
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {queue.map((op) => (
            <div
              key={op.id}
              style={{
                ...styles.card,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 13 }}>
                    {op.strategy.toUpperCase()}
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      color: colors.text.dimmed,
                      fontSize: 10,
                    }}
                  >
                    Priority: {op.priority}
                  </span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                  {new Date(op.createdAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onApprove(op.id)}
                  style={{
                    ...styles.button,
                    background: colors.accent.greenBg,
                    border: "1px solid rgba(22,199,132,0.3)",
                    color: colors.accent.green,
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onReject(op.id)}
                  style={{
                    ...styles.button,
                    background: colors.accent.redBg,
                    border: "1px solid rgba(244,91,105,0.3)",
                    color: colors.accent.red,
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
