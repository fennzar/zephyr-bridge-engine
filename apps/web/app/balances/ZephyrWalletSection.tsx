"use client";

import { formatTokenAmount, formatAddress } from "@/components/format";
import { colors, styles } from "@/components/theme";
import type { ZephyrWalletPayload } from "@/types/api";

export function ZephyrWalletSection({ zephyrWallet }: { zephyrWallet: ZephyrWalletPayload }) {
  if (!zephyrWallet) return null;

  return (
    <section style={{ ...styles.section, display: "grid", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={styles.label}>Zephyr Native Wallet</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {zephyrWallet.address ? formatAddress(zephyrWallet.address) : "\u2014"}
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: zephyrWallet.status === "ok" ? colors.accent.green : colors.accent.red,
          }}
        >
          {zephyrWallet.status === "ok"
            ? "Wallet connected"
            : zephyrWallet.error ?? "Connection error"}
        </div>
      </header>
      {zephyrWallet.balances ? (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              ...styles.table,
              minWidth: 400,
              border: `1px solid ${colors.border.primary}`,
              borderRadius: 8,
              background: colors.bg.card,
            }}
          >
            <thead>
              <tr style={styles.tableHeader}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Asset</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Total</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Unlocked</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  { symbol: "ZEPH", total: zephyrWallet.balances.zeph, unlocked: zephyrWallet.balances.unlockedZeph },
                  { symbol: "ZSD", total: zephyrWallet.balances.zsd, unlocked: zephyrWallet.balances.unlockedZsd },
                  { symbol: "ZRS", total: zephyrWallet.balances.zrs, unlocked: zephyrWallet.balances.unlockedZrs },
                  { symbol: "ZYS", total: zephyrWallet.balances.zys, unlocked: zephyrWallet.balances.unlockedZys },
                ] as const
              ).map((row) => (
                <tr key={row.symbol} style={{ borderTop: `1px solid ${colors.border.subtle}` }}>
                  <td style={{ padding: "12px", fontWeight: 600 }}>{row.symbol}</td>
                  <td style={{ padding: "12px", textAlign: "right" }}>{formatTokenAmount(row.total, 6)}</td>
                  <td style={{ padding: "12px", textAlign: "right" }}>{formatTokenAmount(row.unlocked, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, opacity: 0.7 }}>
          Unable to load wallet balances. {zephyrWallet.error ?? ""}
        </div>
      )}
    </section>
  );
}
