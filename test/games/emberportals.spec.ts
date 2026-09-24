import { describe, it, expect } from 'vitest'
import {
    EP_ANTE_COST,
    EP_BRACKETS,
    EP_BUY_COST,
    EP_COLS,
    EP_MAX_WIN_MULT,
    EP_MIN_CLUSTER,
    EP_ROWS,
    EP_WILD_MAX_MULT,
    FS_AWARD,
    FS_MAX_SPINS,
    FS_TRIGGER,
    PAYTABLE,
    clusterPay,
    findClusters,
    fsAward,
    playEmberPortals,
    playEmberPortalsWith,
    runFreeSpins,
    type EmberPortalsResult,
    type EpSpin,
    type EpSymbol,
    type EpWild
} from '../../shared/utils/gamelogic/emberportals'

function mulberry32(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000

/** A checkerboard of ember/rune (no clusters) with some cells overridden. */
function gridOf(cells: [number, number, EpSymbol][]): EpSymbol[][] {
    const grid = Array.from({ length: EP_COLS }, (_, col) =>
        Array.from({ length: EP_ROWS }, (_, row): EpSymbol => ((col + row) % 2 ? 'ember' : 'rune')))
    for (const [col, row, sym] of cells) grid[col]![row] = sym
    return grid
}

function wildMap(wilds: EpWild[]) {
    return new Map(wilds.map(w => [w.col * EP_ROWS + w.row, w]))
}

/** Replays every tumble the way the client does and checks it lands on the next screen. */
function checkSpin(spin: EpSpin, bet: number) {
    let grid = spin.grid.map(c => c.slice())
    let wilds = spin.wildsStart
    for (const w of wilds) expect(grid[w.col]![w.row]).toBe('wild')
    let total = 0
    for (const t of spin.tumbles) {
        expect(t.grid).toEqual(grid)
        expect(t.clusters.length).toBeGreaterThan(0)
        const clusters = findClusters(grid, wildMap(wilds), bet)
        // The step that hits the max win scales its amounts down; the rest match exactly.
        const full = round4(clusters.reduce((a, c) => a + c.amount, 0))
        const capped = t.win < full - 1e-6
        const strip = (cs: typeof clusters) => cs.map(({ amount: _amount, ...c }) => c)
        expect(strip(t.clusters)).toEqual(strip(clusters))
        for (const c of t.clusters) {
            expect(c.size).toBeGreaterThanOrEqual(EP_MIN_CLUSTER)
            if (!capped) expect(c.amount).toBeCloseTo(clusterPay(c.symbol, c.size) * bet * c.mult, 3)
        }
        expect(t.win).toBeCloseTo(t.clusters.reduce((a, c) => a + c.amount, 0), 2)
        total = round4(total + t.win)

        // Portals: no two on one cell, all within the cap.
        const cells = new Set(t.wilds.map(w => `${w.col}:${w.row}`))
        expect(cells.size).toBe(t.wilds.length)
        for (const w of t.wilds) expect(w.mult).toBeLessThanOrEqual(EP_WILD_MAX_MULT)

        const next = grid.map(c => c.slice()) as (EpSymbol | null)[][]
        for (const r of t.removed) next[r.col]![r.row] = null
        const moved = t.falls.map(f => ({ ...f, symbol: grid[f.col]![f.from]! }))
        for (const f of moved) next[f.col]![f.from] = null
        for (const f of moved) {
            expect(f.to).toBeGreaterThan(f.from)
            next[f.col]![f.to] = f.symbol
        }
        for (const w of t.wilds) next[w.col]![w.row] = 'wild'
        for (const f of t.fresh) {
            expect(next[f.col]![f.row]).toBeNull()
            next[f.col]![f.row] = f.symbol
        }
        for (const col of next) for (const s of col) expect(s).not.toBeNull()
        grid = next as EpSymbol[][]
        wilds = t.wilds
    }
    expect(spin.finalGrid).toEqual(grid)
    expect(spin.wildsEnd).toEqual(wilds)
    expect(findClusters(grid, wildMap(wilds), bet).length === 0 || spin.win > 0).toBe(true)
    expect(spin.win).toBeCloseTo(total, 3)
}

function checkRound(r: EmberPortalsResult) {
    checkSpin(r.base, r.bet)
    expect(r.base.wildsStart).toEqual([])
    expect(r.payout).toBeCloseTo(round4(r.basePayout + r.freeSpinsPayout), 3)
    expect(r.payout).toBeLessThanOrEqual(r.maxWin + 1e-6)
    if (r.mode !== 'buy') expect(r.bonusTriggered).toBe(r.base.scatters.length >= FS_TRIGGER)
    if (r.freeSpins) {
        const fs = r.freeSpins
        let wilds: EpWild[] = []
        let total = 0
        for (const s of fs.spins) {
            // Portals carry over from one free spin to the next.
            expect(s.wildsStart).toEqual(wilds)
            checkSpin(s, r.bet)
            wilds = s.wildsEnd
            total = round4(total + s.win)
            expect(s.runningTotal).toBeCloseTo(total, 3)
        }
        expect(fs.total).toBeCloseTo(total, 3)
        expect(fs.spins.length).toBeLessThanOrEqual(FS_MAX_SPINS)
        const last = fs.spins[fs.spins.length - 1]!
        if (!fs.capped) expect(fs.spins.length).toBe(last.totalSpins)
    }
}

describe('playEmberPortals validation', () => {
    it('rejects bad bets', () => {
        expect(() => playEmberPortals(0)).toThrow()
        expect(() => playEmberPortals(-5)).toThrow()
        expect(() => playEmberPortals(Number.NaN)).toThrow()
        expect(() => playEmberPortals(Infinity)).toThrow()
    })

    it('charges by mode', () => {
        expect(playEmberPortals(10).cost).toBe(10)
        expect(playEmberPortals(10).maxWin).toBe(10 * EP_MAX_WIN_MULT)
        expect(playEmberPortals(10, { ante: true }).cost).toBeCloseTo(10 * EP_ANTE_COST, 6)
        expect(playEmberPortals(10, { feature: 'buy' }).cost).toBeCloseTo(10 * EP_BUY_COST, 6)
        // The buy wins over the ante; junk options are a normal spin.
        expect(playEmberPortals(10, { feature: 'buy', ante: true }).mode).toBe('buy')
        const junk = playEmberPortals(10, { feature: 'freeMoney', ante: 'yes' })
        expect(junk.mode).toBe('normal')
        expect(junk.cost).toBe(10)
    })
})

describe('PAYTABLE', () => {
    it('pays more for bigger clusters and higher symbols', () => {
        const rows = Object.values(PAYTABLE)
        for (const pays of rows) {
            expect(pays).toHaveLength(EP_BRACKETS.length)
            for (let i = 1; i < pays.length; i++) expect(pays[i]).toBeGreaterThan(pays[i - 1]!)
        }
        for (let s = 1; s < rows.length; s++) {
            for (let i = 0; i < EP_BRACKETS.length; i++) expect(rows[s]![i]).toBeGreaterThanOrEqual(rows[s - 1]![i]!)
        }
    })

    it('maps sizes to brackets', () => {
        expect(clusterPay('phoenix', 4)).toBe(0)
        expect(clusterPay('phoenix', 5)).toBe(PAYTABLE.phoenix[0])
        expect(clusterPay('phoenix', 12)).toBe(PAYTABLE.phoenix[6])
        expect(clusterPay('phoenix', 49)).toBe(PAYTABLE.phoenix[8])
    })

    it('awards free spins by scatter count', () => {
        expect(fsAward(2)).toBe(0)
        expect(fsAward(3)).toBe(FS_AWARD[0])
        expect(fsAward(7)).toBe(FS_AWARD[4])
        expect(fsAward(9)).toBe(FS_AWARD[4])
    })
})

describe('findClusters', () => {
    it('needs five connected cells', () => {
        const four = gridOf([[0, 0, 'phoenix'], [0, 1, 'phoenix'], [0, 2, 'phoenix'], [0, 3, 'phoenix']])
        expect(findClusters(four, new Map(), 1)).toEqual([])
        const five = gridOf([[0, 0, 'phoenix'], [0, 1, 'phoenix'], [0, 2, 'phoenix'], [0, 3, 'phoenix'], [1, 3, 'phoenix']])
        const [c] = findClusters(five, new Map(), 2)
        expect(c!.symbol).toBe('phoenix')
        expect(c!.size).toBe(5)
        expect(c!.mult).toBe(1)
        expect(c!.amount).toBeCloseTo(PAYTABLE.phoenix[0]! * 2, 6)
    })

    it('ignores diagonal neighbours', () => {
        const grid = gridOf([[0, 0, 'phoenix'], [1, 1, 'phoenix'], [2, 2, 'phoenix'], [3, 3, 'phoenix'], [4, 4, 'phoenix']])
        expect(findClusters(grid, new Map(), 1)).toEqual([])
    })

    it('lets one portal join clusters of different symbols', () => {
        const portal: EpWild = { id: 7, col: 3, row: 3, mult: 4 }
        const grid = gridOf([
            [0, 3, 'amulet'], [1, 3, 'amulet'], [2, 3, 'amulet'], [0, 4, 'amulet'], [3, 3, 'wild'],
            [3, 0, 'grimoire'], [3, 1, 'grimoire'], [3, 2, 'grimoire'], [3, 4, 'grimoire']
        ])
        const clusters = findClusters(grid, wildMap([portal]), 1)
        expect(clusters.map(c => c.symbol).sort()).toEqual(['amulet', 'grimoire'])
        for (const c of clusters) {
            expect(c.size).toBe(5)
            expect(c.wilds).toEqual([7])
            expect(c.amount).toBeCloseTo(PAYTABLE[c.symbol][0]! * 4, 6)
        }
    })

    it('multiplies by the sum of the portals in a cluster', () => {
        const a: EpWild = { id: 1, col: 0, row: 3, mult: 3 }
        const b: EpWild = { id: 2, col: 2, row: 3, mult: 5 }
        const grid = gridOf([[0, 3, 'wild'], [1, 3, 'chalice'], [2, 3, 'wild'], [3, 3, 'chalice'], [4, 3, 'chalice']])
        const [c] = findClusters(grid, wildMap([a, b]), 1)
        expect(c!.size).toBe(5)
        expect(c!.wilds.sort()).toEqual([1, 2])
        expect(c!.mult).toBe(8)
        expect(c!.amount).toBeCloseTo(PAYTABLE.chalice[0]! * 8, 6)
    })

    it('never pays a portal-only region', () => {
        const wilds = [0, 1, 2, 3, 4].map((row, i): EpWild => ({ id: i + 1, col: 6, row, mult: 1 }))
        // Portals alone form a line of five; the checkerboard around them has no symbol with 5 cells.
        const grid = gridOf(wilds.map(w => [w.col, w.row, 'wild'] as [number, number, EpSymbol]))
        for (const c of findClusters(grid, wildMap(wilds), 1)) {
            expect(c.cells.some(cell => grid[cell.col]![cell.row] === c.symbol)).toBe(true)
        }
    })
})

describe('rounds replay consistently', () => {
    it('holds for seeded normal, ante and buy rounds', () => {
        const rng = mulberry32(1234)
        let bonuses = 0
        let tumbles = 0
        for (let i = 0; i < 300; i++) {
            const opts = i % 3 === 0 ? undefined : i % 3 === 1 ? { ante: true } : { feature: 'buy' }
            const r = playEmberPortalsWith(5, opts, rng)
            checkRound(r)
            if (r.freeSpins) bonuses++
            tumbles += r.base.tumbles.length
        }
        expect(bonuses).toBeGreaterThan(80)
        expect(tumbles).toBeGreaterThan(40)
    })

    it('opens a portal on every portal-less win and grows the ones that win', () => {
        const rng = mulberry32(99)
        let spawns = 0
        let grows = 0
        let merges = 0
        for (let i = 0; i < 80; i++) {
            const r = playEmberPortalsWith(1, { feature: 'buy' }, rng)
            for (const s of r.freeSpins!.spins) {
                let prevWilds = s.wildsStart
                for (const t of s.tumbles) {
                    for (const ch of t.wildChanges) {
                        if (ch.kind === 'grow' && ch.merged.length) {
                            // Merges multiply, and never give less than sum + 1.
                            const before = new Map([...prevWilds].map(w => [w.id, w.mult]))
                            const mults = [ch.id, ...ch.merged].map(id => before.get(id)!)
                            const product = mults.reduce((a, m) => a * m, 1)
                            const sum = mults.reduce((a, m) => a + m, 0)
                            expect(ch.mult).toBe(Math.min(EP_WILD_MAX_MULT, Math.max(product, sum + 1)))
                            merges++
                        }
                        if (ch.kind === 'spawn') {
                            spawns++
                            expect(ch.mult).toBe(1)
                        } else {
                            grows++
                            expect(ch.mult).toBe(Math.min(EP_WILD_MAX_MULT, ch.mult))
                            expect(ch.mult).toBeGreaterThan(ch.prevMult)
                        }
                        // The portal lands inside one of the step's clusters.
                        expect(t.clusters.some(c => c.cells.some(cell => cell.col === ch.to.col && cell.row === ch.to.row))).toBe(true)
                    }
                    prevWilds = t.wilds
                }
            }
        }
        expect(spawns).toBeGreaterThan(0)
        expect(grows).toBeGreaterThan(0)
        expect(merges).toBeGreaterThan(0)
    })

    it('stops free spins at the max win and keeps cluster amounts consistent', () => {
        // A tiny room makes the first paying step hit the cap.
        const fs = runFreeSpins(1, 10, 'buy', 0.5, mulberry32(5))
        expect(fs.capped).toBe(true)
        expect(fs.total).toBeCloseTo(0.5, 6)
        const last = fs.spins[fs.spins.length - 1]!
        expect(last.retrigger).toBe(0)
        const step = last.tumbles[last.tumbles.length - 1]!
        expect(step.win).toBeCloseTo(step.clusters.reduce((a, c) => a + c.amount, 0), 3)
        expect(fs.spins.reduce((a, s) => a + s.win, 0)).toBeCloseTo(0.5, 6)
    })
})
