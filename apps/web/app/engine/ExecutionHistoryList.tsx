"use client";

import type { ExecutionHistory } from "@/types/api";
import { colors, styles, statusColor } from "@/components/theme";
import { formatDuration } from "@/components/format";
import { Badge } from "./engine.helpers";

export function ExecutionHistoryList({
  history,
  selectedExecution,
  onSelectExecution,
}: {
  history: ExecutionHistory[];
  selectedExecution: string | null;
  onSelectExecution: (id: string | null) => void;
}) {
  return (
    <div style={styles.section}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
        Execution History
      </div>

      {history.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.4, textAlign: "center", padding: "24px 0" }}>
          No recent executions
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {history.map((exec) => {
            const sc = statusColor(exec.status);
            const expanded = selectedExecution === exec.id;
            return (
              <div
                key={exec.id}
                style={{
                  ...styles.card,
                  padding: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    onSelectExecution(expanded ? null : exec.id)
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: sc.color,
                      }}
                    />
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>
                          {exec.plan.opportunity?.asset ?? "Unknown"}{" "}
                          \u2014{" "}
                          {exec.plan.opportunity?.direction ?? ""}
                        </span>
                        <Badge
                          label={exec.status.toUpperCase()}
                          status={exec.status}
                        />
                        <span
                          style={{
                            ...styles.badge,
                            color: colors.text.dimmed,
                            fontSize: 10,
                          }}
                        >
                          {exec.mode}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          opacity: 0.5,
                          marginTop: 2,
                        }}
                      >
                        {new Date(exec.startedAt).toLocaleString()}
                        {exec.durationMs != null && (
                          <span style={{ marginLeft: 8 }}>
                            \u2022 {formatDuration(exec.durationMs)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    {exec.netPnlUsd !== null && (
                      <div
                        style={{
                          fontWeight: 500,
                          color:
                            exec.netPnlUsd >= 0
                              ? colors.accent.green
                              : colors.accent.red,
                        }}
                      >
                        {exec.netPnlUsd >= 0 ? "+" : ""}$
                        {exec.netPnlUsd.toFixed(2)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, opacity: 0.4 }}>
                      {exec.plan.steps?.length ?? 0} steps
                    </div>
                  </div>
                </div>

                {expanded && exec.stepResults && (
                  <div
                    style={{
                      borderTop: `1px solid ${colors.border.subtle}`,
                      padding: 12,
                      background: "rgba(0,0,0,0.15)",
                    }}
                  >
                    <div
                      style={{
                        ...styles.label,
                        marginBottom: 8,
                      }}
                    >
                      Execution Steps
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {exec.stepResults.map((stepResult, idx) => {
                        const stepSc = statusColor(stepResult.status);
                        return (
                          <div
                            key={stepResult.step.planStepId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontSize: 12,
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                background: "rgba(255,255,255,0.08)",
                                fontSize: 10,
                                flexShrink: 0,
                              }}
                            >
                              {idx + 1}
                            </span>
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: stepSc.color,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ flex: 1, fontWeight: 500 }}>
                              {stepResult.step.op}
                              {stepResult.error && (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    color: colors.accent.red,
                                    fontWeight: 400,
                                    fontSize: 11,
                                  }}
                                >
                                  {stepResult.error}
                                </span>
                              )}
                            </span>
                            {stepResult.durationMs !== undefined && (
                              <span style={{ opacity: 0.4, fontSize: 11 }}>
                                {stepResult.durationMs}ms
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
