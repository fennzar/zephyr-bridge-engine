"use client";

import { useCallback, useEffect, useState } from "react";

import type { StructuredLogEntry } from "@services/evm/logging";

export type LogEntry = StructuredLogEntry;

type Props = {
  initialEntries: LogEntry[];
};

export function LogTerminal({ initialEntries }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logs/evm?limit=150", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const payload = (await res.json()) as { entries?: LogEntry[] };
      setEntries(payload.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      fetchLatest().catch(() => {
        /* handled in promise */
      });
    }, 10000);
    return () => clearInterval(id);
  }, [fetchLatest]);

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#0e141b",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        height: 320,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          opacity: 0.7,
        }}
      >
        <span>Watcher Logs</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading ? <span style={{ opacity: 0.6 }}>Refreshing…</span> : null}
          <button
            type="button"
            onClick={fetchLatest}
            disabled={loading}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: loading ? "#18202a" : "#131a23",
              color: "#fff",
              fontSize: 12,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      <div
        style={{
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas",
          fontSize: 12,
          padding: 12,
          lineHeight: 1.4,
        }}
      >
        {error ? (
          <div style={{ color: "#f45b69" }}>{error}</div>
        ) : entries.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No log entries yet.</div>
        ) : (
          entries.map((entry, idx) => (
            <div key={`${entry.ts}-${idx}`} style={{ whiteSpace: "pre-wrap" }}>
              {formatEntry(entry)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatEntry(entry: LogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const base = `[${time}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
  if (entry.meta) {
    return `${base} ${JSON.stringify(entry.meta)}`;
  }
  return base;
}
