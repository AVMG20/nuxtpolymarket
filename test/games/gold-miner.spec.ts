import { describe, expect, it } from 'vitest'
import {
    GM_CASH_PER_STAKE,
    GM_ITEMS,
    GM_LEVEL_MS,
    GM_NO_PERKS,
    GM_SHOOT_SPEED,
    GM_TNT_RADIUS,
    gmBagOutcome,
    gmGenerateLevel,
    gmGoal,
    gmHash,
    gmLevelSeed,
    gmThinChance,
    gmVeinRoll,
    GM_VEINS,
    gmItemValue,
    gmPayout,
    gmReachDistance,
    gmReachable,
    gmReelSpeed,
    gmScoreLevel,
    gmShopOffers,
    gmTntBlast,
    type GmGrab,
    type GmItem,
    type GmLevel,
    type GmPerks
} from '#shared/utils/gamelogic/gold-miner'

/** Ideal seconds for one pull: out to the item and back up with it. */
function pullMs(item: GmItem, strong = false) {
    const d = gmReachDistance(item)
    return (d / GM_SHOOT_SPEED + d / gmReelSpeed(item.kind, strong)) * 1000
}

/** A timeline a flawless player could produce: every pull back to back at its ideal speed. */
function perfectGrabs(level: GmLevel, pick: (i: GmItem) => boolean): GmGrab[] {
    const grabs: GmGrab[] = []
    let at = 0
    for (const item of level.items.filter(pick)) {
        const next = at + Math.ceil(pullMs(item))
        if (next > GM_LEVEL_MS) break
        at = next
        grabs.push({ id: item.id, at })
    }
    return grabs
}

const noBag = () => ({ kind: 'cash' as const, amount: 0 })

function score(level: GmLevel, grabs: GmGrab[], perks: GmPerks = GM_NO_PERKS, dynamite = 0) {
    return gmScoreLevel({ level, grabs, perks, dynamite, bag: noBag })
}

describe('goals', () => {
    it('asks for a fresh haul on every level', () => {
        expect([1, 2, 3, 4, 5, 6].map(gmGoal)).toEqual([600, 900, 1200, 1500, 1800, 2100])
    })

    it('always asks for more than the level before', () => {
        for (let l = 2; l < 40; l++) expect(gmGoal(l)).toBeGreaterThan(gmGoal(l - 1))
    })
})

describe('payout', () => {
    it('converts cash to coins at the published rate', () => {
        expect(gmPayout(1000, GM_CASH_PER_STAKE)).toBe(1000)
        expect(gmPayout(1000, GM_CASH_PER_STAKE / 4)).toBe(250)
        expect(gmPayout(1000, 0)).toBe(0)
        expect(gmPayout(0, 5000)).toBe(0)
    })

    it('makes cashing out straight after level 1 a loss', () => {
        expect(gmPayout(1000, gmGoal(1) * 2)).toBeLessThan(1000)
    })
})

describe('level generation', () => {
    it('is deterministic per seed and level', () => {
        expect(gmGenerateLevel(42, 3)).toEqual(gmGenerateLevel(42, 3))
        expect(gmGenerateLevel(42, 3)).not.toEqual(gmGenerateLevel(43, 3))
    })

    it('only places items the claw can reach, with none overlapping', () => {
        for (let seed = 1; seed <= 60; seed++) {
            for (const lvl of [1, 3, 6, 10]) {
                const level = gmGenerateLevel(seed * 977, lvl)
                const ids = new Set(level.items.map(i => i.id))
                expect(ids.size).toBe(level.items.length)
                for (const a of level.items) {
                    if (!a.mole) expect(gmReachable(a.x, a.y, 0), `${seed}/${lvl}/${a.id}`).toBe(true)
                    for (const b of level.items) {
                        if (a === b || a.mole || b.mole) continue
                        const d = Math.hypot(a.x - b.x, a.y - b.y)
                        expect(d).toBeGreaterThanOrEqual(GM_ITEMS[a.kind].r + GM_ITEMS[b.kind].r)
                    }
                }
            }
        }
    })

    it('always puts at least the goal on the board, even in a thin vein', () => {
        for (let seed = 1; seed <= 150; seed++) {
            for (const lvl of [1, 2, 4, 8, 12]) {
                const level = gmGenerateLevel(seed * 31, lvl)
                const value = level.items.reduce((s, i) => s + gmItemValue(i.kind, GM_NO_PERKS), 0)
                expect(value, `${seed}/${lvl} ${level.vein}`).toBeGreaterThan(gmGoal(lvl))
            }
        }
    })

    it('lets a flawless player clear level 1 in a steady or rich vein', () => {
        let checked = 0
        for (let seed = 1; checked < 40; seed++) {
            const level = gmGenerateLevel(seed, 1)
            if (level.vein === 'thin') continue
            checked++
            const grabs = perfectGrabs(level, i => GM_ITEMS[i.kind].value >= 50 && i.kind !== 'tnt')
            const result = score(level, grabs)
            expect(result.ok).toBe(true)
            if (result.ok) expect(result.earned, `seed ${seed}`).toBeGreaterThanOrEqual(gmGoal(1))
        }
    })
})

describe('veins', () => {
    it('rolls every vein at roughly its published odds', () => {
        const counts = { thin: 0, steady: 0, rich: 0 }
        const n = 4000
        for (let seed = 1; seed <= n; seed++) counts[gmVeinRoll(gmHash(seed, 9), 5).vein]++
        expect(counts.thin / n).toBeCloseTo(gmThinChance(5), 1)
        expect(counts.rich / n).toBeCloseTo(GM_VEINS.rich.chance, 1)
    })

    it('thins out deeper down, and is gentle on level 1', () => {
        expect(gmThinChance(1)).toBeLessThan(gmThinChance(2))
        for (let l = 3; l < 30; l++) expect(gmThinChance(l)).toBeGreaterThanOrEqual(gmThinChance(l - 1))
        expect(gmThinChance(99)).toBeLessThanOrEqual(0.55)
    })

    it('puts more gold on a richer vein', () => {
        const value = (l: ReturnType<typeof gmGenerateLevel>) => l.items.reduce((s, i) => s + gmItemValue(i.kind, GM_NO_PERKS), 0)
        const by = { thin: [] as number[], rich: [] as number[] }
        for (let seed = 1; seed < 600; seed++) {
            const level = gmGenerateLevel(seed, 6)
            if (level.vein !== 'steady') by[level.vein].push(value(level))
        }
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
        expect(avg(by.rich)).toBeGreaterThan(avg(by.thin) * 1.5)
    })

    it('keys each level off the secret, so the next board cannot be read ahead', () => {
        expect(gmLevelSeed(1234, 2)).not.toBe(gmLevelSeed(1234, 3))
        expect(gmLevelSeed(1234, 2)).not.toBe(gmLevelSeed(1235, 2))
    })
})

describe('scoring a report', () => {
    const level = gmGenerateLevel(1234, 4)
    const gold = level.items.filter(i => i.kind === 'goldM' || i.kind === 'goldS')

    it('accepts a physically possible run and totals it', () => {
        const grabs = perfectGrabs(level, i => i.kind === 'goldM' || i.kind === 'goldS')
        const result = score(level, grabs)
        expect(result).toMatchObject({ ok: true, collected: grabs.length })
        if (result.ok) {
            expect(result.earned).toBe(grabs.reduce((s, g) => s + GM_ITEMS[level.items.find(i => i.id === g.id)!.kind].value, 0))
        }
    })

    it('rejects a pull faster than the winch', () => {
        const item = gold[0]!
        expect(score(level, [{ id: item.id, at: Math.floor(pullMs(item) * 0.5) }])).toMatchObject({ ok: false })
    })

    it('rejects the same item twice, unknown items, and grabs out of order or past the clock', () => {
        const [a, b] = gold
        expect(score(level, [{ id: a!.id, at: 5000 }, { id: a!.id, at: 10_000 }])).toMatchObject({ ok: false })
        expect(score(level, [{ id: 9999, at: 5000 }])).toMatchObject({ ok: false })
        expect(score(level, [{ id: a!.id, at: 20_000 }, { id: b!.id, at: 10_000 }])).toMatchObject({ ok: false })
        expect(score(level, [{ id: a!.id, at: GM_LEVEL_MS + 1 }])).toMatchObject({ ok: false })
    })

    it('needs dynamite to blow a load, and pays nothing for it', () => {
        const item = gold[0]!
        expect(score(level, [{ id: item.id, at: 5000, blown: true }])).toMatchObject({ ok: false })
        expect(score(level, [{ id: item.id, at: 5000, blown: true }], GM_NO_PERKS, 2)).toMatchObject({ ok: true, earned: 0, dynamite: 1 })
    })

    it('lets strength pull faster, and not without it', () => {
        const heavy = gmGenerateLevel(7, 1).items.find(i => i.kind === 'goldXL')!
        const lvl = gmGenerateLevel(7, 1)
        const at = Math.ceil(pullMs(heavy, true))
        expect(score(lvl, [{ id: heavy.id, at }])).toMatchObject({ ok: false })
        expect(score(lvl, [{ id: heavy.id, at }], { ...GM_NO_PERKS, strength: true })).toMatchObject({ ok: true, earned: 500 })
    })

    it('applies the rock book and diamond polish', () => {
        expect(gmItemValue('rockL', { book: true, polish: false })).toBe(60)
        expect(gmItemValue('diamond', { book: false, polish: true })).toBe(900)
        expect(gmItemValue('moleDiamond', { book: false, polish: true })).toBe(902)
    })
})

describe('TNT', () => {
    it('destroys its neighbours, which then cannot be reported', () => {
        for (let seed = 1; seed < 200; seed++) {
            const level = gmGenerateLevel(seed, 6)
            const tnt = level.items.find(i => i.kind === 'tnt')
            if (!tnt) continue
            const destroyed = gmTntBlast(level, tnt.id, new Set())
            const victim = destroyed.map(id => level.items.find(i => i.id === id)!).find(i => i.kind !== 'tnt')
            if (!victim) continue
            expect(Math.hypot(victim.x - tnt.x, victim.y - tnt.y)).toBeLessThanOrEqual(GM_TNT_RADIUS)
            const at = Math.ceil(pullMs(tnt))
            const result = score(level, [{ id: tnt.id, at }, { id: victim.id, at: at + 20_000 }])
            expect(result).toMatchObject({ ok: false, reason: 'Item already taken' })
            return
        }
        throw new Error('no level with TNT next to something')
    })
})

describe('bags and shop', () => {
    it('are deterministic off the secret', () => {
        expect(gmBagOutcome(99, 2, 5, false)).toEqual(gmBagOutcome(99, 2, 5, false))
        expect(gmShopOffers(99, 2)).toEqual(gmShopOffers(99, 2))
    })

    it('rolls better bags with the clover', () => {
        let plain = 0
        let lucky = 0
        for (let id = 0; id < 2000; id++) {
            const a = gmBagOutcome(5, 1, id, false)
            const b = gmBagOutcome(5, 1, id, true)
            if (a.kind === 'cash') plain += a.amount
            if (b.kind === 'cash') lucky += b.amount
        }
        expect(lucky).toBeGreaterThan(plain * 2)
    })

    it('always stocks something, at a positive price', () => {
        for (let lvl = 1; lvl < 20; lvl++) {
            const offers = gmShopOffers(lvl * 17, lvl)
            expect(offers.length).toBeGreaterThan(0)
            for (const o of offers) expect(o.price).toBeGreaterThan(0)
        }
    })
})
