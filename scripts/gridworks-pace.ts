// Gridworks pace: how long a player takes to reach the endgame, the point a
// prestige would hang off. "Endgame" = every research done (tiers 1-5) and a
// fusion reactor putting Fusion Cores into storage.
//
// The property this protects: a typical player (two sessions a day) gets there
// in about 2-3 weeks, a casual one in 4-6 weeks, an engaged one in 8-12 days.
// The first hour stays snappy (tier 2 opens in the first session or two) and
// no single research is a multi-day wall.
//
// Run: bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/gridworks-pace.ts [maps] [profile]
// Tuning what-if: GW_SCALE=1,1,2,3,4 multiplies the research costs of tiers 1-5.
// Re-run after touching research costs, TIER_GATE, rates, Mk multipliers,
// storage caps, chunk costs or the ore map.
//
// HOW IT MODELS THE GAME
// The sim does not place tiles. It keeps counts (miners per ore, machines per
// kind with their Mk, labs, storages, chunks) and derives throughput from the
// real data in defs.ts. A check at the top runs the real flow solver on three
// small layouts so the rates the model leans on can't drift unnoticed.
//
// Taken from the real code:
//  - recipes, machine and source rates, MACHINE_MK, BELT_MK, LAB_RATE (a lab
//    swallows 0.5 items/s, so research speed is capped by the lab count)
//  - research costs and tier gates (tierOpen/researchAvailable), unlocks, maxMk
//  - building, upgrade and chunk costs, START_STOCK, goal rewards
//  - the real ore map per seed: ore tiles per chunk, chunks bought adjacent to
//    owned land, walking towards the nearest oil/crystal when needed
//  - storage: (1 + storages + 4 x silos) x STORAGE_CAP[storageLevel]. The cap
//    stops belts and hand mining; goal rewards arrive in full. Nothing leaves
//    storage except to pay for things: research is fed by belts into labs,
//    never from stock
//  - one research at a time until Auto-queue; an idle queue wastes the labs
//  - offline = the same steady rates times elapsed time, stock clipped at the cap
//
// Assumptions (the abstraction):
//  - Production is a rate plan. The research's items get up to `labShare` of
//    every ore and machine capacity, the rest fills storage with building
//    materials (weighted towards what the next purchase lacks).
//  - Only `tileUse` of the ore tiles on owned land carry a miner (the rest is
//    interior, belts or awkward), and a patch drains through `lanes` belts,
//    each limited by the belt Mk in use.
//  - Every building takes land: its footprint plus 3 tiles of belt, at most
//    85% of the owned tiles. Running out means buying a chunk.
//  - A session has a build budget (`buildsPerMin`); bigger machines cost more
//    of it, upgrades much less. The planner is greedy: relieve whatever limits
//    the current research (lab, ore, machine, belt), else save up for it.
//  - The plan is frozen when the session ends. With Auto-queue the next
//    research runs offline at `autoEff` of its rate, since the lines were laid
//    out for the previous one.
//  - Hand mining yields MINE_REFILL ore/s for `handFrac` of a session, into
//    storage only, for raw ore the next purchase lacks.
//  - Goals are judged on counts ("has a press") rather than solved flows.
//  - Amplifiers only boost miners, `ampTouch` per amplifier, once ore tiles and
//    upgrades run out.
import {
    AMP_BONUS, BELT_MK, BUILDINGS, CHUNK, ITEM_IDS, KINDS, LAB_RATE, MACHINE_MK, MAP_CHUNKS, RECIPES, RESEARCH, RESEARCH_BY_ID,
    SILO_MULT, START_CHUNKS, START_STOCK, STORAGE_CAP,
    chunkCost, isUnlocked, maxMk, researchAvailable, storageLevel, tierOpen, upgradeCost,
    type ItemId, type Kind, type OreId, type Stock
} from '#shared/utils/gridworks/defs'
import { solve } from '#shared/utils/gridworks/flow'
import { MINE_REFILL, QUEUE_MAX_AUTO } from '#shared/utils/gridworks/game'
import { GOALS } from '#shared/utils/gridworks/goals'
import type { Entity } from '#shared/utils/gridworks/layout'
import { ORE_ORDER, chunkNeighbours, oreAt, oreMap } from '#shared/utils/gridworks/world'

const HOUR = 3600
const DAY = 86400
const MAX_DAYS = 150
/** Share of owned tiles that can hold buildings and their belts. */
const LAND_USE = 0.85
/** Belt tiles a building needs around it. */
const BELT_TILES = 3
/** A purchase that is further away than this gets its own production line. */
const WAIT_TOLERANCE = 20 * 60

interface Profile {
    name: string
    /** Hours into the day at which each session starts. */
    sessions: number[]
    minutes: number
    /** Build budget per minute; a 1x1 machine with its belts costs about 0.7. */
    buildsPerMin: number
    tileUse: number
    lanes: number
    handFrac: number
    ampTouch: number
    labShare: number
    autoEff: number
    /** Tiers ahead of the open one that the player buys land for (oil is tier 4, crystal tier 5). */
    lookAhead: number
}

const PROFILES: Profile[] = [
    { name: 'casual', sessions: [0], minutes: 12, buildsPerMin: 0.4, tileUse: 0.4, lanes: 2, handFrac: 0.15, ampTouch: 0, labShare: 0.7, autoEff: 0.4, lookAhead: 0 },
    { name: 'typical', sessions: [0, 12], minutes: 25, buildsPerMin: 0.6, tileUse: 0.5, lanes: 3, handFrac: 0.2, ampTouch: 1, labShare: 0.7, autoEff: 0.5, lookAhead: 0 },
    { name: 'engaged', sessions: [0, 3, 6, 10, 14], minutes: 30, buildsPerMin: 1, tileUse: 0.65, lanes: 4, handFrac: 0.25, ampTouch: 2, labShare: 0.7, autoEff: 0.7, lookAhead: 1 }
]

// ---- static tables derived from defs ---------------------------------------------

const ORES = ORE_ORDER
const isOre = (id: string): id is OreId => (ORES as string[]).includes(id)
const SOURCE_OF = Object.fromEntries(ORES.map(o => [o, KINDS.find(k => BUILDINGS[k].ore?.includes(o))!])) as Record<OreId, Kind>
const MACHINE_KINDS = KINDS.filter(k => BUILDINGS[k].role === 'machine')
const MACHINE_OF = Object.fromEntries(Object.keys(RECIPES).map(id => [id, MACHINE_KINDS.find(k => BUILDINGS[k].recipes?.includes(id))!])) as Record<string, Kind>

type Req = Record<string, number>
const entries = (s: Stock) => Object.entries(s) as [ItemId, number][]

/** Ore and machine capacity that one item per second takes ('ore:<id>' / 'mach:<kind>'). */
const REQ = {} as Record<ItemId, Req>
function reqOf(item: ItemId): Req {
    if (REQ[item]) return REQ[item]
    if (isOre(item)) return REQ[item] = { [`ore:${item}`]: 1 }
    const r = RECIPES[item]!
    const out: Req = { [`mach:${MACHINE_OF[r.id]}`]: r.time / r.outQty }
    for (const [k, v] of entries(r.inputs)) {
        for (const [res, q] of Object.entries(reqOf(k))) out[res] = (out[res] ?? 0) + q * v / r.outQty
    }
    return REQ[item] = out
}
/** Raw ore behind one item. */
const oreEq = (item: ItemId) => Object.entries(reqOf(item)).reduce((a, [res, q]) => a + (res.startsWith('ore:') ? q : 0), 0)
const oreEqOf = (s: Stock) => entries(s).reduce((a, [k, v]) => a + oreEq(k) * v, 0)

/** Items that pay for buildings, upgrades and land: what storage is for. */
const BUILD_ITEMS = (() => {
    const set = new Set<ItemId>()
    const add = (s: Stock) => entries(s).forEach(([k]) => set.add(k))
    for (const k of KINDS) {
        add(BUILDINGS[k].cost)
        for (let mk = 2; mk <= 5; mk++) add(upgradeCost(k, mk))
    }
    add(chunkCost(5))
    return [...set]
})()

const made = { n: -1, items: new Set<ItemId>() }
function producible(item: ItemId, done: readonly string[]): boolean {
    if (made.n !== done.length) {
        made.n = done.length
        made.items = new Set(ITEM_IDS.filter(k => (k !== 'chip' || done.includes('electronics')) && Object.keys(reqOf(k)).every((res) => {
            const [type, id] = res.split(':') as [string, string]
            return isUnlocked(type === 'ore' ? SOURCE_OF[id as OreId] : id as Kind, done)
        })))
    }
    return made.items.has(item)
}

/** How much a player wants a research, beyond how fast it is. */
function weight(id: string): number {
    if (KINDS.some(k => BUILDINGS[k].unlock === id && BUILDINGS[k].category === 'production') || id === 'electronics') return 4
    if (id === 'auto-queue' || id === 'land-1') return 3
    if (id.startsWith('machine-mk') || id.startsWith('belt-mk') || id === 'splitter' || id === 'merger') return 2
    return 1
}

// ---- world ---------------------------------------------------------------------------

interface World { chunkOre: Map<string, Record<OreId, number>> }
function worldOf(seed: number): World {
    const map = oreMap(seed)
    const chunkOre = new Map<string, Record<OreId, number>>()
    for (let cy = 0; cy < MAP_CHUNKS; cy++) {
        for (let cx = 0; cx < MAP_CHUNKS; cx++) {
            const count = Object.fromEntries(ORES.map(o => [o, 0])) as Record<OreId, number>
            for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
                for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
                    const o = oreAt(map, x, y)
                    if (o) count[o]++
                }
            }
            chunkOre.set(`${cx},${cy}`, count)
        }
    }
    return { chunkOre }
}

// ---- state ---------------------------------------------------------------------------

interface Sim {
    p: Profile
    w: World
    t: number
    done: string[]
    queue: string[]
    progress: Record<string, Stock>
    stock: Stock
    chunks: string[]
    land: { chunks: number, tiles: Partial<Record<OreId, number>>, patches: Partial<Record<OreId, number>> }
    /** Mk of every source, per ore. */
    src: Record<OreId, number[]>
    amps: Record<OreId, number>
    /** Mk of every machine, per kind. */
    mach: Record<string, number[]>
    labs: number
    storages: number
    silos: number
    beltMk: number
    goals: string[]
    mined: number
    budget: number
    wish: Stock
    /** What keeps the current research from going faster. */
    reason: string
    plan: { lab: Stock, labFor: string | null, stock: Stock }
    // bookkeeping
    waits: Record<string, number>
    finished: Record<string, number>
    tierAt: Record<number, number>
    goalAt: Record<string, number>
    fusionAt: number
    /** When the first pumpjack and crystal drill went down, and how many chunks it took. */
    firstSrc: Partial<Record<OreId, { t: number, chunks: number }>>
    /** Lab feed (items/s) while each research ran, weighted by time. */
    feed: Record<string, { items: number, time: number }>
    stockMade: number
    stockLost: number
}

function newSim(p: Profile, seed: number): Sim {
    return {
        p, w: worldOf(seed), t: 0, done: [], queue: [], progress: {}, stock: { ...START_STOCK }, chunks: [...START_CHUNKS], land: { chunks: 0, tiles: {}, patches: {} },
        src: Object.fromEntries(ORES.map(o => [o, []])) as unknown as Record<OreId, number[]>,
        amps: Object.fromEntries(ORES.map(o => [o, 0])) as Record<OreId, number>,
        mach: Object.fromEntries(MACHINE_KINDS.map(k => [k, []])),
        labs: 0, storages: 1, silos: 0, beltMk: 1, goals: [], mined: 0, budget: 0, wish: {}, reason: 'research cost',
        plan: { lab: {}, labFor: null, stock: {} },
        waits: {}, finished: {}, tierAt: { 1: 0 }, goalAt: {}, fusionAt: -1, firstSrc: {}, feed: {}, stockMade: 0, stockLost: 0
    }
}

function storageCap(s: Sim): number {
    return (1 + s.storages + SILO_MULT * s.silos) * STORAGE_CAP[storageLevel(s.done)]!
}
/** Ore tiles and patches on owned land, recounted when a chunk is bought. */
function land(s: Sim) {
    if (s.land.chunks !== s.chunks.length) {
        const tiles = Object.fromEntries(ORES.map(o => [o, s.chunks.reduce((a, c) => a + s.w.chunkOre.get(c)![o], 0)])) as Record<OreId, number>
        const patches = Object.fromEntries(ORES.map(o => [o, s.chunks.filter(c => s.w.chunkOre.get(c)![o] >= 3).length])) as Record<OreId, number>
        s.land = { chunks: s.chunks.length, tiles, patches }
    }
    return s.land
}
const ownedOre = (s: Sim, o: OreId) => land(s).tiles[o]!
const patches = (s: Sim, o: OreId) => land(s).patches[o]!
const tilesFor = (s: Sim, o: OreId) => Math.floor(ownedOre(s, o) * s.p.tileUse)
const units = (mks: number[]) => mks.reduce((a, mk) => a + MACHINE_MK[mk - 1]!, 0)
const buildingCount = (s: Sim) => ORES.reduce((a, o) => a + s.src[o].length, 0) + MACHINE_KINDS.reduce((a, k) => a + s.mach[k]!.length, 0)

function landUsed(s: Sim): number {
    let used = (s.labs + s.storages) * (4 + 2) + s.silos * (9 + 2)
    for (const o of ORES) used += s.src[o].length * (1 + 2) + s.amps[o]
    for (const k of MACHINE_KINDS) used += s.mach[k]!.length * (BUILDINGS[k].w * BUILDINGS[k].h + BELT_TILES)
    return used
}
const landFree = (s: Sim) => s.chunks.length * CHUNK * CHUNK * LAND_USE - landUsed(s)

/** What the miners on an ore could dig, and what the belts out of its patches carry. */
function oreCap(s: Sim, o: OreId): { dig: number, lanes: number } {
    const n = s.src[o].length
    const amp = n ? 1 + AMP_BONUS * s.p.ampTouch * Math.min(s.amps[o], n) / n : 1
    return {
        dig: units(s.src[o]) * BUILDINGS[SOURCE_OF[o]].rate! * amp,
        lanes: s.p.lanes * BELT_MK[s.beltMk - 1]!.rate * patches(s, o)
    }
}

function caps(s: Sim): Req {
    const out: Req = {}
    for (const o of ORES) {
        const c = oreCap(s, o)
        out[`ore:${o}`] = Math.min(c.dig, c.lanes)
    }
    for (const k of MACHINE_KINDS) out[`mach:${k}`] = units(s.mach[k]!)
    return out
}

function remaining(s: Sim, id: string): Stock {
    const got = s.progress[id] ?? {}
    const out: Stock = {}
    for (const [k, v] of entries(RESEARCH_BY_ID[id]!.cost)) {
        if (v - (got[k] ?? 0) > 1e-6) out[k] = v - (got[k] ?? 0)
    }
    return out
}

/** Lab feed for a research: its remaining items in proportion, as fast as the tightest limit allows. */
function labPlan(s: Sim, id: string, share: number, cap = caps(s)) {
    const need = remaining(s, id)
    const total = entries(need).reduce((a, [, v]) => a + v, 0)
    const req: Req = {}
    for (const [k, v] of entries(need)) {
        for (const [res, q] of Object.entries(reqOf(k))) req[res] = (req[res] ?? 0) + q * v / total
    }
    let scale = s.labs * LAB_RATE
    let bind = 'labs'
    for (const [res, q] of Object.entries(req)) {
        const lim = share * cap[res]! / q
        if (lim < scale) {
            scale = lim
            bind = res
        }
    }
    const rates: Stock = {}
    const used: Req = {}
    for (const [k, v] of entries(need)) rates[k] = scale * v / total
    for (const [res, q] of Object.entries(req)) used[res] = q * scale
    return { rates, used, scale, bind, total }
}

/** Storage feed: what the labs leave over, split across building materials below the cap. */
function stockPlan(s: Sim, used: Req, cap = caps(s)) {
    const limit = storageCap(s)
    const items = BUILD_ITEMS.filter(k => producible(k, s.done) && (s.stock[k] ?? 0) < limit - 1e-6)
    const w = (k: ItemId) => (s.wish[k] ?? 0) > 0 ? 3 : 1
    const load: Req = {}
    for (const k of items) {
        for (const [res, q] of Object.entries(reqOf(k))) load[res] = (load[res] ?? 0) + w(k) * q
    }
    const rates: Stock = {}
    const bind: Partial<Record<ItemId, string>> = {}
    for (const k of items) {
        let lam = Infinity
        for (const res of Object.keys(reqOf(k))) {
            const l = Math.max(0, cap[res]! - (used[res] ?? 0)) / load[res]!
            if (l < lam) {
                lam = l
                bind[k] = res
            }
        }
        rates[k] = w(k) * lam
    }
    return { rates, bind }
}

function replan(s: Sim) {
    const cap = caps(s)
    const active = s.queue[0]
    const lp = active ? labPlan(s, active, s.p.labShare, cap) : null
    s.plan = { lab: lp?.rates ?? {}, labFor: active ?? null, stock: stockPlan(s, lp?.used ?? {}, cap).rates }
}

// ---- purchases -----------------------------------------------------------------------

interface Opt { label: string, cost: Stock, actions: number, space: number, land?: boolean, apply: (s: Sim) => void }

const canAfford = (s: Sim, cost: Stock) => entries(cost).every(([k, v]) => (s.stock[k] ?? 0) >= v - 1e-9)
const ACTIONS: Partial<Record<Kind, number>> = { miner: 0.5, pumpjack: 0.5, 'crystal-drill': 0.5, mixer: 1.2, assembler: 1.5, reactor: 2 }

function chunkOpt(s: Sim, ore: OreId | null): Opt | null {
    if (!s.done.includes('land-1')) return null
    // Oil and crystal only lie far out, so a player who knows they are coming walks towards them.
    if (tierOpen(4 - s.p.lookAhead, s.done) && !ownedOre(s, 'oil')) ore = 'oil'
    else if (tierOpen(5 - s.p.lookAhead, s.done) && !ownedOre(s, 'crystal')) ore = 'crystal'
    const owned = new Set(s.chunks)
    // Breadth-first over the chunk grid: the nearest chunk with the ore, and the first step towards it.
    let frontier = [...owned].flatMap(c => chunkNeighbours(c).filter(n => !owned.has(n)).map(n => [n, n] as [string, string]))
    const seen = new Set(frontier.map(f => f[0]))
    let best: { first: string, score: number } | null = null
    while (frontier.length && !best) {
        const next: [string, string][] = []
        for (const [key, first] of frontier) {
            const count = s.w.chunkOre.get(key)!
            const score = ore ? count[ore] : ORES.reduce((a, o) => a + count[o], 0) + 1
            if (score >= (ore ? 4 : 1) && (!best || score > best.score)) best = { first, score }
            for (const n of chunkNeighbours(key)) {
                if (owned.has(n) || seen.has(n)) continue
                seen.add(n)
                next.push([n, first])
            }
        }
        frontier = next
    }
    if (!best) return null
    const key = best.first
    return { label: `chunk ${s.chunks.length - START_CHUNKS.length + 1}`, cost: chunkCost(s.chunks.length - START_CHUNKS.length), actions: 0.3, space: 0, land: true, apply: (x) => { x.chunks.push(key) } }
}

function buildOpt(kind: Kind, apply: (s: Sim) => void): Opt {
    const def = BUILDINGS[kind]
    return { label: kind, cost: def.cost, actions: ACTIONS[kind] ?? 0.7, space: def.w * def.h + (def.role === 'source' ? 2 : BELT_TILES), apply }
}

function upgradeOpt(s: Sim, kind: Kind, mks: number[]): Opt | null {
    const low = Math.min(...mks)
    if (!mks.length || low >= maxMk(kind, s.done)) return null
    return { label: `${kind} mk${low + 1}`, cost: upgradeCost(kind, low + 1), actions: 0.15, space: 0, apply: () => { mks[mks.indexOf(low)] = low + 1 } }
}

/** First affordable option in order of preference, else the cheapest to save for. */
function choose(s: Sim, opts: (Opt | null)[]): Opt | null {
    const real = opts.filter((o): o is Opt => !!o)
    return real.find(o => canAfford(s, o.cost)) ?? real.sort((a, b) => oreEqOf(a.cost) - oreEqOf(b.cost))[0] ?? null
}

/** The purchase that lifts a limit ('labs', 'ore:<id>' or 'mach:<kind>'). */
function relief(s: Sim, res: string): Opt | null {
    if (res === 'labs') return buildOpt('lab', (x) => { x.labs++ })
    const [type, id] = res.split(':') as [string, string]
    if (type === 'mach') {
        const kind = id as Kind
        if (!isUnlocked(kind, s.done)) return null
        return choose(s, [upgradeOpt(s, kind, s.mach[kind]!), buildOpt(kind, (x) => { x.mach[kind]!.push(1) })])
    }
    const ore = id as OreId
    const kind = SOURCE_OF[ore]
    if (!isUnlocked(kind, s.done)) return null
    const cap = oreCap(s, ore)
    if (cap.dig > cap.lanes && patches(s, ore) > 0) {
        if (s.beltMk < maxMk('belt', s.done)) {
            const belts = BELT_TILES * buildingCount(s)
            const cost: Stock = {}
            for (const [k, v] of entries(upgradeCost('belt', s.beltMk + 1))) cost[k] = v * belts
            return { label: `belts mk${s.beltMk + 1}`, cost, actions: belts / 40, space: 0, apply: (x) => { x.beltMk++ } }
        }
        return chunkOpt(s, ore)
    }
    const amp = s.p.ampTouch > 0 && isUnlocked('amplifier', s.done) && s.amps[ore] < s.src[ore].length
    return choose(s, [
        s.src[ore].length < tilesFor(s, ore) ? buildOpt(kind, (x) => { x.src[ore].push(1) }) : null,
        upgradeOpt(s, kind, s.src[ore]),
        amp ? { label: 'amplifier', cost: BUILDINGS.amplifier.cost, actions: 0.3, space: 1, apply: (x) => { x.amps[ore]++ } } : null
    ]) ?? chunkOpt(s, ore)
}

/** Swaps a purchase for what it needs first: land to stand on, or storage to hold its price. */
function fit(s: Sim, opt: Opt | null): Opt | null {
    if (!opt) return null
    const cap = storageCap(s)
    if (entries(opt.cost).some(([, v]) => v > cap)) {
        // Storage is small enough to always find a corner, so it never waits for land.
        const silo = { ...buildOpt('silo', (x) => { x.silos++ }), space: 0 }
        if (isUnlocked('silo', s.done) && canAfford(s, silo.cost)) return silo
        return { ...buildOpt('storage', (x) => { x.storages++ }), space: 0 }
    }
    if (opt.space > 0 && opt.space > landFree(s)) return fit(s, chunkOpt(s, null))
    return opt
}

function buy(s: Sim, opt: Opt) {
    for (const [k, v] of entries(opt.cost)) s.stock[k] = Math.max(0, (s.stock[k] ?? 0) - v)
    s.budget -= opt.actions
    opt.apply(s)
    for (const o of ORES) {
        if (s.src[o].length && !s.firstSrc[o]) s.firstSrc[o] = { t: s.t, chunks: s.chunks.length }
    }
    if (opt.label === 'reactor' && s.fusionAt < 0) s.fusionAt = s.t
}

/** One minute of a session: buy what speeds the research up, and note what to save for. */
function act(s: Sim) {
    s.wish = {}
    s.reason = 'research cost'
    const want = (opt: Opt) => {
        for (const [k, v] of entries(opt.cost)) {
            const lack = v - (s.stock[k] ?? 0)
            if (lack > 0) s.wish[k] = Math.max(s.wish[k] ?? 0, lack)
        }
    }
    for (let guard = 0; guard < 60; guard++) {
        const active = s.queue[0]
        const opts: Opt[] = []
        const add = (opt: Opt | null) => {
            if (opt && !opts.some(o => o.label === opt.label)) opts.push(opt)
        }
        // The one building a player clears room for instead of buying land.
        if (s.done.includes('fusion-reactor') && !s.mach.reactor!.length) add(fit(s, { ...buildOpt('reactor', (x) => { x.mach.reactor!.push(1) }), space: 0 }))
        // A queued research with no line at all gets its first one, then the running one gets faster.
        const idle = s.queue.map(id => labPlan(s, id, s.p.labShare)).find(lp => lp.scale <= 0)
        if (idle) add(fit(s, relief(s, idle.bind)))
        const head = active ? fit(s, relief(s, labPlan(s, active, s.p.labShare).bind)) : null
        add(head)
        if (!opts.length) {
            if (active) s.reason = 'ore on owned land'
            return
        }
        const ready = opts.filter(o => canAfford(s, o.cost))
        const go = ready.find(o => s.budget >= o.actions)
        if (go) {
            buy(s, go)
            continue
        }
        if (ready.length) {
            s.reason = 'session time'
            return
        }
        const opt = head ?? opts[0]!
        s.reason = opt.land ? 'land cost' : 'building materials'
        opts.forEach(want)
        // The price is out of reach: widen the lines that make it, a few levels deep.
        const tried = new Set(opts.map(o => o.label))
        let bought = false
        for (let depth = 0; depth < 4 && !bought; depth++) {
            const lp = active ? labPlan(s, active, s.p.labShare) : null
            const sp = stockPlan(s, lp?.used ?? {})
            const slow = entries(s.wish)
                .filter(([k]) => producible(k, s.done))
                .map(([k, v]) => ({ k, wait: v / (sp.rates[k] || 1e-9) }))
                .sort((a, b) => b.wait - a.wait)[0]
            if (!slow || slow.wait < WAIT_TOLERANCE) break
            const more = fit(s, relief(s, sp.bind[slow.k] ?? Object.keys(reqOf(slow.k))[0]!))
            if (!more || tried.has(more.label)) break
            tried.add(more.label)
            if (canAfford(s, more.cost) && s.budget >= more.actions) {
                buy(s, more)
                bought = true
            } else if (!canAfford(s, more.cost)) want(more)
            else break
        }
        if (!bought) return
    }
}

function handMine(s: Sim) {
    let ore = s.p.handFrac * MINE_REFILL * 60
    s.mined += ore
    const cap = storageCap(s)
    for (const k of ['iron-ore', 'stone', 'copper-ore', 'coal'] as const) {
        const take = Math.min(ore, s.wish[k] ?? 0, Math.max(0, cap - (s.stock[k] ?? 0)))
        if (take <= 0 || !ownedOre(s, k)) continue
        s.stock[k] = (s.stock[k] ?? 0) + take
        ore -= take
    }
}

// ---- research choice and goals -----------------------------------------------------

function candidates(s: Sim) {
    const cap = caps(s)
    const dig = ORES.reduce((a, o) => a + cap[`ore:${o}`]!, 0)
    return RESEARCH
        .filter(n => researchAvailable(n.id, s.done) && Object.keys(n.cost).every(k => producible(k as ItemId, s.done)))
        .map((n) => {
            const lp = labPlan(s, n.id, s.p.labShare, cap)
            // Nothing built for it yet: guess from the ore behind it, plus time to set the line up.
            const eta = lp.scale > 0 ? lp.total / lp.scale : 3 * oreEqOf(remaining(s, n.id)) / Math.max(dig, 0.5) + 600
            return { id: n.id, eta, score: eta / weight(n.id), running: lp.scale > 0 }
        })
        .sort((a, b) => a.score - b.score)
}

function pickResearch(s: Sim, gap = 0) {
    const list = candidates(s)
    if (!list.length) return
    if (s.done.includes('auto-queue')) {
        // Whatever has a line running goes in front: a research waiting for its first drill would block the rest.
        const running = list.filter(c => c.running)
        s.queue = [...running, ...list.filter(c => !c.running)].map(c => c.id).slice(0, QUEUE_MAX_AUTO)
        return
    }
    if (!gap) {
        if (!s.queue.length) s.queue = [list[0]!.id]
        return
    }
    // Leaving with one slot: a key unlock goes first, otherwise whatever keeps the labs busy longest
    // over the break, weighted by how much it is wanted.
    const key = list.slice(0, 3).find(c => weight(c.id) >= 3)
    const busy = [...list].sort((a, b) => Math.min(b.eta, gap) * weight(b.id) - Math.min(a.eta, gap) * weight(a.id))[0]!
    s.queue = [(key ?? busy).id]
}

const GOAL_MET: Record<string, (s: Sim) => boolean> = {
    'hello': () => true,
    'hand-mine': s => s.mined >= 10,
    'first-miner': s => s.src['iron-ore'].length > 0,
    'first-belt': s => s.src['iron-ore'].length > 0,
    'two-ores': s => s.src['iron-ore'].length > 0 && s.src.stone.length > 0,
    'pick-research': s => s.queue.length > 0 || s.done.length > 0,
    'lab': s => s.labs > 0 || s.done.length > 0,
    'smelting': s => s.done.includes('smelting'),
    'plates': s => s.mach.smelter!.length > 0,
    'bricks': s => s.mach.kiln!.length > 0,
    'land': s => s.chunks.length > START_CHUNKS.length,
    'plates-60': s => Math.min(caps(s)['ore:iron-ore']!, units(s.mach.smelter!) / RECIPES['iron-plate']!.time) >= 1,
    'tier-2': s => tierOpen(2, s.done),
    'gears': s => s.mach.press!.length > 0,
    'steel': s => s.mach.mixer!.length > 0 && s.src.coal.length > 0,
    'tier-3': s => tierOpen(3, s.done),
    'motors': s => s.mach.assembler!.length > 0,
    'tier-4': s => tierOpen(4, s.done),
    'chips': s => s.done.includes('electronics') && s.mach.refinery!.length > 0,
    'tier-5': s => tierOpen(5, s.done),
    'fusion': s => s.mach.reactor!.length > 0
}

function claimGoals(s: Sim) {
    for (const g of GOALS) {
        if (s.goals.includes(g.id)) continue
        const met = GOAL_MET[g.id]
        if (!met) throw new Error(`gridworks-pace: no rule for goal '${g.id}', add it to GOAL_MET`)
        if (!met(s)) return
        for (const [k, v] of entries(g.reward)) s.stock[k] = (s.stock[k] ?? 0) + v
        s.goals.push(g.id)
        s.goalAt[g.id] = s.t
    }
}

// ---- time ----------------------------------------------------------------------------

const allDone = (s: Sim) => s.done.length >= RESEARCH.length

function advance(s: Sim, until: number, offline: boolean) {
    const cap = storageCap(s)
    while (s.t < until - 1e-6) {
        const active = s.queue[0]
        if (active && s.plan.labFor !== active) {
            // The queue moved on while away: the lines were not laid out for this one.
            const lp = labPlan(s, active, s.p.labShare)
            const lab: Stock = {}
            for (const [k, v] of entries(lp.rates)) lab[k] = v * s.p.autoEff
            s.plan = { ...s.plan, lab, labFor: active }
        }
        let dt = until - s.t
        const need = active ? remaining(s, active) : {}
        let moving = false
        for (const [k, n] of entries(need)) {
            const rate = s.plan.lab[k] ?? 0
            if (rate <= 0) continue
            moving = true
            dt = Math.min(dt, n / rate)
        }
        dt = Math.max(dt, 0.001)
        if (active) {
            const prog = s.progress[active] ??= {}
            const feed = s.feed[active] ??= { items: 0, time: 0 }
            for (const [k] of entries(need)) {
                prog[k] = (prog[k] ?? 0) + (s.plan.lab[k] ?? 0) * dt
                feed.items += (s.plan.lab[k] ?? 0) * dt
            }
            if (moving) feed.time += dt
        }
        for (const [k, rate] of entries(s.plan.stock)) {
            const cur = s.stock[k] ?? 0
            const next = Math.max(cur, Math.min(cap, cur + rate * dt))
            if (offline) {
                s.stockMade += rate * dt
                s.stockLost += rate * dt - (next - cur)
            }
            s.stock[k] = next
        }
        const why = allDone(s) ? 'done' : !active ? 'labs idle, nothing queued' : !moving ? 'labs idle, no line for the research yet' : s.reason
        s.waits[why] = (s.waits[why] ?? 0) + dt
        s.t += dt
        if (active && !Object.keys(remaining(s, active)).length) {
            s.done.push(active)
            s.queue.shift()
            s.finished[active] = s.t
            for (let tier = 2; tier <= 5; tier++) {
                if (s.tierAt[tier] === undefined && tierOpen(tier, s.done)) s.tierAt[tier] = s.t
            }
        }
    }
}

interface Result { sim: Sim, end: number }

function run(p: Profile, seed: number): Result {
    const s = newSim(p, seed)
    const finishedAt = () => allDone(s) && s.fusionAt >= 0 ? Math.max(s.fusionAt, ...Object.values(s.finished)) : -1
    for (let day = 0; day < MAX_DAYS; day++) {
        for (let i = 0; i < p.sessions.length; i++) {
            advance(s, day * DAY + p.sessions[i]! * HOUR, true)
            if (finishedAt() >= 0) return { sim: s, end: finishedAt() }
            s.budget = 1
            for (let m = 0; m < p.minutes; m++) {
                claimGoals(s)
                pickResearch(s)
                s.budget = Math.min(s.budget + p.buildsPerMin, p.minutes * p.buildsPerMin)
                act(s)
                handMine(s)
                pickResearch(s)
                replan(s)
                advance(s, s.t + 60, false)
                if (finishedAt() >= 0) return { sim: s, end: finishedAt() }
            }
            const next = i + 1 < p.sessions.length ? day * DAY + p.sessions[i + 1]! * HOUR : (day + 1) * DAY + p.sessions[0]! * HOUR
            claimGoals(s)
            pickResearch(s, next - s.t)
            replan(s)
        }
    }
    return { sim: s, end: -1 }
}

// ---- engine check --------------------------------------------------------------------

/** Runs the real solver on three tiny layouts and compares with the rates the model uses. */
function engineCheck() {
    const map = oreMap(12345)
    const minable = (x: number, y: number) => {
        const o = oreAt(map, x, y)
        return !!o && o !== 'oil' && o !== 'crystal'
    }
    let spot: [number, number] | null = null
    for (let y = 40; y < 56 && !spot; y++) {
        for (let x = 40; x < 56 && !spot; x++) {
            if (oreAt(map, x - 1, y) === 'iron-ore' && minable(x, y - 1) && minable(x, y + 1)) spot = [x, y]
        }
    }
    if (!spot) throw new Error('engine check: no ore cross near the centre')
    const [x, y] = spot
    const belts = (n: number): Entity[] => Array.from({ length: n }, (_, i) => ({ k: 'belt', x: x + 1 + i, y, r: 0 }))
    const sum = (st: Stock) => Object.values(st).reduce((a, b) => a + b, 0)
    const flags = { blocked: [], labWants: ['iron-ore' as const] }
    const checks: [string, number, number][] = []
    // A miner into a lab: the lab takes LAB_RATE, the miner makes its rate.
    const lab = solve([{ k: 'miner', x: x - 1, y, r: 0 }, { k: 'belt', x, y, r: 0 }, ...belts(2), { k: 'lab', x: x + 3, y, r: 0 }], map, flags)
    checks.push(['miner -> lab', sum(lab.lab), Math.min(BUILDINGS.miner.rate!, LAB_RATE)])
    // Three miners through a merger onto one Mk1 belt: the belt is the limit.
    const merged = solve([
        { k: 'miner', x: x - 1, y, r: 0 }, { k: 'miner', x, y: y - 1, r: 1 }, { k: 'miner', x, y: y + 1, r: 3 },
        { k: 'merger', x, y, r: 0 }, ...belts(2), { k: 'storage', x: x + 3, y, r: 0 }
    ], map, flags)
    checks.push(['3 miners -> 1 belt', sum(merged.store), Math.min(3 * BUILDINGS.miner.rate!, BELT_MK[0]!.rate)])
    // A miner through a smelter: the recipe sets the rate.
    const smelt = solve([{ k: 'miner', x: x - 1, y, r: 0 }, { k: 'smelter', x, y, r: 0 }, ...belts(2), { k: 'storage', x: x + 3, y, r: 0 }], map, flags)
    checks.push(['miner -> smelter', sum(smelt.store), Math.min(BUILDINGS.miner.rate!, 1 / RECIPES['iron-plate']!.time)])
    for (const [name, got, want] of checks) {
        const ok = Math.abs(got - want) <= 0.05 * want
        console.log(`  ${ok ? 'ok ' : 'OFF'} ${name.padEnd(20)} solver ${got.toFixed(3)}/s, model ${want.toFixed(3)}/s`)
    }
}

// ---- report --------------------------------------------------------------------------

const days = (t: number) => t < 0 ? `>${MAX_DAYS}d` : `${(t / DAY).toFixed(1)}d`
function when(t: number): string {
    if (t < 0) return 'never'
    if (t < 2 * HOUR) return `${Math.round(t / 60)}m`
    if (t < DAY) return `${(t / HOUR).toFixed(1)}h`
    return `day ${(t / DAY).toFixed(1)}`
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

function report(p: Profile, results: Result[]) {
    const ends = results.map(r => r.end < 0 ? MAX_DAYS * DAY : r.end)
    const mid = results.find(r => (r.end < 0 ? MAX_DAYS * DAY : r.end) === median(ends))!
    const s = mid.sim
    console.log(`\n=== ${p.name}: ${p.sessions.length} x ${p.minutes} min a day ===`)
    console.log(`endgame: median ${days(median(ends))} (fastest ${days(Math.min(...ends))}, slowest ${days(Math.max(...ends))} over ${results.length} maps)`)
    const hour = RESEARCH.filter(n => (s.finished[n.id] ?? Infinity) <= HOUR).length
    const goals = Object.values(s.goalAt).filter(t => t <= HOUR).length
    console.log(`first hour on the clock: ${hour} researches, ${goals} goals`)
    for (let tier = 1; tier <= 5; tier++) {
        const nodes = RESEARCH.filter(n => n.tier === tier).sort((a, b) => (s.finished[a.id] ?? Infinity) - (s.finished[b.id] ?? Infinity))
        const opened = s.tierAt[tier]
        const fed = nodes.reduce((a, n) => ({ items: a.items + (s.feed[n.id]?.items ?? 0), time: a.time + (s.feed[n.id]?.time ?? 0) }), { items: 0, time: 0 })
        console.log(`  tier ${tier} opens ${opened === undefined ? 'never' : when(opened)}, labs fed ${(fed.items / Math.max(1, fed.time)).toFixed(1)} items/s over ${(fed.time / HOUR).toFixed(1)}h of research`)
        console.log(`    ${nodes.map(n => `${n.id} ${when(s.finished[n.id] ?? -1)}`).join(', ')}`)
    }
    const first = (o: OreId) => s.firstSrc[o] ? `${when(s.firstSrc[o].t)} (chunk ${s.firstSrc[o].chunks})` : 'never'
    console.log(`  first oil ${first('oil')}, first crystal ${first('crystal')}, fusion cores flow ${when(s.fusionAt)}, endgame ${when(mid.end)}`)
    const order = RESEARCH.filter(n => s.finished[n.id] !== undefined).sort((a, b) => s.finished[a.id]! - s.finished[b.id]!)
    let prev = 0
    let longest = { id: '', gap: 0 }
    for (const n of order) {
        const gap = s.finished[n.id]! - prev
        if (gap > longest.gap) longest = { id: n.id, gap }
        prev = s.finished[n.id]!
    }
    console.log(`  longest wait between two researches: ${(longest.gap / HOUR).toFixed(1)}h (before ${longest.id})`)
    const total = Object.entries(s.waits).filter(([k]) => k !== 'done').reduce((a, [, v]) => a + v, 0)
    const waits = Object.entries(s.waits).filter(([k]) => k !== 'done').sort((a, b) => b[1] - a[1])
    console.log(`  what the clock went to: ${waits.map(([k, v]) => `${k} ${Math.round(v / total * 100)}%`).join(', ')}`)
    console.log(`  offline storage production lost to the cap: ${Math.round(s.stockLost / Math.max(1, s.stockMade) * 100)}%`)
    const miners = ORES.map(o => s.src[o].length).reduce((a, b) => a + b, 0)
    const machines = MACHINE_KINDS.reduce((a, k) => a + s.mach[k]!.length, 0)
    console.log(`  factory at the end: ${s.chunks.length} chunks, ${miners} miners and pumps, ${machines} machines, ${s.labs} labs, ${s.storages} storages, ${s.silos} silos, belts Mk${s.beltMk}`)
}

const seedCount = Math.max(1, Number(process.argv[2]) || 7)
const only = process.argv[3]
// What-if for tuning: GW_SCALE=1,1,2,3,4 multiplies the research costs of tiers 1-5 for this run only.
const scale = (process.env.GW_SCALE ?? '').split(',').map(Number)
for (const n of RESEARCH) {
    const mult = scale[n.tier - 1]
    if (!mult || mult === 1) continue
    for (const [k, v] of entries(n.cost)) n.cost[k] = Math.round(v * mult)
}
console.log('Gridworks pace')
console.log('engine check (real solver against the model\'s rates):')
engineCheck()
for (const p of PROFILES) {
    if (only && p.name !== only) continue
    report(p, Array.from({ length: seedCount }, (_, i) => run(p, 1001 + i * 7919)))
}
console.log('\n"what the clock went to" names what kept the running research from going faster:')
console.log('  research cost = nothing to buy would help, building materials / land cost = saving up,')
console.log('  session time = build budget ran out, ore on owned land = no ore, upgrade or land left to add.')
