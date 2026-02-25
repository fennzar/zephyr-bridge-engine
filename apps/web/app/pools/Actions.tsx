"use client";

import { useState, useCallback } from "react";

type ActionDescriptor = {
  id: "refresh" | "backfill" | "reset";
  label: string;
  description: string;
};

const ACTIONS: ActionDescriptor[] = [
  {
    id: "refresh",
    label: "Refresh Pools",
    description: "Run a one-off poll for new pool/position events.",
  },
  {
    id: "backfill",
    label: "Backfill History",
    description: "Replay historical logs from the configured start block.",
  },
  {
    id: "reset",
    label: "Reset State",
    description: "Clear the watcher cursor so the next run rescans from scratch.",
  },
];

export function PoolActionsPanel() {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = useCallback(
    async (actionId: ActionDescriptor["id"]) => {
      if (pending) return;
      setPending(actionId);
      setMessage(null);
      setError(null);
      try {
        const response = await fetch("/api/pools/actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: actionId }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            payload.error ?? `Request failed with status ${response.status}`,
          );
        }
        const payload = (await response.json()) as {
          success: boolean;
          result?: { message?: string };
        };
        if (!payload.success) {
          throw new Error("Action did not complete successfully");
        }
        setMessage(payload.result?.message ?? "Action queued");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {ACTIONS.map((action) => {
        const isPending = pending === action.id;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => trigger(action.id)}
            disabled={Boolean(pending)}
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: isPending ? "#1e2a38" : "#131a23",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 4,
              cursor: isPending ? "wait" : "pointer",
            }}
          >
            <span style={{ fontWeight: 600 }}>{action.label}</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {action.description}
            </span>
          </button>
        );
      })}

      {(message || error) && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: error
              ? "rgba(244,91,105,0.12)"
              : "rgba(22,199,132,0.12)",
            color: error ? "#f45b69" : "#16c784",
            fontSize: 13,
          }}
        >
          {error ?? message}
        </div>
      )}
    </div>
  );
}
