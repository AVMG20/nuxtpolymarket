import { describe, it, expect } from 'vitest'
import { ENEMIES, WEAPONS, planWave, isBossWave, waveEvent, defaultStats, magazineSize } from '../../app/utils/voxel-arena/data'

function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

describe('voxel arena wave planner', () => {
    it('only spawns enemies unlocked for the wave, and never the splinter', () => {
        for (let wave = 1; wave <= 30; wave += 3) {
            const plan = planWave(wave, seeded(wave))
            for (const spawn of plan.spawns) {
                expect(spawn.enemy).not.toBe('splinter')
                expect(ENEMIES[spawn.enemy].minWave, `${spawn.enemy} on wave ${wave}`).toBeLessThanOrEqual(wave)
            }
        }
    })

    it('adds bosses on boss waves only, and never lands an event on one', () => {
        for (let wave = 1; wave <= 30; wave++) {
            const plan = planWave(wave, seeded(wave * 7))
            const bosses = plan.spawns.filter(s => ENEMIES[s.enemy].behavior === 'boss').length
            expect(plan.boss).toBe(isBossWave(wave))
            expect(bosses > 0).toBe(isBossWave(wave))
            expect(plan.event).toBe(waveEvent(wave))
            if (plan.boss) expect(plan.event).toBe('none')
        }
    })

    it('is deterministic for a given rng', () => {
        expect(planWave(8, seeded(42))).toEqual(planWave(8, seeded(42)))
    })
})

describe('voxel arena weapons', () => {
    it('never shrinks a magazine below one round', () => {
        const stats = defaultStats()
        stats.magazineMult = 0.01
        expect(magazineSize(WEAPONS.sniper, stats)).toBe(1)
    })
})
