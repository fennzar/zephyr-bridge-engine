"use client";

import { useEffect, useState, useCallback } from "react";
import { colors, styles, statusColor } from "@/components/theme";
import {
  formatRelativeTime,
  formatDuration,
  formatCurrency,
} from "@/components/format";

type Step = {
  op: string;
  from: string;
  to: string;
  status: string;
  amountIn?: string;
  amountOut?: string;
  txHash?: string;
  durationMs?: number;
  error?: string;
};

type ActivityEntry = {
  id: string;
  strategy: string;
  mode: "paper" | "devnet" | "live";
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  netPnlUsd: number | null;
  opportunity: {
    asset?: string;
    direction?: string;
    expectedPnl: number;
  } | null;
  steps: Step[];
};

type FilterType = "all" | "swap" | "wrap" | "lp" | "mint" | "cex";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "swap", label: "Swaps" },
  { key: "wrap", label: "Wraps/Unwraps" },
  { key: "lp", label: "LP Ops" },
  { key: "mint", label: "Mints/Redeems" },
  { key: "cex", label: "CEX Trades" },
];

const OP_COLORS: Record<string, string> = {
  swapEVM: colors.accent.blue,
  swap: colors.accent.blue,
  wrap: colors.accent.green,
  unwrap: colors.accent.orange,
  lpMint: "#a78bfa",
  lpBurn: "#a78bfa",
  addLiquidity: "#a78bfa",
  removeLiquidity: "#a78bfa",
  mintZSD: colors.accent.green,
  redeemZSD: colors.accent.red,
  mintZRS: colors.accent.green,
  redeemZRS: colors.accent.red,
  mintZYS: colors.accent.green,
  redeemZYS: colors.accent.red,
  tradeCEX: colors.accent.orange,
  buyCEX: colors.accent.green,
  sellCEX: colors.accent.red,
  depositCEX: colors.accent.blue,
  withdrawCEX: colors.accent.orange,
};

function OpPill({ op }: { op: string }) {
  const color = OP_COLORS[op] ?? colors.text.dimmed;
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        border: `1px solid ${color}40`,
        color,
        background: `${color}15`,
      }}
    >
      {op}
    </span>
  );
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [strategy, setStrategy] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const fetchActivity = useCallback(
    async (append = false) => {
      try {
        if (!append) setLoading(true);
        const params = new URLSearchParams({
          limit: "50",
          offset: append ? String(offset + 50) : "0",
        });
        if (filter !== "all") params.set("type", filter);
        if (strategy !== "all") params.set("strategy", strategy);
        const res = await fetch(`/api/engine/activity?${params}`);
        const data = await res.json();
        if (append) {
          setEntries((prev) => [...prev, ...(data.entries ?? [])]);
          setOffset((prev) => prev + 50);
        } else {
          setEntries(data.entries ?? []);
          setOffset(0);
        }
        setTotal(data.total ?? 0);
        setHasMore(data.hasMore ?? false);
      } catch (err) {
        console.error("Failed to fetch activity:", err);
      } finally {
        setLoading(false);
      }
    },
    [filter, strategy, offset],
  );

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(() => fetchActivity(), 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, strategy]);

  return (
    <main style={{ ...styles.pageContainer, display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>Activity</h1>
        <div style={{ fontSize: 13, opacity: 0.6 }}>
          Engine execution history &middot; {total} total
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  ...styles.badge,
                  cursor: "pointer",
                  background: active ? "rgba(255,255,255,0.1)" : "transparent",
                  color: active ? colors.text.primary : colors.text.dimmed,
                  border: active
                    ? `1px solid ${colors.border.input}`
                    : `1px solid ${colors.border.primary}`,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          style={{
            ...styles.input,
            fontSize: 11,
            padding: "4px 8px",
          }}
        >
          <option value="all">All strategies</option>
          <option value="arb">Arbitrage</option>
          <option value="rebalancer">Rebalancer</option>
          <option value="peg_keeper">Peg Keeper</option>
          <option value="lp_manager">LP Manager</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Entries */}
      {loading && entries.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.5, padding: "32px 0", textAlign: "center" }}>
          Loading activity...
        </div>
      ) : entries.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.4, padding: "32px 0", textAlign: "center" }}>
          No executions found
        </div>
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          {entries.map((entry) => {
            const sc = statusColor(entry.status);
            const isExpanded = expanded === entry.id;
            return (
              <div
                key={entry.id}
                style={{
                  ...styles.card,
                  padding: 0,
                  overflow: "hidden",
                }}
              >
                {/* Row */}
                <div
                  style={{
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    gap: 12,
                  }}
                  onClick={() =>
                    setExpanded(isExpanded ? null : entry.id)
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {/* Status dot */}
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: sc.color,
                        flexShrink: 0,
                      }}
                    />

                    {/* Timestamp */}
                    <span
                      style={{
                        fontSize: 11,
                        opacity: 0.5,
                        whiteSpace: "nowrap",
                        minWidth: 60,
                      }}
                    >
                      {formatRelativeTime(entry.startedAt)}
                    </span>

                    {/* Strategy badge */}
                    <span
                      style={{
                        ...styles.badge,
                        color: colors.text.muted,
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.strategy}
                    </span>

                    {/* Op pills */}
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        flexWrap: "wrap",
                        overflow: "hidden",
                      }}
                    >
                      {entry.steps.slice(0, 4).map((step, i) => (
                        <OpPill key={i} op={step.op} />
                      ))}
                      {entry.steps.length > 4 && (
                        <span
                          style={{
                            fontSize: 10,
                            opacity: 0.4,
                          }}
                        >
                          +{entry.steps.length - 4}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right side */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexShrink: 0,
                    }}
                  >
                    {entry.netPnlUsd !== null && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color:
                            entry.netPnlUsd >= 0
                              ? colors.accent.green
                              : colors.accent.red,
                        }}
                      >
                        {entry.netPnlUsd >= 0 ? "+" : ""}
                        {formatCurrency(entry.netPnlUsd)}
                      </span>
                    )}
                    {entry.durationMs != null && (
                      <span style={{ fontSize: 11, opacity: 0.4 }}>
                        {formatDuration(entry.durationMs)}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        opacity: 0.3,
                        transform: isExpanded
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▼
                    </span>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: `1px solid ${colors.border.subtle}`,
                      padding: 12,
                      background: "rgba(0,0,0,0.12)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {/* Summary row */}
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        fontSize: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      {entry.opportunity?.asset && (
                        <span>
                          <span style={{ opacity: 0.5 }}>Asset: </span>
                          {entry.opportunity.asset}
                        </span>
                      )}
                      {entry.opportunity?.direction && (
                        <span>
                          <span style={{ opacity: 0.5 }}>Direction: </span>
                          {entry.opportunity.direction}
                        </span>
                      )}
                      <span>
                        <span style={{ opacity: 0.5 }}>Mode: </span>
                        {entry.mode}
                      </span>
                      <span>
                        <span style={{ opacity: 0.5 }}>Steps: </span>
                        {entry.steps.length}
                      </span>
                    </div>

                    {/* Step list */}
                    <div style={{ display: "grid", gap: 6 }}>
                      {entry.steps.map((step, idx) => {
                        const stepSc = statusColor(step.status);
                        return (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontSize: 12,
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: "rgba(255,255,255,0.03)",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 18,
                                height: 18,
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
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: stepSc.color,
                                flexShrink: 0,
                              }}
                            />
                            <OpPill op={step.op} />
                            {step.from && (
                              <span style={{ opacity: 0.5 }}>
                                {step.from}
                                {step.to ? ` → ${step.to}` : ""}
                              </span>
                            )}
                            <span style={{ flex: 1 }} />
                            {step.amountIn && (
                              <span style={{ opacity: 0.6 }}>
                                in: {step.amountIn}
                              </span>
                            )}
                            {step.amountOut && (
                              <span style={{ opacity: 0.6 }}>
                                out: {step.amountOut}
                              </span>
                            )}
                            {step.txHash && (
                              <span
                                style={{
                                  fontSize: 10,
                                  opacity: 0.4,
                                  fontFamily: "monospace",
                                }}
                              >
                                {step.txHash.slice(0, 6)}…
                                {step.txHash.slice(-4)}
                              </span>
                            )}
                            {step.durationMs != null && (
                              <span style={{ opacity: 0.4, fontSize: 11 }}>
                                {step.durationMs}ms
                              </span>
                            )}
                            {step.error && (
                              <span
                                style={{
                                  color: colors.accent.red,
                                  fontSize: 11,
                                }}
                              >
                                {step.error}
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

          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign: "center", paddingTop: 8 }}>
              <button
                type="button"
                onClick={() => fetchActivity(true)}
                style={styles.button}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
