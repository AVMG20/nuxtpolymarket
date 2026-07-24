---
name: playwright-game-debug
description: Debug Polynux canvas and Pixi games with Playwright using the development-only game bridge. Use for visual defects, canvas interaction failures, responsive game layouts, Pixi scene visibility, runtime state inspection, browser console errors, screenshots, traces, or automated smoke tests under app games and canvas engines.
---

# Playwright Game Debug

Use the development bridge before relying on coordinate guesses. It is available only in a Nuxt development build as `window.__POLYNUX_DEV_BRIDGE__`; never enable it in production.

## Workflow

1. Start PostgreSQL with `docker compose up -d postgres`.
2. Start Nuxt with `bun run dev`.
3. Reuse an installed Playwright dependency. If absent and browser automation is required, add it with Bun only.
4. Sign in through the UI or API and retain Playwright storage state when the route is protected.
5. Navigate to the game route and wait for the registered bridge ID.
6. Inspect bridge state and the Pixi scene before taking screenshots or clicking coordinates.
7. Capture console errors, failed requests, a trace, and screenshots at the relevant viewport.
8. Reproduce at least once after the fix and keep assertions based on stable state or labels.

## Bridge API

Evaluate the bridge inside the page:

```ts
const games = await page.evaluate(() => window.__POLYNUX_DEV_BRIDGE__?.list())

await page.evaluate(async () => {
  await window.__POLYNUX_DEV_BRIDGE__?.waitFor('shapezz')
})

const inspection = await page.evaluate(() =>
  window.__POLYNUX_DEV_BRIDGE__?.inspect('shapezz')
)

await page.evaluate(() =>
  window.__POLYNUX_DEV_BRIDGE__?.run('shapezz', 'togglePause')
)
```

`list()` returns IDs, renderer kinds, and named actions. `inspect(id)` returns serializable canvas dimensions, game state when provided, and a bounded Pixi scene tree when available. `run(id, action, input?)` invokes an explicitly registered development action. `waitFor(id, timeoutMs?)` waits for asynchronous engine initialization.

Current IDs:

- `aethergates`
- `book-of-shadows`
- `candy-madness`
- `fire-in-the-hole`
- `pirate-raid`
- `shapezz`
- `spinata`
- `xeno-slot`

Discover IDs with `list()` instead of assuming this list is exhaustive.

## Visual debugging

Prefer `locator.screenshot()` on the canvas or containing game card. Use `page.screenshot({ fullPage: true })` for layout defects. Set an explicit viewport and device scale factor. Treat small WebGL pixel differences as noise unless the environment is fixed.

For interaction:

- Prefer DOM controls and accessible names around the canvas.
- Use bridge actions for engine-only operations.
- Use canvas-relative coordinates only when testing pointer mechanics.
- Read `inspect(id).canvas` before translating design coordinates to CSS pixels.

For Pixi:

- Search the scene snapshot by `label` and `type`.
- Add stable `label` values to important containers or sprites when an assertion needs them.
- Do not expose raw Pixi objects through the bridge; return serializable snapshots.

## Extending the bridge

Register non-Pixi games with `registerGameDevBridge` from `app/utils/game-dev-bridge.ts`. Register Pixi applications with `registerPixiDevBridge`. Provide stable kebab-case IDs, serializable state, and narrowly scoped named actions. Always call the returned unregister function during teardown.

Shared slot games should pass their ID to `initSlotPixiApp`; registration and cleanup are handled there.

Guard every integration with `import.meta.dev` and dynamically import `game-dev-bridge.ts` inside that guard. Do not statically import the bridge from game code. This keeps the entire bridge module out of production bundles and ensures production execution never patches a Pixi lifecycle or registers debug state.

Never expose secrets, session tokens, arbitrary code execution, database mutation helpers, or production-only state through the bridge.

## Test expectations

Assert in this order:

1. No unexpected console errors or failed requests.
2. The expected bridge ID appears.
3. Canvas dimensions are non-zero and connected.
4. Relevant game state or scene labels match.
5. The visual screenshot is correct.

Keep screenshot baselines, traces, and videos out of version control unless the task explicitly adds a maintained Playwright suite.
