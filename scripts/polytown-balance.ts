// Polytown pacing check: how long does a mayor with UNLIMITED coins but no
// market purchases take to reach each tier? Coins are not the wall for the
// site's whales (50–100M/day elsewhere), so the wall must be real time: build
// timers, plot cooldowns, and above all the goods a tier needs, which only the
// town's own tiles can produce. A greedy hour-by-hour planner builds toward the
// next tier and we report the day each tier's first building starts.
//
// Run: bun scripts/polytown-balance.ts

import {
    TOWN_BUILDINGS,
    TOWN_PLOT_SIZE,
    TOWN_MAX_PLOTS,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_MAX_BUILDING_LEVEL,
    getTownBuilding,
    settleTown,
    deriveTown,
    townLevelCost,
    townLevelBuildMs,
    townPlotCooldownMs,
    townTierRequirement,
    townNetPerTick,
    townPlaceCost,
    townFloorPrice,
    isBuilt,
    type TownBuildingDef,
    type TownBuildingId,
    type TownResourceBag,
    type TownResourceId,
    type TownSimBuilding
} from '../shared/utils/gamelogic/town'

const HOUR = 3_600_000
const STEP = HOUR / 4
const MAX_DAYS = 200
/** Roads eat tiles: reserve a quarter of every plot for them. */
const ROAD_SHARE = 0.25

interface World {
    now: number
    plots: number
    nextPlotAt: number
    buildings: TownSimBuilding[]
    inventory: TownResourceBag
    happiness: number
    tickProgressMs: number
    lastSettledAt: number
    nextId: number
    tierReached: Record<number, number>
    produced: TownResourceBag
}

function tilesAvailable(w: World) {
    return Math.floor(w.plots * TOWN_PLOT_SIZE * TOWN_PLOT_SIZE * (1 - ROAD_SHARE)) - w.buildings.length
}

function has(w: World, bag: TownResourceBag) {
    return Object.entries(bag).every(([id, q]) => (w.inventory[id as TownResourceId] ?? 0) >= (q ?? 0))
}

function spend(w: World, bag: TownResourceBag) {
    for (const [id, q] of Object.entries(bag)) w.inventory[id as TownResourceId] = (w.inventory[id as TownResourceId] ?? 0) - (q ?? 0)
}

function place(w: World, def: TownBuildingDef) {
    const cost = townLevelCost(def, 1)
    if (!has(w, cost.resources) || tilesAvailable(w) <= 0) return false
    spend(w, cost.resources)
    w.buildings.push({
        id: `b${w.nextId++}`,
        type: def.id,
        level: 0,
        completesAt: w.now + townLevelBuildMs(def, 1, w.happiness),
        upgradingTo: null,
        createdAt: w.now
    })
    if (w.tierReached[def.tier] === undefined) w.tierReached[def.tier] = w.now
    return true
}

function upgrade(w: World, b: TownSimBuilding) {
    const def = getTownBuilding(b.type)!
    if (b.level === 0 || b.upgradingTo !== null || b.level >= TOWN_MAX_BUILDING_LEVEL) return false
    const cost = townLevelCost(def, b.level + 1)
    if (!has(w, cost.resources)) return false
    spend(w, cost.resources)
    b.upgradingTo = b.level + 1
    b.completesAt = w.now + townLevelBuildMs(def, b.level + 1, w.happiness)
    return true
}

/** Resources the next tier's first building needs that we are short of. */
function shortfall(w: World, def: TownBuildingDef): TownResourceBag {
    const out: TownResourceBag = {}
    for (const [id, q] of Object.entries(townLevelCost(def, 1).resources)) {
        const missing = (q ?? 0) - (w.inventory[id as TownResourceId] ?? 0)
        if (missing > 0) out[id as TownResourceId] = missing
    }
    return out
}

function producerOf(resource: TownResourceId): TownBuildingDef | undefined {
    return TOWN_BUILDINGS.find(b => (b.outputs[resource] ?? 0) > 0)
}

function count(w: World, type: TownBuildingId) {
    return w.buildings.filter(b => b.type === type).length
}

function pop(w: World) {
    return deriveTown(w.buildings, w.happiness, w.now).popCap
}

function plan(w: World) {
    const derived = deriveTown(w.buildings, w.happiness, w.now)
    const tiers = [1, 2, 3, 4, 5, 6]
    const nextTier = tiers.find(t => w.tierReached[t] === undefined) ?? 6
    const target = TOWN_BUILDINGS.filter(b => b.tier === nextTier && b.kind === 'industry')[0]!

    // 1. Housing: enough residents for the jobs and for the next tier's gate.
    const popNeeded = Math.max(derived.workersDemanded + 8, TOWN_TIER_POP_REQUIREMENT[nextTier] ?? 0)
    if (pop(w) < popNeeded) {
        const houses = w.buildings.filter(b => b.type === 'house' && b.level > 0 && b.upgradingTo === null)
        const lowest = houses.sort((a, b) => a.level - b.level)[0]
        if (lowest && upgrade(w, lowest)) return
        if (place(w, getTownBuilding('house')!)) return
    }

    // 1b. Bootstrap: with no workers at all, only coins-only buildings can go up.
    if (pop(w) === 0) {
        place(w, getTownBuilding('house')!)
        return
    }

    // 2. Parks keep the mood up: one per four houses.
    if (count(w, 'park') * 4 < count(w, 'house')) place(w, getTownBuilding('park')!)

    // 3. Storage: a warehouse whenever something sits at the cap.
    const atCap = Object.values(w.inventory).some(v => (v ?? 0) >= derived.storageCap - 1)
    if (atCap && place(w, getTownBuilding('warehouse')!)) return

    // 4. Try to start the next tier. Once the gate is open, stop spending on
    //    anything but the goods the target needs — a real player saves up.
    const lock = townTierRequirement(w.buildings, nextTier, w.now, w.produced)
    if (!lock && place(w, target)) return
    const saving = !lock

    // 5. Chase the worst shortfall: for every good the target needs (walking the
    //    chain down to raw inputs), estimate hours-to-cover at the current net
    //    rate and grow the producer of the slowest one.
    const net = townNetPerTick(w.buildings, derived, w.now)
    const ticksPerHour = 60 * derived.speedMultiplier
    const demand = new Map<TownResourceId, number>()
    const addDemand = (id: TownResourceId, qty: number, depth: number) => {
        if (depth > 6) return
        demand.set(id, (demand.get(id) ?? 0) + qty)
        const producer = producerOf(id)
        if (!producer) return
        const out = producer.outputs[id] ?? 1
        for (const [inp, q] of Object.entries(producer.inputs) as [TownResourceId, number][]) addDemand(inp, qty * q / out, depth + 1)
    }
    for (const [id, q] of Object.entries(shortfall(w, target)) as [TownResourceId, number][]) addDemand(id, q, 0)
    if (demand.size === 0) {
        // Nothing missing but the tier is gated: raise the goods it wants, keep tiles free for it.
        if (lock && lock.produced < lock.producedRequired) {
            const gateGoods = TOWN_BUILDINGS.filter(b => b.kind === 'industry' && b.tier === lock.producedTier)
            for (const g of gateGoods) {
                const mine = w.buildings.filter(b => b.type === g.id)
                const up = mine.filter(b => b.level > 0 && b.upgradingTo === null && b.level < TOWN_MAX_BUILDING_LEVEL).sort((a, b) => a.level - b.level)[0]
                if (up && upgrade(w, up)) return
                if (mine.length < 6 && tilesAvailable(w) > 8 && place(w, g)) return
            }
        }
        return
    }
    const ranked = [...demand.entries()].map(([id, qty]) => {
        const rate = (net[id] ?? 0) * ticksPerHour
        const hours = rate <= 0 ? Infinity : qty / rate
        return { id, hours, rate }
    }).sort((a, b) => b.hours - a.hours)
    for (const { id } of ranked) {
        const producer = producerOf(id)
        if (!producer || townTierRequirement(w.buildings, producer.tier, w.now, w.produced)) continue
        const mine = w.buildings.filter(b => b.type === producer.id)
        const upgradable = mine.filter(b => b.level > 0 && b.upgradingTo === null && b.level < TOWN_MAX_BUILDING_LEVEL).sort((a, b) => a.level - b.level)[0]
        // Tiles are the scarce thing: upgrade once there are a handful.
        if (!saving && mine.length >= 3 && upgradable && upgrade(w, upgradable)) return
        if (mine.length < 3 && place(w, producer)) return
        if (!saving && upgradable && upgrade(w, upgradable)) return
        if (tilesAvailable(w) > 8 && place(w, producer)) return
    }
}

function run() {
    const w: World = {
        now: 0,
        plots: 1,
        nextPlotAt: townPlotCooldownMs(2),
        buildings: [],
        inventory: {},
        happiness: 50,
        tickProgressMs: 0,
        lastSettledAt: 0,
        nextId: 0,
        tierReached: { 0: 0 },
        produced: {}
    }
    while (w.now < MAX_DAYS * 24 * HOUR) {
        // Land as soon as the office opens.
        if (w.plots < TOWN_MAX_PLOTS && w.now >= w.nextPlotAt) {
            w.plots++
            w.nextPlotAt = w.now + townPlotCooldownMs(w.plots + 1)
        }
        // A few decisions per step.
        for (let i = 0; i < 6; i++) plan(w)
        // Bake finished builds before settling.
        for (const b of w.buildings) {
            if (b.completesAt <= w.now && (b.level === 0 || b.upgradingTo !== null)) {
                b.level = b.upgradingTo ?? 1
                b.upgradingTo = null
            }
        }
        const r = settleTown({ happiness: w.happiness, tickProgressMs: w.tickProgressMs, lastSettledAt: w.lastSettledAt, inventory: w.inventory, buildings: w.buildings }, w.now + STEP)
        for (const [id, d] of Object.entries(r.delta)) {
            w.inventory[id as TownResourceId] = (w.inventory[id as TownResourceId] ?? 0) + (d ?? 0)
            if ((d ?? 0) > 0) w.produced[id as TownResourceId] = (w.produced[id as TownResourceId] ?? 0) + (d ?? 0)
        }
        w.happiness = r.happiness
        w.tickProgressMs = r.tickProgressMs
        w.lastSettledAt = w.now + STEP
        w.now += STEP
        if (w.tierReached[6] !== undefined && isBuilt(w.buildings.find(b => b.type === 'emporium')!, w.now)) break
    }
    const day = (ms: number) => (ms / (24 * HOUR)).toFixed(1)
    console.log('tier  first building started (day)')
    for (const t of [1, 2, 3, 4, 5, 6]) console.log(`  ${t}    ${w.tierReached[t] === undefined ? '— not reached' : day(w.tierReached[t]!)}`)
    console.log(`plots: ${w.plots}  buildings: ${w.buildings.length}  pop: ${pop(w)}  happiness: ${w.happiness}  day ${day(w.now)}`)
    const byType: Record<string, number> = {}
    for (const b of w.buildings) byType[b.type] = (byType[b.type] ?? 0) + 1
    console.log('layout:', JSON.stringify(byType))
    const inv = Object.fromEntries(Object.entries(w.inventory).map(([k, v]) => [k, Math.round(v ?? 0)]))
    console.log('inventory:', JSON.stringify(inv))
    const nextTier = [1, 2, 3, 4, 5, 6].find(t => w.tierReached[t] === undefined)
    if (nextTier) {
        const target = TOWN_BUILDINGS.filter(b => b.tier === nextTier && b.kind === 'industry')[0]!
        console.log(`next: ${target.name} needs`, JSON.stringify(townLevelCost(target, 1).resources), 'lock', JSON.stringify(townTierRequirement(w.buildings, nextTier, w.now, w.produced)))
    }
}

// Payback in days at floor prices for the 1st, 2nd, 3rd and 5th copy of each
// industry building at level 1 (workers and inputs assumed available).
function roi() {
    console.log('\npayback days (copy 1 / 2 / 3 / 5):')
    for (const def of TOWN_BUILDINGS) {
        if (def.kind !== 'industry') continue
        let perTick = 0
        for (const [id, q] of Object.entries(def.outputs)) perTick += (q ?? 0) * townFloorPrice(id as TownResourceId)
        for (const [id, q] of Object.entries(def.inputs)) perTick -= (q ?? 0) * townFloorPrice(id as TownResourceId)
        const perDay = perTick * 1440
        const days = [0, 1, 2, 4].map(n => (townPlaceCost(def, n).coins / perDay).toFixed(1)).join(' / ')
        console.log(`  ${def.name.padEnd(12)} ${formatCoins(townPlaceCost(def, 0).coins).padStart(8)}  ${days}`)
    }
}
function formatCoins(n: number) { return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n) }

run()
roi()
