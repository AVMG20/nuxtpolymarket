import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { MeadowbrawlGame } from '../../app/utils/meadowbrawl/engine'
import { TOTAL_WAVES } from '../../app/utils/meadowbrawl/types'

/**
 * A crude bot plays a whole run: walk at the nearest enemy, swing when close,
 * use the special when it's up, roll away from telegraphs. It cannot lose
 * (health is topped up) — the point is that every wave clears, the numbers
 * stay finite, and the pacing lands in the intended band.
 */
describe('a full run', () => {
    it('clears all thirty waves without anything going non-finite', () => {
        const g = new MeadowbrawlGame()
        g.startRun('sword')
        const dt = 1 / 60
        const waveTimes: number[] = []
        let waveStart = 0
        let lastWave = g.wave
        let simulated = 0
        let guard = 0
        const eliteIds = new Set<number>()

        while (g.phase !== 'victory' && guard++ < 60 * 60 * 60) {
            const p = g.player
            // Unkillable on purpose: this asserts the loop runs to the end and
            // stays finite, not that a wave-30 ogre is survivable.
            p.maxHp = 1e6
            p.hp = p.maxHp
            if (g.phase === 'upgrade') {
                // Prefer damage so the run keeps pace with the scaling.
                const i = g.offers.findIndex(o => o.upgrade.id === 'might' || o.upgrade.rarity === 'epic')
                g.chooseOffer(i >= 0 ? i : 0)
                continue
            }
            if (g.wave !== lastWave) {
                waveTimes.push(simulated - waveStart)
                waveStart = simulated
                lastWave = g.wave
            }
            let best = null as (typeof g.enemies)[number] | null
            let bd = Infinity
            let threat = false
            for (const e of g.enemies) {
                if (!e.alive) continue
                const d = Math.hypot(e.x - p.x, e.y - p.y)
                if (d < bd) {
                    bd = d
                    best = e
                }
                if (e.state === 'windup' && e.attack && d < 160 && e.stateT / e.attack.windup > 0.6) threat = true
            }
            if (best) {
                g.input.aimX = best.x
                g.input.aimY = best.y
                const dx = best.x - p.x
                const dy = best.y - p.y
                const l = Math.hypot(dx, dy) || 1
                g.input.moveX = bd > 50 ? dx / l : 0
                g.input.moveY = bd > 50 ? dy / l : 0
                if (bd < 110) g.input.attackPressed = true
                if (bd < 160 && p.specialCd <= 0) g.input.specialPressed = true
                if (threat && p.dodgeCharges > 0 && !p.dodge) {
                    g.input.moveX = -dx / l
                    g.input.moveY = -dy / l
                    g.input.spacePressed = true
                    g.input.spaceDown = true
                    g.update(dt)
                    simulated += dt
                    g.input.spaceReleased = true
                    g.input.spaceDown = false
                }
            } else {
                g.input.moveX = 0
                g.input.moveY = 0
            }
            g.update(dt)
            simulated += dt
            for (const e of g.enemies) if (e.def.elite) eliteIds.add(e.id)
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        }
        waveTimes.push(simulated - waveStart)

        if (process.env.MB_DUMP) writeFileSync(process.env.MB_DUMP, JSON.stringify({ waveTimes: waveTimes.map(t => +t.toFixed(1)), kills: g.stats.kills, elitesSeen: eliteIds.size, elitesKilled: g.stats.elitesKilled, taken: Math.round(g.stats.damageTaken), total: Math.round(simulated) }))
        expect(g.phase).toBe('victory')
        expect(g.wave).toBe(TOTAL_WAVES)
        expect(g.stats.kills).toBeGreaterThan(300)
        expect(g.stats.elitesKilled).toBe(14)
        // Waves 1–3 are short lessons; nothing should drag on, and the
        // two-elite finale gets a little more room.
        for (const [i, t] of waveTimes.entries()) {
            expect(t, `wave ${i + 1} took ${t.toFixed(1)}s`).toBeLessThan(i + 1 === TOTAL_WAVES ? 300 : i >= 20 ? 200 : 120)
        }
        const total = waveTimes.reduce((a, b) => a + b, 0)
        expect(total).toBeGreaterThan(3 * 60)
        expect(total).toBeLessThan(45 * 60)
        for (const e of g.enemies) expect(Number.isFinite(e.x)).toBe(true)
    }, 60_000)
})
