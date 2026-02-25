## Watchers

This directory contains three data-feed processes that stream live market and chain data into the shared database. Each watcher runs as a standalone CLI (Commander-based).

### Entry points
- `src/index.ts` – orchestrator that can run multiple watchers at once.
- `src/mexc.ts` – MEXC websocket + REST utilities.
- `src/evm.ts` – Uniswap V4 pool watcher.
- `src/zephyr.ts` – Zephyr daemon reserve state poller.

### Commands

```bash
pnpm watcher:mexc               # start MEXC watcher + HTTP/WS bridge
pnpm watcher:evm                # follow Uniswap V4 pools via websocket
pnpm watcher:zephyr             # poll Zephyr daemon for reserve state
pnpm watcher:run                # start all watchers concurrently
```

### MEXC watcher quickstart

Once `pnpm watcher:mexc` is running (defaults to `http://127.0.0.1:7020`):

- **Health probe**

  ```bash
  curl http://127.0.0.1:7020/health
  ```

- **Snapshot (top-of-book + depth)**

  ```bash
  curl "http://127.0.0.1:7020/snapshot?limit=20"
  ```

- **Recent trades**

  ```bash
  curl "http://127.0.0.1:7020/trades?limit=50"
  ```

- **WebSocket streams** (ticker, depth, trades)

  ```bash
  npx wscat -c ws://127.0.0.1:7020/ws?topic=ticker
  npx wscat -c ws://127.0.0.1:7020/ws?topic=depth
  npx wscat -c ws://127.0.0.1:7020/ws?topic=trades
  ```

Each topic pushes the latest snapshot immediately on connect and streams subsequent updates straight from the watcher. The dashboard and engine connect to these endpoints rather than the exchange directly.
