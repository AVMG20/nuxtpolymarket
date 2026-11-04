/**
 * Industries: primary production every production cycle, secondary conversion of delivered
 * cargo, and moving the output to nearby stations. Behaviour mimics the original game: a primary adds
 * its fixed rate every cycle (the original has no per-cycle random variation), output waits at the
 * industry and moves to the stations around its footprint at most 255 units per footprint tile and
 * cycle, and cargo with no station to take it is lost. Industry opening, closing and production
 * changes are out of scope. Integers only; the code is written from scratch.
 */

import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from './catalog'
import { distributeProduction } from './cargo'
import type { RtMap } from './map'
import type { SeededRandom } from '../random'
import type { RtStationWorld } from './stations'
import type { RtIndustry } from './types'

const RULES = RT_CATALOG.industryRules
const CARGOS = RT_CATALOG.cargos

/** Most units one footprint tile moves to stations per cycle (a u8 in the original). */
const MOVE_PER_TILE = 255

function specOf(industry: RtIndustry) {
    const id = RT_INDUSTRY_TYPE_IDS[industry.type]
    return id ? RT_CATALOG.industries[id] : undefined
}

/** The industry's footprint tiles, ascending (north corner origin, catalog width and height). */
export function rtIndustryTiles(map: RtMap, industry: RtIndustry): number[] {
    const spec = specOf(industry)
    if (!spec || !map.validTile(industry.origin)) return []
    const x0 = map.tileX(industry.origin)
    const y0 = map.tileY(industry.origin)
    const tiles: number[] = []
    for (let y = y0; y < y0 + spec.height && y < map.side; y++) {
        for (let x = x0; x < x0 + spec.width && x < map.side; x++) tiles.push(map.idx(x, y))
    }
    return tiles
}

/** Whether the industry accepts the cargo (by cargo index). */
export function rtIndustryAccepts(industry: RtIndustry, cargo: number): boolean {
    const spec = specOf(industry)
    if (!spec) return false
    for (const id of spec.accepts) if (CARGOS[id].index === cargo) return true
    return false
}

/** Cargo indices the industry puts out: its primary production and its conversion outputs. */
export function rtIndustryOutputs(industry: RtIndustry): number[] {
    const spec = specOf(industry)
    if (!spec) return []
    const out = new Set<number>()
    for (const p of spec.produces) out.add(CARGOS[p.cargo].index)
    for (const c of spec.converts) out.add(CARGOS[c.to].index)
    return [...out].sort((a, b) => a - b)
}

/**
 * Cargo delivered to the industry by a vehicle unloading at a station that accepts it.
 * Input that a conversion uses waits in `delivered` (saturating at maxWaiting) until the next cycle;
 * input that is only consumed (a power station's coal) is gone. Returns the units accepted: the
 * amount, or 0 when the industry does not accept the cargo.
 */
export function acceptDelivery(industry: RtIndustry, cargo: number, amount: number): number {
    const units = Math.max(0, Math.floor(amount))
    if (units === 0 || !rtIndustryAccepts(industry, cargo)) return 0
    const spec = specOf(industry)!
    if (spec.converts.some(c => CARGOS[c.from].index === cargo)) {
        industry.delivered[cargo] = Math.min(RULES.maxWaiting, (industry.delivered[cargo] ?? 0) + units)
    }
    return units
}

/** Whether this tick is the industry's production cycle, phased by id. */
export function rtIndustryCycleDue(industry: RtIndustry, tick: number): boolean {
    return (tick + industry.id) % RT_CATALOG.time.industryCycleTicks === 0
}

/**
 * One tick of an industry; RtWorld.step calls it every tick for each industry in ascending id. On its
 * production cycle a primary adds each catalog rate to its waiting output, a secondary converts all
 * delivered input (input * multiplier >> inputShift) into waiting output, and then every output cargo
 * moves to the stations around the footprint through distributeProduction, at most 255 units per
 * footprint tile: what moves counts as transported, the rest of that share is lost, and what exceeds
 * the per-cycle move waits. `rng` is passed through for the signature; production draws nothing.
 */
export function industryTick(world: RtStationWorld, industry: RtIndustry, rng: SeededRandom, tick: number): void {
    if (!rtIndustryCycleDue(industry, tick)) return
    const spec = specOf(industry)
    if (!spec) return
    for (const p of spec.produces) {
        const cargo = CARGOS[p.cargo].index
        industry.waiting[cargo] = Math.min(RULES.maxWaiting, (industry.waiting[cargo] ?? 0) + p.rate)
    }
    for (const c of spec.converts) {
        const from = CARGOS[c.from].index
        const to = CARGOS[c.to].index
        const input = industry.delivered[from] ?? 0
        if (input === 0) continue
        industry.delivered[from] = 0
        const output = Math.floor(input * c.multiplier / (1 << RULES.inputShift))
        industry.waiting[to] = Math.min(RULES.maxWaiting, (industry.waiting[to] ?? 0) + output)
    }
    const tiles = rtIndustryTiles(world.map, industry)
    for (const cargo of rtIndustryOutputs(industry)) {
        for (let k = 0; k < tiles.length; k++) {
            const chunk = Math.min(MOVE_PER_TILE, industry.waiting[cargo] ?? 0)
            if (chunk === 0) break
            industry.waiting[cargo] = industry.waiting[cargo]! - chunk
            industry.producedThisMonth[cargo] = (industry.producedThisMonth[cargo] ?? 0) + chunk
            industry.transportedThisMonth[cargo] = (industry.transportedThisMonth[cargo] ?? 0)
                + distributeProduction(world, tiles, cargo, chunk, rng)
        }
    }
}
