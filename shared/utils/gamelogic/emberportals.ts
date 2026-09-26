// shared/utils/gamelogic/emberportals.ts
//
// "Ember Portals": a 7×7 cluster-pays tumble slot built around portal wilds
// that grow, wander and merge.
//
// ── Base game ────────────────────────────────────────────────────────────────
//   Every cell is a weighted draw. A win is 5+ cells of one pay symbol joined
//   horizontally or vertically; portal WILDs join any cluster they touch. A
//   cluster pays PAYTABLE[symbol][bracket(size)] × bet × the sum of the wild
//   multipliers inside it (×1 without wilds).
//
//   After a win the paying symbols burn away, everything above falls down and
//   fresh symbols drop in (tumble) until no cluster is left. Wilds never fall:
//   they hold their cell and symbols drop past them.
//
// ── Portal wilds ────────────────────────────────────────────────────────────
//   • A winning cluster without a wild opens a portal (×1) on a random cell of
//     that cluster once it has paid.
//   • A wild in a win grows by +1 and jumps to a random cell of that win.
//   • Wilds that share a win (directly, or through clusters that share a
//     wild) merge into one portal whose multiplier is their product (×5 and
//     ×3 become ×15). A merge always gains at least what growing would have
//     (sum + 1), so folding in a ×1 portal is never a loss.
//   Base game portals close when the tumble sequence ends, unless the spin
//   triggers the free spins: then they carry into the feature.
//
// ── Free spins ──────────────────────────────────────────────────────────────
//   3-7 SCATTERs on the settled screen award 10/12/14/16/18 free spins.
//   Portals stay open for the whole feature, so they keep growing. 3+ scatters
//   during the feature add FS_RETRIGGER_SPINS.
//
// ── Bets ────────────────────────────────────────────────────────────────────
//   ante:  the bet costs EP_ANTE_COST × bet and scatters land more often.
//   buy:   EP_BUY_COST × bet starts the free spins straight away.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Total win is capped at EP_MAX_WIN_MULT × bet; the feature stops early at
//   the cap. Tuned with `bun run balance:emberportals`.

import { randomFloat } from '../random'

export const EP_COLS = 7
export const EP_ROWS = 7
export const EP_MIN_CLUSTER = 5
export const EP_MAX_WIN_MULT = 10_000
export const EP_WILD_MAX_MULT = 256
/** Safety bound on tumbles in one spin. */
export const EP_MAX_TUMBLES = 200

export type EpPaySymbol = 'ember' | 'rune' | 'potion' | 'hourglass' | 'chalice' | 'amulet' | 'grimoire' | 'phoenix'
export type EpSymbol = EpPaySymbol | 'wild' | 'scatter'

/** Low to high. */
export const EP_PAY_SYMBOLS: EpPaySymbol[] = ['ember', 'rune', 'potion', 'hourglass', 'chalice', 'amulet', 'grimoire', 'phoenix']

/** Smallest cluster size of each paytable column. */
export const EP_BRACKETS = [5, 6, 7, 8, 9, 10, 11, 13, 15] as const

/** Pays × bet per cluster, one column per bracket in EP_BRACKETS. */
export const PAYTABLE: Record<EpPaySymbol, number[]> = {
    ember: [0.3, 0.4, 0.5, 0.7, 0.8, 1.4, 2.8, 5.5, 14],
    rune: [0.4, 0.5, 0.7, 0.8, 1.1, 1.6, 3.3, 6.6, 16],
    potion: [0.5, 0.7, 0.8, 1.1, 1.4, 2.2, 4.4, 8, 22],
    hourglass: [0.7, 0.8, 1.1, 1.4, 1.6, 2.8, 5.5, 11, 28],
    chalice: [0.8, 1.1, 1.4, 1.6, 2.8, 3.3, 6.6, 16, 44],
    amulet: [1.1, 1.4, 1.6, 2.8, 3.3, 5.5, 11, 28, 70],
    grimoire: [1.4, 1.6, 2.8, 3.3, 5.5, 8, 16, 40, 140],
    phoenix: [1.6, 2.8, 3.3, 5.5, 8, 14, 28, 70, 275]
}

export function bracketIndex(size: number): number {
    let i = -1
    for (let b = 0; b < EP_BRACKETS.length; b++) if (size >= EP_BRACKETS[b]!) i = b
    return i
}

export function clusterPay(symbol: EpPaySymbol, size: number): number {
    const i = bracketIndex(size)
    return i < 0 ? 0 : PAYTABLE[symbol][i]!
}

type Weights = Record<EpPaySymbol | 'scatter', number>

const BASE_PAY = { ember: 150, rune: 145, potion: 135, hourglass: 125, chalice: 100, amulet: 85, grimoire: 70, phoenix: 55 }

export const BASE_WEIGHTS: Weights = { ...BASE_PAY, scatter: 6.4 }
/** Ante: same symbols, free spins trigger about 1.35× as often. */
export const ANTE_WEIGHTS: Weights = { ...BASE_PAY, scatter: 7.12 }
/** Free spins drop the embers, so clusters (and portals) land more often. */
export const FS_WEIGHTS: Weights = { ember: 0, rune: 218, potion: 160, hourglass: 140, chalice: 110, amulet: 90, grimoire: 70, phoenix: 50, scatter: 4 }

export const FS_TRIGGER = 3
/** Free spins for 3, 4, 5, 6 and 7+ scatters. */
export const FS_AWARD = [10, 12, 14, 16, 18] as const
export const FS_RETRIGGER_SPINS = 5
export const FS_MAX_SPINS = 60

/** Ante bet cost, × bet. */
export const EP_ANTE_COST = 1.25
/** Free-spins buy cost, × bet. */
export const EP_BUY_COST = 103

export function fsAward(scatters: number): number {
    if (scatters < FS_TRIGGER) return 0
    return FS_AWARD[Math.min(scatters, 7) - FS_TRIGGER]!
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface EpWild {
    /** Stable id for animation: a merged portal keeps the id of the biggest one. */
    id: number
    col: number
    row: number
    mult: number
}

export interface EpCluster {
    symbol: EpPaySymbol
    /** Every cell, wilds included. */
    cells: Cell[]
    size: number
    /** Ids of the wilds in this cluster. */
    wilds: number[]
    /** Sum of those wilds' multipliers, 1 without wilds. */
    mult: number
    /** Paytable value × bet, before the multiplier. */
    base: number
    amount: number
}

export interface EpWildChange {
    /** Id of the portal after this step. */
    id: number
    kind: 'spawn' | 'grow'
    /** Ids folded into this portal (merge), besides itself. */
    merged: number[]
    from: Cell | null
    to: Cell
    prevMult: number
    mult: number
}

export interface EpTumble {
    /** The screen these clusters were found on. */
    grid: EpSymbol[][]
    clusters: EpCluster[]
    win: number
    /** Portals after this step's grow / move / merge / spawn. */
    wilds: EpWild[]
    wildChanges: EpWildChange[]
    /** Cells emptied by this step (burnt symbols and portals that moved away). */
    removed: Cell[]
    /** Symbols that fell: same column, from row → to row. */
    falls: { col: number, from: number, to: number }[]
    /** Symbols dropped in from above to fill the gaps. */
    fresh: { col: number, row: number, symbol: EpSymbol }[]
}

export interface EpSpin {
    /** Screen as it lands (open portals already in place). */
    grid: EpSymbol[][]
    /** Portals open when the spin lands. */
    wildsStart: EpWild[]
    tumbles: EpTumble[]
    /** Screen once the tumbles settle. */
    finalGrid: EpSymbol[][]
    /** Portals once the tumbles settle (before the base game closes them). */
    wildsEnd: EpWild[]
    win: number
    scatters: Cell[]
}

export interface EpFreeSpin extends EpSpin {
    index: number
    /** Spins added by this spin's scatters. */
    retrigger: number
    totalSpins: number
    runningTotal: number
}

export interface EpFreeSpins {
    source: 'scatter' | 'buy'
    awarded: number
    spins: EpFreeSpin[]
    total: number
    capped: boolean
}

export type EpMode = 'normal' | 'ante' | 'buy'

export interface EmberPortalsResult {
    bet: number
    cost: number
    mode: EpMode
    base: EpSpin
    basePayout: number
    freeSpins: EpFreeSpins | null
    freeSpinsPayout: number
    bonusTriggered: boolean
    payout: number
    won: boolean
    maxWin: number
    capped: boolean
    [key: string]: unknown
}

// --- rng helpers ------------------------------------------------------------

export type Rng = () => number

interface Table<T> { items: T[], cum: number[], total: number }

function table(w: Weights): Table<EpSymbol> {
    const items = (Object.keys(w) as (keyof Weights)[]).filter(k => w[k] > 0)
    const cum: number[] = []
    let total = 0
    for (const k of items) {
        total += w[k]
        cum.push(total)
    }
    return { items, cum, total }
}

function pick<T>(t: Table<T>, rng: Rng): T {
    const r = rng() * t.total
    for (let i = 0; i < t.cum.length; i++) if (r < t.cum[i]!) return t.items[i]!
    return t.items[t.items.length - 1]!
}

const BASE_TABLE = table(BASE_WEIGHTS)
const ANTE_TABLE = table(ANTE_WEIGHTS)
const FS_TABLE = table(FS_WEIGHTS)
const PLAIN_TABLE = table({ ...BASE_PAY, scatter: 0 })

const round4 = (v: number) => Math.round(v * 10000) / 10000
const key = (col: number, row: number) => col * EP_ROWS + row

// --- clusters -----------------------------------------------------------------

/** All paying clusters on a screen. `wildAt` maps a cell key to the portal on it. */
export function findClusters(grid: EpSymbol[][], wildAt: Map<number, EpWild>, bet: number): EpCluster[] {
    const out: EpCluster[] = []
    const seen = new Uint8Array(EP_COLS * EP_ROWS)
    for (const sym of EP_PAY_SYMBOLS) {
        seen.fill(0)
        for (let col = 0; col < EP_COLS; col++) {
            for (let row = 0; row < EP_ROWS; row++) {
                if (grid[col]![row] !== sym || seen[key(col, row)]) continue
                // Flood fill over this symbol and wilds. Wilds are marked per
                // fill so two separate clusters can share one.
                const cells: Cell[] = []
                const wildSeen = new Set<number>()
                const stack: Cell[] = [{ col, row }]
                seen[key(col, row)] = 1
                while (stack.length) {
                    const c = stack.pop()!
                    cells.push(c)
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                        const nc = c.col + dc
                        const nr = c.row + dr
                        if (nc < 0 || nr < 0 || nc >= EP_COLS || nr >= EP_ROWS) continue
                        const k = key(nc, nr)
                        const s = grid[nc]![nr]
                        if (s === sym && !seen[k]) {
                            seen[k] = 1
                            stack.push({ col: nc, row: nr })
                        } else if (s === 'wild' && !wildSeen.has(k)) {
                            wildSeen.add(k)
                            stack.push({ col: nc, row: nr })
                        }
                    }
                }
                if (cells.length < EP_MIN_CLUSTER) continue
                const wilds: number[] = []
                let mult = 0
                for (const k of wildSeen) {
                    const w = wildAt.get(k)!
                    wilds.push(w.id)
                    mult += w.mult
                }
                if (!wilds.length) mult = 1
                const base = clusterPay(sym, cells.length) * bet
                out.push({ symbol: sym, cells, size: cells.length, wilds, mult, base: round4(base), amount: round4(base * mult) })
            }
        }
    }
    return out
}

function cloneGrid(grid: EpSymbol[][]): EpSymbol[][] {
    return grid.map(col => col.slice())
}

function drawGrid(t: Table<EpSymbol>, rng: Rng, wilds: EpWild[] = []): EpSymbol[][] {
    const grid: EpSymbol[][] = []
    for (let col = 0; col < EP_COLS; col++) {
        const column: EpSymbol[] = []
        for (let row = 0; row < EP_ROWS; row++) column.push(pick(t, rng))
        grid.push(column)
    }
    for (const w of wilds) grid[w.col]![w.row] = 'wild'
    return grid
}

function scattersOf(grid: EpSymbol[][]): Cell[] {
    const out: Cell[] = []
    for (let col = 0; col < EP_COLS; col++) {
        for (let row = 0; row < EP_ROWS; row++) if (grid[col]![row] === 'scatter') out.push({ col, row })
    }
    return out
}

interface IdSource { next: number }

/**
 * Play one spin's tumble sequence on `grid` (portals already placed).
 * `room` is how much the sequence may still pay before the max win.
 */
export function runTumbles(
    startGrid: EpSymbol[][],
    startWilds: EpWild[],
    t: Table<EpSymbol>,
    bet: number,
    room: number,
    ids: IdSource,
    rng: Rng
): EpSpin {
    let grid = cloneGrid(startGrid)
    let wilds = startWilds.map(w => ({ ...w }))
    const tumbles: EpTumble[] = []
    let win = 0

    // Tumbles end on their own long before this; the bound only guards
    // against a future weight change that makes clusters near-certain.
    while (tumbles.length < EP_MAX_TUMBLES) {
        const wildAt = new Map<number, EpWild>()
        for (const w of wilds) wildAt.set(key(w.col, w.row), w)
        const clusters = findClusters(grid, wildAt, bet)
        if (!clusters.length || win >= room) break

        let stepWin = round4(clusters.reduce((a, c) => a + c.amount, 0))
        if (win + stepWin > room) {
            // The max win cuts this step short: scale each cluster down so
            // the amounts shown still add up to what is paid.
            const scale = (room - win) / stepWin
            for (const c of clusters) c.amount = round4(c.amount * scale)
            stepWin = round4(room - win)
        }
        win = round4(win + stepWin)

        // Group clusters that share a wild (union-find over cluster indexes).
        const parent = clusters.map((_, i) => i)
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
        const owner = new Map<number, number>()
        clusters.forEach((c, i) => {
            for (const id of c.wilds) {
                const o = owner.get(id)
                if (o === undefined) owner.set(id, i)
                else parent[find(i)] = find(o)
            }
        })
        const groups = new Map<number, number[]>()
        clusters.forEach((_, i) => {
            const r = find(i)
            if (!groups.has(r)) groups.set(r, [])
            groups.get(r)!.push(i)
        })

        const removed = new Set<number>()
        for (const c of clusters) for (const cell of c.cells) if (grid[cell.col]![cell.row] !== 'wild') removed.add(key(cell.col, cell.row))

        const byId = new Map(wilds.map(w => [w.id, w]))
        const nextWilds = new Map(wilds.map(w => [w.id, w]))
        const changes: EpWildChange[] = []
        for (const members of groups.values()) {
            const area = new Map<number, Cell>()
            const ids2 = new Set<number>()
            for (const i of members) {
                for (const cell of clusters[i]!.cells) area.set(key(cell.col, cell.row), cell)
                for (const id of clusters[i]!.wilds) ids2.add(id)
            }
            const cells = [...area.values()]
            const target = cells[Math.floor(rng() * cells.length)]!
            if (!ids2.size) {
                const w = { id: ids.next++, col: target.col, row: target.row, mult: 1 }
                nextWilds.set(w.id, w)
                changes.push({ id: w.id, kind: 'spawn', merged: [], from: null, to: target, prevMult: 0, mult: 1 })
                continue
            }
            const group = [...ids2].map(id => byId.get(id)!).sort((a, b) => b.mult - a.mult || a.id - b.id)
            const keep = group[0]!
            const sum = group.reduce((a, w) => a + w.mult, 0)
            const product = group.reduce((a, w) => a * w.mult, 1)
            const grown = group.length > 1 ? Math.max(product, sum + 1) : sum + 1
            const mult = Math.min(EP_WILD_MAX_MULT, grown)
            for (const w of group) {
                nextWilds.delete(w.id)
                removed.add(key(w.col, w.row))
            }
            const w = { id: keep.id, col: target.col, row: target.row, mult }
            nextWilds.set(w.id, w)
            changes.push({
                id: w.id,
                kind: 'grow',
                merged: group.slice(1).map(g => g.id),
                from: { col: keep.col, row: keep.row },
                to: target,
                prevMult: keep.mult,
                mult
            })
        }

        wilds = [...nextWilds.values()]
        const wildCells = new Set(wilds.map(w => key(w.col, w.row)))
        for (const k of wildCells) removed.delete(k)

        // Gravity: symbols fall past portals into the emptied cells below.
        const next = cloneGrid(grid)
        const falls: EpTumble['falls'] = []
        const fresh: EpTumble['fresh'] = []
        for (let col = 0; col < EP_COLS; col++) {
            const survivors: { row: number, symbol: EpSymbol }[] = []
            for (let row = EP_ROWS - 1; row >= 0; row--) {
                const k = key(col, row)
                if (wildCells.has(k) || removed.has(k)) continue
                survivors.push({ row, symbol: grid[col]![row]! })
            }
            let s = 0
            for (let row = EP_ROWS - 1; row >= 0; row--) {
                if (wildCells.has(key(col, row))) {
                    next[col]![row] = 'wild'
                    continue
                }
                const sv = survivors[s++]
                if (sv) {
                    next[col]![row] = sv.symbol
                    if (sv.row !== row) falls.push({ col, from: sv.row, to: row })
                } else {
                    const symbol = pick(t, rng)
                    next[col]![row] = symbol
                    fresh.push({ col, row, symbol })
                }
            }
        }

        tumbles.push({
            grid,
            clusters,
            win: stepWin,
            wilds: wilds.map(w => ({ ...w })),
            wildChanges: changes,
            removed: [...removed].map(k => ({ col: Math.floor(k / EP_ROWS), row: k % EP_ROWS })),
            falls,
            fresh
        })
        grid = next
    }

    return {
        grid: cloneGrid(startGrid),
        wildsStart: startWilds.map(w => ({ ...w })),
        tumbles,
        finalGrid: grid,
        wildsEnd: wilds,
        win,
        scatters: scattersOf(grid)
    }
}

// --- free spins ---------------------------------------------------------------

/** `startWilds` are the portals the triggering spin left open; they carry into the feature. */
export function runFreeSpins(
    bet: number,
    awarded: number,
    source: EpFreeSpins['source'],
    room: number,
    rng: Rng,
    ids: IdSource = { next: 1 },
    startWilds: EpWild[] = []
): EpFreeSpins {
    const spins: EpFreeSpin[] = []
    let wilds = startWilds.map(w => ({ ...w }))
    let totalSpins = Math.min(awarded, FS_MAX_SPINS)
    let total = 0
    let capped = false

    for (let i = 0; i < totalSpins; i++) {
        const grid = drawGrid(FS_TABLE, rng, wilds)
        const spin = runTumbles(grid, wilds, FS_TABLE, bet, round4(room - total), ids, rng)
        total = round4(total + spin.win)
        if (total >= room) capped = true
        wilds = spin.wildsEnd

        let retrigger = 0
        if (!capped && spin.scatters.length >= FS_TRIGGER && totalSpins < FS_MAX_SPINS) {
            retrigger = Math.min(FS_RETRIGGER_SPINS, FS_MAX_SPINS - totalSpins)
            totalSpins += retrigger
        }
        spins.push({ ...spin, index: i, retrigger, totalSpins, runningTotal: total })
        if (capped) break
    }
    return { source, awarded, spins, total, capped }
}

// --- main entry -------------------------------------------------------------

/** A screen with exactly FS_TRIGGER scatters on random cells (feature buy). */
function buyGrid(rng: Rng): EpSymbol[][] {
    const grid = drawGrid(PLAIN_TABLE, rng)
    const cells: number[] = []
    for (let i = 0; i < EP_COLS * EP_ROWS; i++) cells.push(i)
    for (let i = 0; i < FS_TRIGGER; i++) {
        const j = i + Math.floor(rng() * (cells.length - i))
        const tmp = cells[i]!
        cells[i] = cells[j]!
        cells[j] = tmp
        grid[Math.floor(cells[i]! / EP_ROWS)]![cells[i]! % EP_ROWS] = 'scatter'
    }
    return grid
}

export function parseMode(options?: Record<string, unknown>): EpMode {
    if (options?.feature === 'buy') return 'buy'
    if (options?.ante === true) return 'ante'
    return 'normal'
}

export function modeCost(mode: EpMode, bet: number): number {
    if (mode === 'buy') return round4(bet * EP_BUY_COST)
    if (mode === 'ante') return round4(bet * EP_ANTE_COST)
    return bet
}

/** Same as playEmberPortals with an injectable random source (tests, sims). */
export function playEmberPortalsWith(bet: number, options: Record<string, unknown> | undefined, rng: Rng): EmberPortalsResult {
    if (!Number.isFinite(bet) || bet <= 0) {
        throw createError({ statusCode: 400, message: 'Invalid bet amount' })
    }

    const mode = parseMode(options)
    const cost = modeCost(mode, bet)
    const maxWin = bet * EP_MAX_WIN_MULT
    const t = mode === 'ante' ? ANTE_TABLE : BASE_TABLE
    const ids: IdSource = { next: 1 }

    const grid = mode === 'buy' ? buyGrid(rng) : drawGrid(t, rng)
    const base = runTumbles(grid, [], t, bet, maxWin, ids, rng)
    const basePayout = base.win

    // Scatters count on the settled screen; a buy always has its three.
    const scatterCount = Math.max(base.scatters.length, mode === 'buy' ? FS_TRIGGER : 0)
    const bonusTriggered = scatterCount >= FS_TRIGGER
    let freeSpins: EpFreeSpins | null = null
    let freeSpinsPayout = 0
    const room = round4(maxWin - basePayout)
    if (bonusTriggered && room > 0) {
        freeSpins = runFreeSpins(bet, fsAward(scatterCount), mode === 'buy' ? 'buy' : 'scatter', room, rng, ids, base.wildsEnd)
        freeSpinsPayout = freeSpins.total
    }

    const payout = round4(basePayout + freeSpinsPayout)
    return {
        bet,
        cost,
        mode,
        base,
        basePayout,
        freeSpins,
        freeSpinsPayout,
        bonusTriggered,
        payout,
        won: payout > cost,
        maxWin,
        capped: payout >= maxWin
    }
}

export function playEmberPortals(bet: number, options?: Record<string, unknown>): EmberPortalsResult {
    return playEmberPortalsWith(bet, options, randomFloat)
}
