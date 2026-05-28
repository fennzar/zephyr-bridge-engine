/**
 * Shared FAKE_ORDERBOOK configuration helpers.
 *
 * When `FAKE_ORDERBOOK_ENABLED=true` (devnet/test mode), MEXC REST + WS calls
 * are redirected to a local fake orderbook process on `FAKE_ORDERBOOK_PORT`
 * (default 5556). Both rest+ws paths previously inlined the same env reads.
 */

export const FAKE_ORDERBOOK_ENABLED = process.env.FAKE_ORDERBOOK_ENABLED === 'true';
export const FAKE_ORDERBOOK_PORT = process.env.FAKE_ORDERBOOK_PORT || '5556';

/** Live MEXC REST origin used when the fake orderbook is disabled. */
export const MEXC_REST_BASE_URL = 'https://api.mexc.com';

/** Live MEXC WS origin used when the fake orderbook is disabled. */
export const MEXC_WS_URL = 'wss://wbs-api.mexc.com/ws';

/** Resolve the effective REST base URL based on FAKE_ORDERBOOK flag. */
export function resolveMexcRestBaseUrl(): string {
  return FAKE_ORDERBOOK_ENABLED
    ? `http://127.0.0.1:${FAKE_ORDERBOOK_PORT}`
    : MEXC_REST_BASE_URL;
}

/** Resolve the effective WS URL based on FAKE_ORDERBOOK flag. */
export function resolveMexcWsUrl(): string {
  return FAKE_ORDERBOOK_ENABLED
    ? `ws://127.0.0.1:${FAKE_ORDERBOOK_PORT}`
    : MEXC_WS_URL;
}
