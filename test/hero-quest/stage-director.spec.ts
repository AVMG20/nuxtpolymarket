/**
 * The battle stage's schedule: when a body drops and what the numbers on it say.
 *
 * The stage is presentation, but it shows real figures, so the claims worth pinning are the
 * honest ones: a body only drops once the projected run has killed it, its numbers add up to its
 * real HP, and a crit is worth the real crit multiplier against a normal hit.
 */

import { describe, expect, it } from 'vitest'
import { RunDirector, stageNumber, type RunFeed } from '../../app/utils/hero-quest-art/run-director'
import { D, ZERO } from '../../shared/utils/hero-quest/numbers'

const FEED: RunFeed = {
    prestige: 0,
    world: 2,
    stage: 3,
    archetype: 'wave',
    killsFloat: 0,
    killsRequired: 30,
    packSize: 6,
    atBossGate: false,
    farming: false,
    walled: false,
    recoverySeconds: 0,
    enemyHp: '1840',
    secondsPerKill: 2,
    critChance: 0.25,
    critMultiplier: '2.5',
    heroHpPct: 100,
    heroLevel: 12,
    gpn: '1000'
}

function director(feed: Partial<RunFeed> = {}): RunDirector {
    const r = new RunDirector()
    r.sync({ ...FEED, ...feed }, 0)
    return r
}

describe('stageNumber', () => {
    it.each([
        ['0.4', '1'],
        ['7', '7'],
        ['999', '999'],
        ['1840', '1.84K'],
        ['99999', '100K'],
        ['123456', '123K'],
        ['999999', '1.00M'],
        ['9.999e14', '1.00E15'],
        ['2.4e15', '2.40E15'],
        ['2.407e18', '2.41E18']
    ])('prints %s as %s', (value, text) => {
        expect(stageNumber(D(value))).toBe(text)
    })

    it('uses only what the number fonts can draw', () => {
        for (const v of ['3', '4.2e3', '5.5e6', '6.6e9', '7.7e12', '8.8e15', '1e300']) {
            expect(stageNumber(D(v))).toMatch(/^[0-9.KMBTE]+$/)
        }
    })
})

describe('RunDirector', () => {
    it('drops a body only once the run has killed it', () => {
        const r = director()
        expect(r.due()).toBe(0)
        r.sync({ ...FEED, killsFloat: 0.99 }, 6)
        expect(r.due()).toBe(0)
        r.sync({ ...FEED, killsFloat: 1.01 }, 6)
        expect(r.due()).toBe(1)
        r.finish()
        expect(r.due()).toBe(0)
    })

    it('shows numbers on a body that add up to exactly its HP', () => {
        const r = director()
        let sum = ZERO
        for (let i = 0; i < 40; i++) {
            if (r.hit(i % 3 === 0) !== null) sum = sum.add(r.last)
        }
        r.sync({ ...FEED, killsFloat: 1 }, 6)
        r.finish()
        sum = sum.add(r.last)
        expect(sum.sub(1840).abs().lt(1e-6)).toBe(true)
    })

    it('never brings a body to nothing before its kill', () => {
        const r = director()
        let sum = ZERO
        for (let i = 0; i < 500; i++) if (r.hit(true) !== null) sum = sum.add(r.last)
        expect(sum.lt(1840)).toBe(true)
        expect(sum.gte(1840 * 0.89)).toBe(true)
    })

    it('makes a crit worth the real crit multiplier against a normal hit', () => {
        const r = director({ enemyHp: '1e12' })
        r.hit(false)
        const normal = r.last
        r.hit(true)
        expect(r.last.div(normal).toNumber()).toBeCloseTo(2.5, 6)
    })

    it('sizes hits to the real kill time, crit-averaged as settle does', () => {
        // 2 s a kill at the opening 2 hits a second is 4 hits; crit-averaged 1 + 0.25 × 1.5
        const r = director({ enemyHp: '1e12' })
        r.hit(false)
        expect(r.last.toNumber()).toBeCloseTo(1e12 / (4 * 1.375), -3)
    })

    it('carries the last body of a cleared stage under the next, at the old HP', () => {
        const r = director()
        r.sync({ ...FEED, killsFloat: 29.6 }, 1)
        r.sync({ ...FEED, stage: 4, enemyHp: '2000', killsFloat: 0.1 }, 1)
        expect(r.due()).toBe(1)
        expect(r.finish()).toBe('1.84K')
        expect(r.due()).toBe(0)
    })

    it('carries what the screen still owes a cleared stage, not the pack standing', () => {
        const r = director({ killsFloat: 26.4 })
        // the stage clears while a fresh pack of six marches in: four of the old stage's kills are still to show
        r.sync({ ...FEED, stage: 4, killsFloat: 0.3 }, 6)
        expect(r.visible()).toEqual({ kills: 26, required: 30 })
        expect(r.due()).toBe(4)
    })

    it('drops a boss and its escort without numbers once their fight is won', () => {
        const r = director({ stage: 5, archetype: 'boss', atBossGate: true, packSize: 3 })
        expect(r.due()).toBe(0)
        r.sync({ ...FEED, stage: 6, archetype: 'elite' }, 3)
        expect(r.due()).toBe(3)
        expect(r.finish()).toBeNull()
        expect(r.hit(false)).toBeNull()
    })

    it('holds everything at a gate', () => {
        const r = director({ stage: 5, archetype: 'boss', atBossGate: true, killsFloat: 4 })
        expect(r.due()).toBe(0)
    })

    it('reads a walled attempt restarting as a wipe, and a small rewind as nothing', () => {
        const r = director({ walled: true, killsFloat: 6.8 })
        expect(r.sync({ ...FEED, walled: true, killsFloat: 6.5 }, 6)).toBe('same')
        expect(r.sync({ ...FEED, walled: true, killsFloat: 0.2 }, 6)).toBe('wipe')
        expect(r.due()).toBe(0)
    })

    it('rebuilds rather than replays a jump: a new world, stages skipped, two packs ahead', () => {
        expect(director().sync({ ...FEED, world: 3 }, 6)).toBe('reset')
        expect(director().sync({ ...FEED, stage: 6 }, 6)).toBe('reset')
        const r = director()
        expect(r.sync({ ...FEED, killsFloat: 20 }, 6)).toBe('reset')
        expect(r.due()).toBe(0)
    })

    it('owes the kills a march at the kill floor falls behind by, rather than skipping them', () => {
        const r = director()
        expect(r.sync({ ...FEED, killsFloat: 9.4 }, 6)).toBe('same')
        expect(r.due()).toBe(9)
        expect(r.visible().kills).toBe(0)
    })
})

describe('the stage progress the screen shows', () => {
    it('counts the bodies the stage has dropped, not the kills the run has projected', () => {
        const r = director({ killsFloat: 4 })
        // the run moves on three kills; the stage has dropped none of them yet
        r.sync({ ...FEED, killsFloat: 7 }, 6)
        expect(r.visible()).toEqual({ kills: 4, required: 30 })
        r.finish()
        expect(r.visible().kills).toBe(5)
    })

    it('fills by the share of the front body the hits on screen have taken', () => {
        const r = director({ killsFloat: 2 })
        r.sync({ ...FEED, killsFloat: 2.6 }, 6)
        r.hit(false)
        const { kills } = r.visible()
        expect(kills).toBeGreaterThan(2)
        expect(kills).toBeLessThan(3)
    })

    it('stays on the cleared stage while its last bodies are still going down', () => {
        const r = director({ killsFloat: 29.5 })
        expect(r.sync({ ...FEED, stage: FEED.stage + 1, killsFloat: 0.2 }, 2)).toBe('advance')
        // 29 shown, so one body is the old stage's; the other standing is the new stage's
        expect(r.visible()).toEqual({ kills: 29, required: 30 })
        r.finish()
        expect(r.visible()).toEqual({ kills: 0, required: 30 })
    })
})

describe('farming in front of a lost boss', () => {
    it('keeps bodies coming at the run rate while the run itself stands at the gate', () => {
        const r = director({ killsFloat: 30 })
        r.sync({ ...FEED, killsFloat: 30, farming: true }, 0)
        while (r.due() > 0) r.finish()
        for (let i = 0; i < 60 * 6.5; i++) {
            r.tick(1 / 60)
            r.sync({ ...FEED, killsFloat: 30, farming: true }, 0)
        }
        // six and a half seconds at two a kill: three whole bodies
        expect(r.due()).toBe(3)
    })
})
