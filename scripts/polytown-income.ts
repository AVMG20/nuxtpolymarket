// Polytown against XENO and COLONY at equal days played.
//
// The property this protects: a player who has put the same number of days
// into any of the three idle games should be earning the same order of money.
// Polytown is allowed to pay MORE than the other two, because it also costs
// far more to invest in — coins spent on buildings and levels come back out of
// the site economy — but "more" has to mean a couple of times, not a hundred.
//
// Polytown has no tier ladder to key on, so the day axis comes from a crew
// scheduler: a queue of build and upgrade jobs worked by N builders, gated on
// the tier requirements the real game enforces. Income at any day is what the
// buildings standing at that day are worth per hour at floor prices.
//
// Run: bun scripts/polytown-income.ts

import {
    TOWN_BUILDINGS,
    TOWN_RESOURCES,
    TOWN_TICK_MS,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_TIER_PRODUCTION_REQUIREMENT,
    townBuildingMaxLevel,
    townFloorPrice,
    townLevelBuildMs,
    type TownBuildingDef,
    type TownResourceBag,
    type TownResourceId
} from '../shared/utils/gamelogic/town'
import { colonyIncomeAtDay, xenoStage, xenoGlobalLevelAt } from './lib/economy-stages'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TICKS_PER_HOUR = HOUR / TOWN_TICK_MS

/** The town a serious player builds, and how many of each. */
const PLAN: { type: string, copies: number }[] = [
    { type: 'house', copies: 40 },
    { type: 'park', copies: 5 },
    { type: 'bathhouse', copies: 2 },
    { type: 'theatre', copies: 1 },
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

function bagValue(bag: TownResourceBag): number {
    let total = 0
    for (const [id, qty] of Object.entries(bag) as [TownResourceId, number][]) total += townFloorPrice(id) * qty
    return total
}

/** Coins an hour of this building at `level` is worth: outputs at floor, minus inputs. */
function marginPerHour(def: TownBuildingDef, level: number): number {
    return (bagValue(def.outputs) - bagValue(def.inputs)) * level * TICKS_PER_HOUR
}

/** Units of tier-`tier` goods this building makes per hour at `level`. */
function tierOutputPerHour(def: TownBuildingDef, tier: number, level: number): number {
    let units = 0
    for (const [id, qty] of Object.entries(def.outputs) as [TownResourceId, number][]) {
        if (RESOURCE_TIER.get(id) === tier) units += (qty ?? 0) * level * TICKS_PER_HOUR
    }
    return units
}

const RESOURCE_TIER = new Map<TownResourceId, number>(TOWN_RESOURCES.map(r => [r.id, r.tier]))

interface Standing {
    def: TownBuildingDef
    /** Level it is producing at. A building keeps working while it grows. */
    level: number
    upgrading: boolean
}

/**
 * Walk the town forward an hour at a time with `crews` builders. Each idle
 * crew takes the next job: the plan's next copy of a building whose tier is
 * open, otherwise raising the lowest-level building it can. Lifetime
 * production is tracked so the tier gates open the way they do in the game.
 */
function simulate(crews: number, maxDays = 200) {
    const standing: Standing[] = []
    const jobs: { until: number, apply: () => void }[] = []
    const produced = new Map<number, number>()
    const openTiers = new Set([0, 1])
    const built = new Map<string, number>()
    const income: { day: number, coinsPerHour: number, buildings: number }[] = []

    const popCap = () => standing.reduce((n, s) => n + s.def.popCap * s.level, 0)

    function pickJob(now: number) {
        // 0. Housing on demand. A player does not put up forty houses and then
        //    start on the farms; they add homes when the jobs go unstaffed, or
        //    when the next tier wants more residents. Building the plan in
        //    order instead would show the first month earning almost nothing,
        //    which is an artefact of the queue and not of the game.
        const houseDef = TOWN_BUILDINGS.find(b => b.id === 'house')!
        const houses = standing.filter(s => s.def.id === 'house')
        const jobsNeeded = standing.reduce((n, s) => n + s.def.workers * s.level, 0)
        const nextTier = [2, 3, 4, 5, 6].find(t => !openTiers.has(t)) ?? 6
        const wanted = Math.max(jobsNeeded + 4, TOWN_TIER_POP_REQUIREMENT[nextTier] ?? 0)
        if (popCap() < wanted && houses.length < (PLAN.find(p => p.type === 'house')?.copies ?? 0)) {
            const lowest = houses.filter(h => !h.upgrading && h.level < townBuildingMaxLevel(h.def)).sort((a, b) => a.level - b.level)[0]
            // Extend a small house before laying a new footprint: tiles are finite.
            if (lowest && lowest.level < 5) {
                lowest.upgrading = true
                const target = lowest.level + 1
                return { until: now + townLevelBuildMs(houseDef, target), apply: () => { lowest.level = target; lowest.upgrading = false } }
            }
            built.set('house', houses.length + 1)
            return { until: now + townLevelBuildMs(houseDef, 1), apply: () => standing.push({ def: houseDef, level: 1, upgrading: false }) }
        }

        // 1. The plan's next copy of anything whose tier is open.
        for (const { type, copies } of PLAN) {
            if (type === 'house') continue
            const def = TOWN_BUILDINGS.find(b => b.id === type)!
            if (!openTiers.has(def.tier)) continue
            const have = built.get(type) ?? 0
            if (have >= copies) continue
            built.set(type, have + 1)
            return {
                until: now + townLevelBuildMs(def, 1),
                apply: () => standing.push({ def, level: 1, upgrading: false })
            }
        }
        // 2. Otherwise raise the lowest building that can still grow. Levelling
        //    evenly beats rushing one building, because workers and supply are
        //    shared and the tier gates count total output.
        const growable = standing
            .filter(s => !s.upgrading && s.level < townBuildingMaxLevel(s.def))
            .sort((a, b) => a.level - b.level || b.def.tier - a.def.tier)[0]
        if (!growable) return null
        growable.upgrading = true
        const target = growable.level + 1
        return {
            until: now + townLevelBuildMs(growable.def, target),
            apply: () => { growable.level = target; growable.upgrading = false }
        }
    }

    for (let hour = 0; hour <= maxDays * 24; hour++) {
        const now = hour * HOUR

        for (let i = jobs.length - 1; i >= 0; i--) {
            if (jobs[i]!.until <= now) { jobs[i]!.apply(); jobs.splice(i, 1) }
        }

        for (const s of standing) {
            for (const tier of [1, 2, 3, 4, 5]) {
                const made = tierOutputPerHour(s.def, tier, s.level)
                if (made > 0) produced.set(tier, (produced.get(tier) ?? 0) + made)
            }
        }

        for (const tier of [2, 3, 4, 5, 6]) {
            if (openTiers.has(tier) || !openTiers.has(tier - 1)) continue
            const gate = TOWN_TIER_PRODUCTION_REQUIREMENT[tier]
            const madeEnough = !gate || (produced.get(gate.tier) ?? 0) >= gate.amount
            const hasBuilding = standing.some(s => s.def.tier === tier - 1)
            if (madeEnough && hasBuilding && popCap() >= (TOWN_TIER_POP_REQUIREMENT[tier] ?? 0)) openTiers.add(tier)
        }

        while (jobs.length < crews) {
            const next = pickJob(now)
            if (!next) break
            jobs.push(next)
        }

        if (hour % 24 === 0) {
            income.push({
                day: hour / 24,
                coinsPerHour: standing.reduce((n, s) => n + Math.max(0, marginPerHour(s.def, s.level)), 0),
                buildings: standing.length
            })
        }
    }
    const byType = new Map<string, { n: number, levels: number[] }>()
    for (const st of standing) {
        const e = byType.get(st.def.id) ?? { n: 0, levels: [] }
        e.n++
        e.levels.push(st.level)
        byType.set(st.def.id, e)
    }
    return { income, openTiers: [...openTiers], byType }
}

function fmt(n: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

function pad(s: string, n: number) { return s.length >= n ? s : s + ' '.repeat(n - s.length) }
function padL(s: string, n: number) { return s.length >= n ? s : ' '.repeat(n - s.length) + s }

const RESEARCH_LEVEL = 4
const xenoAt = (days: number) => {
    // Xeno's own comparison uses plausible global upgrade levels per tier.
    let best = 0
    for (const tier of [3, 4, 5, 6, 7, 8, 9]) {
        const stage = xenoStage(tier, xenoGlobalLevelAt(tier))
        if (stage.days <= days) best = stage.coinsPerHour
    }
    return best
}

for (const crews of [3, 6]) {
    const { income, openTiers, byType } = simulate(crews)
    const at = (day: number) => income.find(p => p.day === day)?.coinsPerHour ?? 0
    console.log(`\n=== Polytown with ${crews} builders ===\n`)
    console.log(pad('day', 6) + padL('polytown/h', 12) + padL('colony/h', 11) + padL('xeno/h', 11) + padL('vs colony', 11) + padL('vs xeno', 10))
    for (const day of [1, 3, 7, 14, 30, 45, 60, 90, 120, 150, 200]) {
        const town = at(day)
        const colony = colonyIncomeAtDay(day, RESEARCH_LEVEL)
        const xeno = xenoAt(day)
        console.log(
            pad(String(day), 6)
            + padL(fmt(town), 12)
            + padL(fmt(colony), 11)
            + padL(xeno ? fmt(xeno) : '—', 11)
            + padL(`${(town / colony).toFixed(1)}x`, 11)
            + padL(xeno ? `${(town / xeno).toFixed(1)}x` : '—', 10)
        )
    }
    console.log(`\nafter 200 days: tiers ${openTiers.join(',')}`)
    for (const [type, e] of byType) console.log(`  ${pad(type, 11)} x${e.n} levels ${e.levels.join('/')}`)
}
console.log('')
