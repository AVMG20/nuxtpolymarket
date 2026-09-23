import { describe, it, expect } from 'vitest'
import {
    DIVE_BINS,
    DIVE_REELS,
    FS_AWARD,
    FS_MAX_SPINS,
    PAYTABLE,
    TPH_BUY_DIVE_COST,
    TPH_BUY_FREE_SPINS_COST,
    TPH_COLS,
    TPH_MAX_WIN_MULT,
    TPH_ROWS,
    evaluateWays,
    playTrashPanda,
    playTrashPandaWith,
    runFreeSpins,
    type TphSymbol,
    type TrashPandaResult
} from '../../shared/utils/gamelogic/trashpanda'

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

/** A grid of one filler symbol with some cells overridden. */
function gridOf(fill: TphSymbol, cells: [number, number, TphSymbol][]): TphSymbol[][] {
    const grid = Array.from({ length: TPH_COLS }, () => Array.from({ length: TPH_ROWS }, () => fill))
    for (const [col, row, sym] of cells) grid[col]![row] = sym
    return grid
}

function checkRound(r: TrashPandaResult) {
    expect(r.grid).toHaveLength(TPH_COLS)
    for (const col of r.grid) expect(col).toHaveLength(TPH_ROWS)
    expect(r.payout).toBeCloseTo(round4(r.basePayout + r.divePayout + r.freeSpinsPayout), 3)
    expect(r.payout).toBeLessThanOrEqual(r.maxWin + 1e-6)
    expect(r.basePayout).toBeCloseTo(r.wins.reduce((a, w) => a + w.amount, 0), 3)
    // No wild on the first reel, dumpsters only on reels 1, 3 and 5.
    expect(r.grid[0]).not.toContain('wild')
    for (let col = 0; col < TPH_COLS; col++) {
        if (!(DIVE_REELS as readonly number[]).includes(col)) expect(r.grid[col]).not.toContain('bin')
    }
    if (r.dive) {
        const d = r.dive
        expect(d.picks.length + d.leftovers.length).toBe(DIVE_BINS)
        expect(d.total).toBeCloseTo(d.pot * r.bet, 3)
        const last = d.picks[d.picks.length - 1]!
        if (!d.cleared) expect(last.item.kind === 'dog' && !last.ateDonut).toBe(true)
        // Nothing but the final pick ends the dive.
        for (const p of d.picks.slice(0, -1)) expect(p.item.kind === 'dog' && !p.ateDonut).toBe(false)
        expect(d.keyFound).toBe(d.picks.some(p => p.item.kind === 'key'))
    }
    if (r.freeSpins) {
        const fs = r.freeSpins
        let prev = new Set<string>()
        let total = 0
        for (const s of fs.spins) {
            const now = new Set(s.sticky.map(w => `${w.col}:${w.row}`))
            // Sticky wilds never leave.
            for (const k of prev) expect(now.has(k)).toBe(true)
            for (const w of s.sticky) expect(s.grid[w.col]![w.row]).toBe('wild')
            expect(s.grid[0]).not.toContain('wild')
            total = round4(total + s.win)
            expect(s.runningTotal).toBeCloseTo(total, 3)
            prev = now
        }
        expect(fs.total).toBeCloseTo(total, 3)
        expect(r.freeSpinsPayout).toBeCloseTo(fs.total, 3)
        const last = fs.spins[fs.spins.length - 1]!
        if (!fs.capped) expect(fs.spins.length).toBe(last.totalSpins)
        expect(fs.spins.length).toBeLessThanOrEqual(FS_MAX_SPINS)
    }
}

describe('playTrashPanda validation', () => {
    it('rejects bad bets', () => {
        expect(() => playTrashPanda(0)).toThrow()
        expect(() => playTrashPanda(-5)).toThrow()
        expect(() => playTrashPanda(Number.NaN)).toThrow()
        expect(() => playTrashPanda(Infinity)).toThrow()
    })

    it('ignores unknown options and charges the bet', () => {
        const r = playTrashPanda(10, { feature: 'freeMoney', buyBonus: true })
        expect(r.cost).toBe(10)
        expect(r.feature).toBeNull()
    })
})

describe('PAYTABLE', () => {
    it('pays more for longer wins', () => {
        for (const pays of Object.values(PAYTABLE)) {
            expect(pays[0]).toBeLessThan(pays[1])
            expect(pays[1]).toBeLessThan(pays[2])
        }
    })
})

describe('evaluateWays', () => {
    it('multiplies ways across reels', () => {
        // Boss: 1 on reel 1, 2 on reel 2, 1 on reel 3 -> 2 ways of 3.
        const grid = gridOf('fish', [[0, 0, 'boss'], [1, 0, 'boss'], [1, 3, 'boss'], [2, 2, 'boss']])
        const boss = evaluateWays(grid, 10).find(w => w.symbol === 'boss')!
        expect(boss.length).toBe(3)
        expect(boss.ways).toBe(2)
        expect(boss.amount).toBeCloseTo(PAYTABLE.boss[0] * 2 * 10, 6)
        expect(boss.cells).toHaveLength(4)
    })

    it('lets wilds extend a win but never start one', () => {
        const grid = gridOf('banana', [[0, 0, 'gem'], [1, 1, 'wild'], [2, 2, 'gem'], [3, 3, 'wild']])
        const gem = evaluateWays(grid, 1).find(w => w.symbol === 'gem')!
        expect(gem.length).toBe(4)
        expect(gem.ways).toBe(1)
        // A wild on reel 1 alone (no symbol) starts nothing.
        const none = evaluateWays(gridOf('fish', [[1, 0, 'wild'], [2, 0, 'wild'], [3, 0, 'wild']]), 1)
        expect(none.every(w => w.symbol === 'fish')).toBe(true)
    })

    it('adds wild multipliers together on each way', () => {
        // Reel 1: pizza. Reel 2: pizza + wild×2. Reel 3: wild×3. Everything else: fish.
        const grid = gridOf('fish', [[0, 0, 'pizza'], [1, 0, 'pizza'], [1, 1, 'wild'], [2, 0, 'wild']])
        const mults = new Map([['1:1', 2], ['2:0', 3]])
        const pizza = evaluateWays(grid, 1, mults).find(w => w.symbol === 'pizza')!
        // Ways: 1 × 2 × 1 = 2. Way A (pizza, pizza, wild×3) = ×3; way B (pizza, wild×2, wild×3) = ×5.
        expect(pizza.ways).toBe(2)
        expect(pizza.weight).toBe(8)
        expect(pizza.amount).toBeCloseTo(PAYTABLE.pizza[0] * 8, 6)
    })
})

describe('structural invariants (seeded)', () => {
    it('holds for natural spins', () => {
        const rng = mulberry32(1234)
        let dives = 0
        let fs = 0
        for (let i = 0; i < 10_000; i++) {
            const r = playTrashPandaWith(3, undefined, rng)
            checkRound(r)
            expect(r.cost).toBe(3)
            if (r.dive) dives++
            if (r.freeSpins) fs++
            if (r.scatters.length >= 3) expect(r.freeSpins?.awarded).toBeGreaterThanOrEqual(FS_AWARD[3])
        }
        expect(dives).toBeGreaterThan(50)
        expect(fs).toBeGreaterThan(15)
    })

    it('holds for both bonus buys', () => {
        const rng = mulberry32(99)
        for (let i = 0; i < 600; i++) {
            const a = playTrashPandaWith(2, { feature: 'buyFreeSpins' }, rng)
            checkRound(a)
            expect(a.cost).toBeCloseTo(2 * TPH_BUY_FREE_SPINS_COST, 6)
            expect(a.freeSpins?.source).toBe('buy')
            expect(a.freeSpins?.awarded).toBe(FS_AWARD[3])
            expect(a.dive).toBeNull()

            const b = playTrashPandaWith(2, { feature: 'buyDive' }, rng)
            checkRound(b)
            expect(b.cost).toBeCloseTo(2 * TPH_BUY_DIVE_COST, 6)
            expect(b.dive).not.toBeNull()
            expect(b.scatters.length).toBe(0)
        }
    })

    it('is deterministic for a given seed', () => {
        const a = Array.from({ length: 300 }, (_, i) => playTrashPandaWith(1, i % 3 ? undefined : { feature: 'buyFreeSpins' }, mulberry32(42 + i)))
        const b = Array.from({ length: 300 }, (_, i) => playTrashPandaWith(1, i % 3 ? undefined : { feature: 'buyFreeSpins' }, mulberry32(42 + i)))
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('stops free spins once the max win is reached', () => {
        const rng = mulberry32(7)
        let capped = 0
        for (let n = 0; n < 300; n++) {
            const fs = runFreeSpins(1, 12, 'buy', 3, rng)
            expect(fs.total).toBeLessThanOrEqual(3)
            if (fs.capped) {
                capped++
                expect(fs.total).toBeCloseTo(3, 6)
                expect(fs.spins[fs.spins.length - 1]!.runningTotal).toBeCloseTo(3, 6)
            }
        }
        expect(capped).toBeGreaterThan(50)
    })

    it('never pays more than the max win', () => {
        const rng = mulberry32(5)
        for (let n = 0; n < 3000; n++) {
            const r = playTrashPandaWith(1, { feature: 'buyFreeSpins' }, rng)
            expect(r.payout).toBeLessThanOrEqual(TPH_MAX_WIN_MULT)
        }
    })
})

describe('RTP sanity (seeded Monte Carlo)', () => {
    it('lands near the tuned split', () => {
        const rng = mulberry32(2026)
        const rounds = 300_000
        let cost = 0
        let pay = 0
        let base = 0
        for (let i = 0; i < rounds; i++) {
            const r = playTrashPandaWith(1, undefined, rng)
            cost += r.cost
            pay += r.payout
            base += r.basePayout
        }
        // The full figure is measured with scripts/slot-rtp.ts over 20M spins
        // (97.4%); the band here only catches a broken table or feature.
        expect(pay / cost).toBeGreaterThan(0.85)
        expect(pay / cost).toBeLessThan(1.1)
        expect(base / cost).toBeGreaterThan(0.29)
        expect(base / cost).toBeLessThan(0.34)
    })
})
