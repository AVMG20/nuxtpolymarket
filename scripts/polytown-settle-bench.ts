// Polytown settle speed: how long the server spends replaying a full town's
// offline window, which /api/town/state and /api/town/contracts both wait on.
// Builds a max-size town (every plot filled, streets on every third row), with
// a few jobs finishing mid-window so the layout changes during the settle.
//
//   bun scripts/polytown-settle-bench.ts          time it
//   bun scripts/polytown-settle-bench.ts --save   also write the result as the baseline
//   bun scripts/polytown-settle-bench.ts --check  compare the result to the saved baseline

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import {
    TOWN_MAX_OFFLINE_MS,
    TOWN_MAX_PLOTS,
    TOWN_PLOT_SIZE,
    TOWN_RESOURCES,
    deriveTown,
    settleTown,
    townSupplyNetwork,
    type TownBuildingId,
    type TownSimBuilding
} from '../shared/utils/gamelogic/town.ts'

const BASELINE = '/tmp/polytown-settle-baseline.json'
const now = Date.UTC(2026, 10, 4, 12)
const from = now - TOWN_MAX_OFFLINE_MS

// Weighted so the town has the houses to staff its workshops.
const MIX: TownBuildingId[] = [
    'house', 'house', 'house', 'house', 'house', 'house', 'house', 'house',
    'park', 'bathhouse', 'theatre', 'warehouse', 'warehouse',
    'farm', 'farm', 'lumber', 'quarry', 'mill', 'sawmill', 'kiln', 'gemmine',
    'bakery', 'smithy', 'mine', 'foundry', 'factory', 'emporium'
]

const buildings: TownSimBuilding[] = []
let n = 0
for (let p = 0; p < TOWN_MAX_PLOTS; p++) {
    const px = p % 3
    const py = Math.floor(p / 3)
    for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
        for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
            const wx = px * TOWN_PLOT_SIZE + tx
            const wy = py * TOWN_PLOT_SIZE + ty
            const row = ty % 3
            const id = `b${n++}`
            const createdAt = from - 86_400_000 + n * 1000
            if (row === 1) {
                buildings.push({ id, type: 'road', level: 1, completesAt: createdAt, upgradingTo: null, createdAt, wx, wy, rotation: 0 })
                continue
            }
            const type = MIX[n % MIX.length]!
            // Every 17th building is mid-upgrade or mid-build and lands during the window.
            const pending = n % 17 === 0
            const level = pending && n % 2 === 0 ? 0 : 5
            buildings.push({
                id,
                type,
                level,
                completesAt: pending ? from + (n * 997_000) % TOWN_MAX_OFFLINE_MS : createdAt,
                upgradingTo: pending && level > 0 ? 6 : null,
                createdAt,
                wx,
                wy,
                rotation: row === 0 ? 0 : 2
            })
        }
    }
}

const inventory: Record<string, number> = {}
for (const r of TOWN_RESOURCES) inventory[r.id] = 500

const state = {
    happiness: Number(process.env.HAPPY ?? 40),
    tickProgressMs: 0,
    lastSettledAt: from,
    inventory,
    buildings,
    carry: {},
    productionBoostUntil: from + 2 * 3_600_000
}

const t0 = performance.now()
const result = settleTown(state, now)
const settleMs = performance.now() - t0

const t1 = performance.now()
const network = townSupplyNetwork(buildings, now)
for (let i = 0; i < 20; i++) deriveTown(buildings, 60, now, {}, network)
const deriveMs = (performance.now() - t1) / 20

console.log(`${buildings.length} buildings, ${result.ticks} ticks`)
console.log(`settleTown: ${settleMs.toFixed(0)} ms`)
console.log(`deriveTown: ${deriveMs.toFixed(2)} ms`)

const snapshot = JSON.stringify(result)
if (process.argv.includes('--save')) {
    writeFileSync(BASELINE, snapshot)
    console.log(`Saved the baseline to ${BASELINE}`)
}
if (process.argv.includes('--check')) {
    if (!existsSync(BASELINE)) throw new Error('No baseline: run with --save first')
    const same = readFileSync(BASELINE, 'utf8') === snapshot
    console.log(same ? 'Result matches the baseline' : 'RESULT DIFFERS from the baseline')
    if (!same) process.exit(1)
}
