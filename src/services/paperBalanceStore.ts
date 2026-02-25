import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { PaperSource, PaperBalanceStore } from '@shared/paper';

const PAPER_STORE_FILE = process.env.PAPER_BALANCES_FILE ?? join('data', 'paper-balances.json');

function resolveProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return resolve(process.env.PROJECT_ROOT);

  let current = process.cwd();
  let candidate = current;
  while (true) {
    const pkgPath = join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkgRaw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkgRaw?.name === 'zephyr-bot') {
          return current;
        }
        candidate = current;
      } catch {
        candidate = current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return candidate;
    }
    current = parent;
  }
}

const ROOT_DIR = resolveProjectRoot();
const STORE_PATH = resolve(ROOT_DIR, PAPER_STORE_FILE);

async function ensureStoreFile(): Promise<void> {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  if (!existsSync(STORE_PATH)) {
    const initial: PaperBalanceStore = {
      mexc: {},
      zephyr: {},
      updatedAt: new Date().toISOString(),
    };
    await writeFile(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

export async function readPaperBalances(): Promise<PaperBalanceStore> {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw) as Partial<PaperBalanceStore>;
    return {
      mexc: parsed.mexc ?? {},
      zephyr: parsed.zephyr ?? {},
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    const fallback: PaperBalanceStore = {
      mexc: {},
      zephyr: {},
      updatedAt: new Date().toISOString(),
    };
    await writeFile(STORE_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

export async function writePaperBalances(store: PaperBalanceStore): Promise<PaperBalanceStore> {
  const payload: PaperBalanceStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export async function upsertPaperBalance(
  source: PaperSource,
  asset: string,
  amount: number,
): Promise<PaperBalanceStore> {
  const symbol = asset.trim().toUpperCase();
  if (!symbol) {
    throw new Error('Asset symbol required');
  }
  if (!Number.isFinite(amount)) {
    throw new Error('Amount must be finite');
  }

  const current = await readPaperBalances();
  const next: PaperBalanceStore = {
    ...current,
    [source]: {
      ...current[source],
      [symbol]: amount,
    },
    updatedAt: new Date().toISOString(),
  };
  return writePaperBalances(next);
}
