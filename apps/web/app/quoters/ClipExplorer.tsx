'use client';

import { useCallback, useState } from "react";
import type { FormEvent } from "react";

import { ClipOptionCard } from "./ClipOptionCard";
import type { ClipApiResponse } from "./clipExplorer.types";

const ARB_ASSETS = ["ZEPH", "ZSD", "ZYS", "ZRS"] as const;
const DIRECTIONS: Array<{ value: "evm_discount" | "evm_premium"; label: string }> = [
  { value: "evm_discount", label: "EVM Discount" },
  { value: "evm_premium", label: "EVM Premium" },
];

export interface ClipExplorerProps {
  initialData: ClipApiResponse | null;
}

export function ClipExplorer({ initialData }: ClipExplorerProps) {
  const [asset, setAsset] = useState<string>(initialData?.asset ?? "ZEPH");
  const [direction, setDirection] = useState<string>(initialData?.direction ?? "evm_discount");
  const [amountOverride, setAmountOverride] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialData?.error ?? null);
  const [data, setData] = useState<ClipApiResponse | null>(initialData);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPending(true);
      setError(null);
      try {
        const params = new URLSearchParams({ asset, direction });
        if (amountOverride.trim()) params.set("amount", amountOverride.trim());
        const response = await fetch(`/api/quoters/clip?${params.toString()}`);
        const payload = (await response.json()) as ClipApiResponse;
        if (!response.ok) {
          setError(payload?.error ?? "Failed to run clip analysis");
          setData(null);
        } else {
          setData(payload);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
        setData(null);
      } finally {
        setPending(false);
      }
    },
    [asset, direction, amountOverride],
  );

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20 }}>Clip Explorer</h2>
        <p style={{ margin: "4px 0", fontSize: 13, opacity: 0.75 }}>
          Inspect the estimated clip sizing, pool depth, and candidate paths the planner will use for a selected leg.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gap: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          padding: 16,
          borderRadius: 8,
          background: "#101720",
        }}
      >
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>Asset</span>
            <select
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
              style={{ padding: "6px 8px", borderRadius: 4 }}
            >
              {ARB_ASSETS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>Direction</span>
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              style={{ padding: "6px 8px", borderRadius: 4 }}
            >
              {DIRECTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>Amount override (base asset units)</span>
            <input
              value={amountOverride}
              onChange={(event) => setAmountOverride(event.target.value)}
              placeholder="optional"
              style={{ padding: "6px 8px", borderRadius: 4 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="submit" disabled={pending} style={{ padding: "6px 12px", borderRadius: 4 }}>
            {pending ? "Loading…" : "Run clip analysis"}
          </button>
        </div>
      </form>

      {error ? (
        <div style={{ color: "#f45b69", fontSize: 13 }}>{error}</div>
      ) : data ? (
        <div style={{ display: "grid", gap: 16 }}>
          {data.options && data.options.length > 0 ? (
            data.options.map((option, index) => (
              <ClipOptionCard
                key={`${option.flavor}-${index}`}
                option={option}
                index={index}
                pool={data.pool}
                asset={data.asset}
                direction={data.direction}
                zephSpotUsd={data.zephSpotUsd ?? null}
              />
            ))
          ) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>No routes available.</div>
          )}

          <details>
            <summary style={{ cursor: "pointer", opacity: 0.7 }}>Raw API response</summary>
            <pre style={{ margin: "8px 0 0", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
