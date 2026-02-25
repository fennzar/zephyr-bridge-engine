export type PaperLedgerBalances = Record<string, number>;

export interface BalanceSnapshotConfig {
  mexcPaper: boolean;
  zephyrPaper: boolean;
}

export interface BalanceSnapshotEvm {
  status: "ok" | "off" | "error";
  nativeSymbol: string;
  native: number;
  tokens: Record<string, number>;
  error?: string;
}

export interface BalanceSnapshotPaper {
  updatedAt: string | null;
  mexc?: PaperLedgerBalances;
  zephyr?: PaperLedgerBalances;
}

export interface BalanceSnapshotZephyr {
  status: "ok" | "error" | "unavailable";
  address: string | null;
  balances: {
    zeph: number;
    zsd: number;
    zrs: number;
    zys: number;
    unlockedZeph: number;
    unlockedZsd: number;
    unlockedZrs: number;
    unlockedZys: number;
  } | null;
  error?: string;
}

export interface BalanceSnapshotCex {
  status: "ok" | "error";
  balances: { ZEPH: number; USDT: number } | null;
  error?: string;
}

export interface BalanceSnapshot {
  config: BalanceSnapshotConfig;
  evm: BalanceSnapshotEvm;
  paper?: BalanceSnapshotPaper | null;
  zephyr?: BalanceSnapshotZephyr | null;
  cex?: BalanceSnapshotCex | null;
}

export function getEvmTokenBalance(bal: BalanceSnapshot | null, symbol: string): number | null {
  if (!bal || bal.evm.status !== "ok") return null;
  return bal.evm.tokens?.[symbol.toUpperCase()] ?? 0;
}

export function getPaperBalance(
  bal: BalanceSnapshot | null,
  ledger: "mexc" | "zephyr",
  symbol: string,
): number | null {
  if (!bal?.paper) return null;
  const book = bal.paper[ledger];
  if (!book) return null;
  const value = book[symbol.toUpperCase()];
  if (value == null) return 0;
  return Number.isFinite(value) ? value : null;
}

export function getPaperTotalBalance(bal: BalanceSnapshot | null, symbol: string): number | null {
  if (!bal?.paper) return null;
  const upper = symbol.toUpperCase();
  const ledgers: Array<"mexc" | "zephyr"> = ["mexc", "zephyr"];
  let total = 0;
  let found = false;
  for (const ledger of ledgers) {
    const book = bal.paper?.[ledger];
    const value = book?.[upper];
    if (value != null && Number.isFinite(value)) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

export function getEvmBalanceForSymbol(bal: BalanceSnapshot | null, symbol: string): number | null {
  if (!bal || bal.evm.status !== "ok") return null;
  const upper = symbol.toUpperCase();
  if (upper === bal.evm.nativeSymbol.toUpperCase()) {
    const value = bal.evm.native;
    return Number.isFinite(value) ? value : null;
  }
  const tokenValue = bal.evm.tokens?.[upper];
  return tokenValue != null && Number.isFinite(tokenValue) ? tokenValue : null;
}
