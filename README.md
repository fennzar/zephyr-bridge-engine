# Zephyr Bridge Engine

Arbitrage and liquidity management bot for the Zephyr Protocol. Monitors price discrepancies across three venues — EVM (Uniswap V4), Native (Zephyr chain via daemon RPC), and CEX (MEXC) — and executes profitable trades with risk controls and manual approval workflows.

The four assets are ZEPH, ZSD (stablecoin), ZRS (reserve shares), and ZYS (yield shares). Their wrapped EVM equivalents are WZEPH, WZSD, WZRS, WZYS.

## Local Development

The local devnet environment (Anvil EVM fork + Zephyr daemon) is managed by the companion **[bridge-orchestration](https://github.com/fennzar/bridge-orchestration)** repo. See its README for:

- `make dev-init` — bootstrap Zephyr devnet
- `make dev-setup` — deploy contracts + seed pools
- `make dev` — start full stack

The orchestration repo generates `.env` and `src/services/evm/config/addresses.local.json` — do not edit these files directly.

## Quick Start

```bash
# install dependencies
pnpm install

# copy and edit environment variables
cp .env.example .env

# set up the database (requires DATABASE_URL in .env)
pnpm db:generate
pnpm db:migrate

# start the engine (manual approval mode, paper by default)
pnpm engine:run

# or start the dashboard
pnpm dev:web
```

## Commands

### Engine

```bash
pnpm engine:run             # start engine loop (manual approval mode)
pnpm engine:run:auto        # auto-execute operations that pass risk checks
pnpm engine:eval            # one-shot evaluation, no execution
```

### Watchers

```bash
pnpm watcher:evm            # Uniswap V4 pool watcher
pnpm watcher:mexc           # MEXC ticker stream
pnpm watcher:zephyr         # Zephyr daemon reserve poller
pnpm watcher:run            # run all watchers concurrently
```

### Dashboard

```bash
pnpm dev:web                # Next.js dashboard on port 7000
```

### Database

```bash
pnpm db:generate            # regenerate Prisma client
pnpm db:migrate             # create/apply dev migrations
pnpm db:push                # push schema without migration
pnpm db:studio              # GUI at localhost:5555
```

### Quality

```bash
pnpm typecheck              # all three apps
pnpm lint                   # web (next lint) + watchers (prettier)
pnpm test                   # vitest run (all tests)
pnpm test:watch             # vitest watch mode
```

## Architecture

Three apps share a core `src/` layer via path aliases:

```
apps/
  engine/    → CLI (Commander) — main loop: evaluate → plan → execute
  watchers/  → 3 data feed processes (EVM, MEXC, Zephyr)
  web/       → Next.js 15 dashboard on port 7000

src/
  shared/    (@shared)   → Zod-validated env loader, formatting utils
  domain/    (@domain)   → Pure business logic, no I/O
  services/  (@services) → External integrations (viem, MEXC REST/WS, Zephyr RPC)
  infra/     (@infra)    → Prisma client, DB persistence helpers
```

### Engine Main Loop

Each cycle: `buildGlobalState()` → `loadInventorySnapshot()` → evaluate all strategies → risk checks → auto-execute or queue for manual approval → record history.

## Strategies

| Strategy | Purpose |
|----------|---------|
| **Arbitrage** | Detects cross-venue price discrepancies and executes multi-leg trades |
| **Rebalancer** | Maintains target inventory allocations across venues |
| **Peg Keeper** | Monitors ZSD's dollar peg and intervenes when it drifts |
| **LP Manager** | Manages Uniswap V4 liquidity positions (add/remove/rebalance) |

Strategies adapt behavior based on the Zephyr reserve ratio — normal (>400%), defensive (200-400%), or crisis (<200%).

## Execution Modes

The engine runs in one of three modes, set via `--mode` flag or `EXECUTION_MODE` env var:

| Mode | EVM | Zephyr | CEX | Use case |
|------|-----|--------|-----|----------|
| **paper** | Simulated | Simulated | Fake orderbook | Safe testing, no infra required |
| **devnet** | Real txns on Anvil | Real txns on devnet | Fake orderbook | End-to-end testing with bridge-orchestration |
| **live** | Real txns | Real txns | Real MEXC API | Production |

Paper mode is the default. Devnet mode requires the [bridge-orchestration](https://github.com/fennzar/bridge-orchestration) local environment running (Anvil + Zephyr daemon). Live mode connects to real MEXC and requires API credentials.

### Approval Modes

The engine defaults to **manual approval** — operations are queued for review via the dashboard. To enable auto-execution for operations that pass risk checks:

```bash
pnpm engine:run:auto        # CLI flag
```

Approval mode can also be toggled at runtime via the `EngineSettings` DB table or the dashboard API, without restarting the engine.
