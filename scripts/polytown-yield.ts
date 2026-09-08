// Polytown yield + time-to-max report. Pure arithmetic on the game's own
// tables — no simulated planner — so the numbers here are exactly what the
// rules produce. Answers three questions:
//
//   1. What is one building of each tier worth per day, at level 1 and 20?
//   2. How long does one building of each tier take to reach level 20?
//   3. What does maxing a whole town cost, in coins and in real time?
//
// Run: bun scripts/polytown-yield.ts

import {
    TOWN_BUILDINGS,
    TOWN_MAX_BUILDING_LEVEL,
    townBuildingMaxLevel,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_TIER_PRODUCTION_REQUIREMENT,
    TOWN_TICK_MS,
    townLevelCost,
    townLevelBuildMs,
    townFloorPrice,
    type TownBuildingDef,
    type TownResourceBag,
    type TownResourceId
} from '../shared/utils/gamelogic/town'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TICKS_PER_DAY = DAY / TOWN_TICK_MS

const industry = TOWN_BUILDINGS.filter(b => b.kind === 'industry')

function bagValue(bag: TownResourceBag): number {
    let total = 0
    for (const [id, qty] of Object.entries(bag) as [TownResourceId, number][]) total += townFloorPrice(id) * qty
    return total
}

/** Coins per day of margin: outputs sold at floor, inputs bought back at floor. */
function marginPerDay(def: TownBuildingDef, level: number): number {
    const out = bagValue(def.outputs) * level
    const inp = bagValue(def.inputs) * level
    return (out - inp) * TICKS_PER_DAY
}

/** Gross coins per day if the outputs are floor-sold and inputs come free. */
function grossPerDay(def: TownBuildingDef, level: number): number {
    return bagValue(def.outputs) * level * TICKS_PER_DAY
}

function totalCost(def: TownBuildingDef, toLevel: number) {
    let coins = 0
    const resources: TownResourceBag = {}
    for (let l = 1; l <= toLevel; l++) {
        const c = townLevelCost(def, l)
        coins += c.coins
        for (const [id, q] of Object.entries(c.resources) as [TownResourceId, number][]) {
            resources[id] = (resources[id] ?? 0) + q
        }
    }
    return { coins, resources }
}

function timeToLevel(def: TownBuildingDef, toLevel: number): number {
    let ms = 0
    for (let l = 1; l <= toLevel; l++) ms += townLevelBuildMs(def, l)
    return ms
}

function fmt(n: number): string {
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`
    return `${Math.round(n)}`
}

function days(ms: number): string {
    return ms >= DAY ? `${(ms / DAY).toFixed(1)}d` : `${(ms / HOUR).toFixed(1)}h`
}

function pad(s: string, n: number): string {
    return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function padL(s: string, n: number): string {
    return s.length >= n ? s : ' '.repeat(n - s.length) + s
}

console.log('\n=== One building: what it earns and what it takes ===\n')
console.log(pad('building', 12) + padL('tier', 5) + padL('L1/day', 10) + padL('L20/day', 11)
    + padL('L1 cost', 10) + padL('max cost', 11) + padL('L2 time', 9) + padL('L20 time', 10) + padL('to max', 9) + padL('payback', 9))
for (const def of industry) {
    const l1 = totalCost(def, 1)
    const max = totalCost(def, townBuildingMaxLevel(def))
    const l1Value = l1.coins + bagValue(l1.resources)
    const payback = l1Value / Math.max(1, marginPerDay(def, 1))
    console.log(
        pad(def.name, 12)
        + padL(String(def.tier), 5)
        + padL(fmt(marginPerDay(def, 1)), 10)
        + padL(fmt(marginPerDay(def, townBuildingMaxLevel(def))), 11)
        + padL(fmt(l1Value), 10)
        + padL(fmt(max.coins + bagValue(max.resources)), 11)
        + padL(days(townLevelBuildMs(def, 2)), 9)
        + padL(days(townLevelBuildMs(def, townBuildingMaxLevel(def))), 10)
        + padL(days(timeToLevel(def, townBuildingMaxLevel(def))), 9)
        + padL(`${payback.toFixed(1)}d`, 9)
    )
}

console.log('\n=== Per tier: gross value a maxed building moves per day ===\n')
console.log(pad('tier', 6) + padL('buildings', 11) + padL('gross/day', 12) + padL('margin/day', 12) + padL('slowest to max', 16))
for (const tier of [1, 2, 3, 4, 5, 6]) {
    const defs = industry.filter(b => b.tier === tier)
    if (defs.length === 0) continue
    const gross = defs.reduce((s, d) => s + grossPerDay(d, townBuildingMaxLevel(d)), 0)
    const margin = defs.reduce((s, d) => s + marginPerDay(d, townBuildingMaxLevel(d)), 0)
    const slowest = Math.max(...defs.map(d => timeToLevel(d, townBuildingMaxLevel(d))))
    console.log(
        pad(`T${tier}`, 6)
        + padL(defs.map(d => d.name).join(', '), 11)
        + padL(fmt(gross), 12)
        + padL(fmt(margin), 12)
        + padL(days(slowest), 16)
    )
}

console.log('\n=== Maxing everything: one of each building ===\n')
let coins = 0
let ms = 0
let slowestChain = 0
const bandTotals: TownResourceBag = {}
for (const def of TOWN_BUILDINGS) {
    if (def.kind === 'road') continue
    const c = totalCost(def, townBuildingMaxLevel(def))
    coins += c.coins
    for (const [id, q] of Object.entries(c.resources) as [TownResourceId, number][]) bandTotals[id] = (bandTotals[id] ?? 0) + q
    const t = timeToLevel(def, townBuildingMaxLevel(def))
    ms += t
    slowestChain = Math.max(slowestChain, t)
}
console.log(`coins            ${fmt(coins)}`)
console.log(`goods (at floor) ${fmt(bagValue(bandTotals))}`)
console.log(`total            ${fmt(coins + bagValue(bandTotals))}`)
console.log(`serial build time ${days(ms)} · longest single building ${days(slowestChain)}`)
console.log('\ngoods needed:')
for (const [id, q] of Object.entries(bandTotals).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [TownResourceId, number][]) {
    console.log(`  ${pad(id, 10)} ${padL(fmt(q), 8)}`)
}
console.log('')

console.log('=== Tier gates: how long the production wall takes to clear ===\n')
console.log(pad('tier', 6) + padL('pop', 7) + padL('needs', 22) + padL('@4 x L5', 10) + padL('@4 x L10', 11) + padL('@4 x L20', 11))
for (const tier of [2, 3, 4, 5, 6]) {
    const gate = TOWN_TIER_PRODUCTION_REQUIREMENT[tier]
    if (!gate) continue
    const makers = industry.filter(b => b.tier === gate.tier)
    // Units of the gating tier's goods four buildings of each kind make per day.
    const perDay = (level: number) => makers.reduce((s, d) => {
        const out = Object.entries(d.outputs).reduce((n, [, q]) => n + (q ?? 0), 0)
        return s + out * level * 4 * TICKS_PER_DAY
    }, 0)
    const at = (level: number) => `${(gate.amount / perDay(level)).toFixed(1)}d`
    console.log(
        pad(`T${tier}`, 6)
        + padL(String(TOWN_TIER_POP_REQUIREMENT[tier] ?? 0), 7)
        + padL(`${fmt(gate.amount)} of T${gate.tier}`, 22)
        + padL(at(5), 10)
        + padL(at(10), 11)
        + padL(at(20), 11)
    )
}
console.log('')

console.log('=== With build crews: how long a full town takes ===\n')
// Levels a serious town actually wants: a few copies of the tier's buildings
// at 20, plus the housing and civic buildings that keep them staffed.
const TOWN_PLAN: { type: string, copies: number }[] = [
    { type: 'house', copies: 40 },
    { type: 'park', copies: 5 },
    { type: 'warehouse', copies: 3 },
    { type: 'farm', copies: 4 },
    { type: 'lumber', copies: 4 },
    { type: 'quarry', copies: 3 },
    { type: 'mill', copies: 3 },
    { type: 'sawmill', copies: 3 },
    { type: 'kiln', copies: 3 },
    { type: 'bakery', copies: 3 },
    { type: 'smithy', copies: 3 },
    { type: 'mine', copies: 2 },
    { type: 'foundry', copies: 2 },
    { type: 'factory', copies: 2 },
    { type: 'emporium', copies: 2 }
]
function planAt(level: number) {
    let ms = 0
    let planCoins = 0
    const planGoods: TownResourceBag = {}
    for (const { type, copies } of TOWN_PLAN) {
        const def = TOWN_BUILDINGS.find(b => b.id === type)!
        const cap = Math.min(level, townBuildingMaxLevel(def))
        ms += timeToLevel(def, cap) * copies
        const c = totalCost(def, cap)
        planCoins += c.coins * copies
        for (const [id, q] of Object.entries(c.resources) as [TownResourceId, number][]) planGoods[id] = (planGoods[id] ?? 0) + q * copies
    }
    return { ms, coins: planCoins, goods: bagValue(planGoods) }
}

console.log(`plan: ${TOWN_PLAN.reduce((s, p) => s + p.copies, 0)} buildings\n`)
console.log(pad('level', 7) + padL('coins', 10) + padL('goods', 10) + padL('crew-days', 11)
    + padL('3 crews', 9) + padL('4 crews', 9) + padL('5 crews', 9) + padL('6 crews', 9))
for (const level of [14, 16, 18, 20]) {
    const p = planAt(level)
    const d = p.ms / DAY
    console.log(
        pad(`L${level}`, 7)
        + padL(fmt(p.coins), 10)
        + padL(fmt(p.goods), 10)
        + padL(d.toFixed(0), 11)
        + padL(`${(d / 3).toFixed(0)}d`, 9)
        + padL(`${(d / 4).toFixed(0)}d`, 9)
        + padL(`${(d / 5).toFixed(0)}d`, 9)
        + padL(`${(d / 6).toFixed(0)}d`, 9)
    )
}
console.log('')

console.log('=== Where the coins actually go (the 61-building plan at L20) ===\n')
console.log(pad('building', 12) + padL('copies', 8) + padL('L1 coins', 11) + padL('to L20 each', 13) + padL('plan total', 12) + padL('share', 8))
const planRows = TOWN_PLAN.map(({ type, copies }) => {
    const def = TOWN_BUILDINGS.find(b => b.id === type)!
    const each = totalCost(def, townBuildingMaxLevel(def)).coins
    return { def, copies, each, total: each * copies }
}).sort((a, b) => b.total - a.total)
const planSum = planRows.reduce((s, r) => s + r.total, 0)
for (const r of planRows) {
    console.log(
        pad(r.def.name, 12)
        + padL(String(r.copies), 8)
        + padL(fmt(r.def.cost.coins), 11)
        + padL(fmt(r.each), 13)
        + padL(fmt(r.total), 12)
        + padL(`${(100 * r.total / planSum).toFixed(1)}%`, 8)
    )
}
console.log(`\ntotal ${fmt(planSum)}`)

// What that town earns once it stands, so the bill can be read as days of income.
let planGross = 0
let planMargin = 0
for (const { type, copies } of TOWN_PLAN) {
    const def = TOWN_BUILDINGS.find(b => b.id === type)!
    if (def.kind !== 'industry') continue
    planGross += grossPerDay(def, townBuildingMaxLevel(def)) * copies
    planMargin += marginPerDay(def, townBuildingMaxLevel(def)) * copies
}
console.log(`maxed town earns ${fmt(planGross)}/day gross, ${fmt(planMargin)}/day margin`)
console.log(`the whole coin bill is ${(planSum / planMargin).toFixed(0)} days of that town's own margin\n`)
