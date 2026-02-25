"use client";

import { useEffect, useState, useCallback } from "react";
import { colors, styles } from "@/components/theme";
import { SubNav } from "@/components/AppShell";
import type { EngineStatus, QueueOperation, EvaluationResult, ExecutionHistory } from "@/types/api";
import { StatusDot, Badge, StatCard } from "./engine.helpers";
import { EvaluationPanel } from "./EvaluationPanel";
import { OperationQueue } from "./OperationQueue";
import { ExecutionHistoryList } from "./ExecutionHistoryList";

export default function EnginePage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [queue, setQueue] = useState<QueueOperation[]>([]);
  const [history, setHistory] = useState<ExecutionHistory[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [togglingRunner, setTogglingRunner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(
    null,
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/engine/status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to fetch status:", err);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/engine/queue?status=pending");
      const data = await res.json();
      setQueue(data.operations || []);
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/engine/history?limit=10");
      const data = await res.json();
      setHistory(data.executions || []);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  }, []);

  const runEvaluation = useCallback(async () => {
    setEvaluating(true);
    try {
      const res = await fetch("/api/engine/evaluate?strategies=arb");
      const data = await res.json();
      setEvaluation(data);
    } catch (err) {
      console.error("Failed to evaluate:", err);
      setError("Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }, []);

  const handleApprove = useCallback(
    async (operationId: string) => {
      try {
        await fetch("/api/engine/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", operationId }),
        });
        await fetchQueue();
      } catch (err) {
        console.error("Failed to approve:", err);
      }
    },
    [fetchQueue],
  );

  const handleReject = useCallback(
    async (operationId: string) => {
      try {
        await fetch("/api/engine/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", operationId }),
        });
        await fetchQueue();
      } catch (err) {
        console.error("Failed to reject:", err);
      }
    },
    [fetchQueue],
  );

  const toggleAutoExecute = useCallback(async () => {
    const current = status?.runner?.autoExecute ?? false;
    setTogglingRunner(true);
    try {
      const res = await fetch("/api/engine/runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoExecute: !current }),
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to toggle runner:", err);
    } finally {
      setTogglingRunner(false);
    }
  }, [status?.runner?.autoExecute, fetchStatus]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchStatus(), fetchQueue(), fetchHistory()]);
      setLoading(false);
    };
    load();

    const interval = setInterval(() => {
      fetchStatus();
      fetchQueue();
      fetchHistory();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQueue, fetchHistory]);

  if (loading) {
    return (
      <main style={styles.pageContainer}>
        <div style={{ opacity: 0.6, fontSize: 13 }}>
          Loading engine status...
        </div>
      </main>
    );
  }

  return (
    <main style={{ ...styles.pageContainer, display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>Bridge Engine</h1>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Operations Dashboard</div>
        <SubNav links={[{ href: "/runtime", label: "Runtime" }]} />
      </div>

      {/* Runner Control */}
      <div
        style={{
          ...styles.card,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Execution Runner</div>
          <Badge
            label={status?.runner?.autoExecute ? "ACTIVE" : "PAUSED"}
            status={status?.runner?.autoExecute ? "normal" : "unknown"}
          />
          <span style={{ fontSize: 12, opacity: 0.5 }}>
            Cooldown: {((status?.runner?.cooldownMs ?? 60000) / 1000).toFixed(0)}s
          </span>
        </div>
        <button
          onClick={toggleAutoExecute}
          disabled={togglingRunner}
          style={{
            padding: "6px 16px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 6,
            border: "none",
            cursor: togglingRunner ? "wait" : "pointer",
            color: "#fff",
            background: status?.runner?.autoExecute
              ? colors.accent.red
              : colors.accent.green,
            opacity: togglingRunner ? 0.6 : 1,
          }}
        >
          {togglingRunner
            ? "..."
            : status?.runner?.autoExecute
              ? "Pause"
              : "Enable"}
        </button>
      </div>

      {error && (
        <div
          style={{
            ...styles.card,
            background: colors.accent.redBg,
            border: "1px solid rgba(244,91,105,0.3)",
            color: colors.accent.red,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Status Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard
          label="Database"
          value={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusDot on={status?.database.connected ?? false} />
              <span>
                {status?.database.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          }
        />
        <StatCard
          label="Reserve Ratio"
          value={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Badge
                label={(
                  status?.state.rrMode ?? "unknown"
                ).toUpperCase()}
                status={status?.state.rrMode ?? "unknown"}
              />
              <span>{status?.state.reserveRatio?.toFixed(0) ?? "\u2014"}%</span>
            </div>
          }
        />
        <StatCard
          label="Pending Ops"
          value={
            <span style={{ fontSize: 20, fontWeight: 600, color: colors.accent.orange }}>
              {status?.database.pendingOperations ?? 0}
            </span>
          }
        />
        <StatCard
          label="Executions (24h)"
          value={
            <span style={{ fontSize: 20, fontWeight: 600, color: colors.accent.blue }}>
              {status?.database.recentExecutions ?? 0}
            </span>
          }
        />
      </div>

      {/* Data Sources */}
      <div style={styles.section}>
        <div style={{ ...styles.label, marginBottom: 10 }}>Data Sources</div>
        <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
          {(
            [
              ["Zephyr", status?.state.zephyrAvailable],
              ["EVM", status?.state.evmAvailable],
              ["CEX", status?.state.cexAvailable],
            ] as const
          ).map(([name, available]) => (
            <div
              key={name}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <StatusDot on={available ?? false} />
              <span style={{ opacity: available ? 1 : 0.4 }}>{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy Evaluation */}
      <EvaluationPanel
        evaluation={evaluation}
        evaluating={evaluating}
        onRunEvaluation={runEvaluation}
      />

      {/* Operation Queue */}
      <OperationQueue
        queue={queue}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      {/* Execution History */}
      <ExecutionHistoryList
        history={history}
        selectedExecution={selectedExecution}
        onSelectExecution={setSelectedExecution}
      />
    </main>
  );
}
