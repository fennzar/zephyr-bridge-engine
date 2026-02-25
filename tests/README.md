# Testing Playbook

This directory holds every shared test for the project. The current harness is **Vitest** with a Node environment, wired up in `vitest.config.ts`. We mock `next/server` so API route handlers can be invoked without starting a Next.js process.

## What Exists Today

- `worker/` – unit-style specs for worker helpers (`shared.spec.ts` keeps the legacy assertions).
- `web/api/` – handler-level checks (`arbitrage/plans.spec.ts` exercises the GET route, mocking `@services/arbitrage`).
- `domain/` – pure domain coverage (`quoting/bridge.spec.ts` validates bridge quote behaviour).
- `setup/` – global setup files (`env.ts` normalises `NODE_ENV`, `console.ts` silences noisy warnings so output stays clean).
- `mocks/` – simple stubs; e.g. `next-server.ts` emulates `NextResponse` for handler tests.
- `support/` – reusable factories (`factories.ts` builds stub `GlobalState` / bridge contexts).

Run everything with:

```bash
pnpm test        # one-shot run
pnpm test:watch  # watch mode while iterating
```

The root README’s “Structure” section mirrors this layout.

## Gaps & TODOs

1. **Domain Coverage:** we only have a bridge quoting smoke test. Add specs for:
   - `calibration.clip`, `calibration.twoVenue`, and other sizing logic (mock `quoteSwapOnchain`, `calibrateSwapVsCex`).
   - Planner routines (`buildArbPlan`, `buildClipScenario`) using the factories in `support`.
2. **API Surface:** `/api/arbitrage/plans` is covered, but additional routes need handler tests:
   - `/api/quoters`, `/api/runtime`, `/api/arbitrage/overview`, etc.
   - For each handler, mock the corresponding service function(s) and assert success & failure payloads.
3. **Engine/Watcher CLI:** consider unit tests for command helpers in `apps/engine/src` and `apps/watchers/src` (e.g. `shared/networks` already covered, but runtime commands and watchers are manual).
4. **Integration / E2E:** once the domain layers have good coverage, decide whether we need a minimal HTTP smoke test (spin up Next.js + hit `/api/...`). For now, keep focus on handler-level tests to stay fast.

## Maintenance Workflow

1. **New Features**
   - Drop the spec next to the relevant area (`tests/domain`, `tests/web`, or `tests/worker`).
   - Reuse `tests/support/factories.ts` to construct `GlobalState` / runtime contexts.
   - Use `vi.mock` for service dependencies so tests stay deterministic.

2. **Updating Existing APIs**
   - Update the handler test to reflect new response fields/status codes.
   - Add new factory helpers if additional shape data is needed frequently.

3. **Console Noise**
   - If a module intentionally logs warnings/errors, either assert on the spy output or extend `tests/setup/console.ts` to silence specific loggers.

4. **CI / Local**
   - Always run `pnpm test` and `pnpm typecheck` before committing.
   - Watch mode (`pnpm test:watch`) keeps the feedback loop quick during development.

## Tips

- Co-locate test data builders in `tests/support/` so project files stay untouched.
- Keep specs deterministic: mock timestamps, random IDs, and network IO.
- When adding coverage around large modules, start with “happy path” tests, then layer in edge cases (error throws, boundary values).

With this structure, maintaining the suite should remain lightweight: add a spec file, leverage the shared factories, and run the two core commands (`pnpm test`, `pnpm typecheck`). Anything more complex (integration smoke tests, fixtures for multi-step planners) can be layered on when we decide it’s worth the effort.
