"use client";

import { useCallback, useEffect, useState } from "react";
import { colors, styles } from "@/components/theme";
import { SubNav } from "@/components/AppShell";
import type { BalancesResponse } from "@/types/api";

import { EvmWalletSection } from "./EvmWalletSection";
import { ZephyrWalletSection } from "./ZephyrWalletSection";
import { InventoryActionsPanel } from "./InventoryActionsPanel";
import { PaperBalanceSection } from "./PaperBalanceSection";

function BalancesPage() {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/balances", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Balances request failed (${res.status})`);
      }
      const json = (await res.json()) as BalancesResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return (
    <main style={{ ...styles.pageContainer, display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Balances</h1>
          <div style={{ fontSize: 14, opacity: 0.75 }}>
            Inspect live EVM holdings and adjust paper balances for MEXC and Zephyr native wallets.
          </div>
          <SubNav
            links={[
              { href: "/exchange", label: "Paper Exchange" },
              { href: "/inventory/prep", label: "Inventory Prep" },
              { href: "/inventory/paths", label: "Inventory Paths" },
            ]}
          />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            type="button"
            onClick={fetchBalances}
            style={styles.button}
          >
            Refresh
          </button>
          {loading ? <span style={{ fontSize: 12, opacity: 0.7 }}>Loading...</span> : null}
          {error ? (
            <span style={{ fontSize: 12, color: colors.accent.red }}>{error}</span>
          ) : data?.error ? (
            <span style={{ fontSize: 12, color: colors.accent.red }}>{data.error}</span>
          ) : null}
          {data?.paper?.updatedAt ? (
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              Paper updated {new Date(data.paper.updatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      </header>

      <EvmWalletSection evm={data?.evm} />

      {data?.zephyrWallet ? (
        <ZephyrWalletSection zephyrWallet={data.zephyrWallet} />
      ) : null}

      <InventoryActionsPanel onRefresh={fetchBalances} />

      <PaperBalanceSection data={data} onRefresh={fetchBalances} />
    </main>
  );
}

export default BalancesPage;
