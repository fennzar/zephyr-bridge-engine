export type DiscoveryMode = "bothTracked" | "eitherTracked";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Exponential backoff helper for RPC 429s/timeouts. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  {
    retries = 5,
    startMs = 500,
    factor = 1.75,
    onRetry,
  }: {
    retries?: number;
    startMs?: number;
    factor?: number;
    onRetry?: (e: unknown, attempt: number, delay: number) => void;
  } = {}
): Promise<T> {
  let delay = startMs;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries) throw e;
      onRetry?.(e, attempt + 1, delay);
      await sleep(delay);
      delay = Math.min(Math.round(delay * factor), 10_000);
      attempt++;
    }
  }
}
