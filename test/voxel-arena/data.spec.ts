import { describe, it, expect } from 'vitest'
import { ENEMIES, ENEMY_IDS, WEAPONS, WEAPON_IDS, planWave, isBossWave, waveEvent, waveEnemyCount, waveHpMult, eliteChance, defaultStats, magazineSize, killScore, dropChance } from '../../app/utils/voxel-arena/data'

function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

describe('voxel arena wave planner', () => {
    it('only spawns enemies unlocked for the wave', () => {
        for (let wave = 1; wave <= 12; wave++) {
            const plan = planWave(wave, seeded(wave))
            for (const spawn of plan.spawns) {
                const def = ENEMIES[spawn.enemy]
                expect(def.minWave, `${spawn.enemy} on wave ${wave}`).toBeLessThanOrEqual(wave)
            }
        }
    })

    it('adds titans on boss waves only, in pairs from wave 15', () => {
        for (let wave = 1; wave <= 20; wave++) {
            const plan = planWave(wave, seeded(wave * 7))
            const titans = plan.spawns.filter(s => s.enemy === 'titan').length
            expect(plan.boss).toBe(isBossWave(wave))
            expect(titans).toBe(isBossWave(wave) ? (wave >= 15 ? 2 : 1) : 0)
        }
    })

    it('adds a gilded bounty target on bounty waves', () => {
        for (let wave = 1; wave <= 12; wave++) {
            const plan = planWave(wave, seeded(wave * 3))
            const gilded = plan.spawns.filter(s => s.affix === 'gilded').length
            expect(gilded).toBe(waveEvent(wave) === 'bounty' ? 1 : 0)
        }
    })

    it('scales enemy count, health and elites with the wave', () => {
        expect(waveEnemyCount(2)).toBeGreaterThan(waveEnemyCount(1))
        expect(waveEnemyCount(10)).toBeGreaterThan(waveEnemyCount(5))
        expect(waveHpMult(1)).toBe(1)
        expect(waveHpMult(10)).toBeGreaterThan(waveHpMult(5))
        expect(eliteChance(3)).toBe(0)
        expect(eliteChance(12)).toBeGreaterThan(eliteChance(6))
        expect(eliteChance(60)).toBeLessThanOrEqual(0.38)
    })

    it('never rolls random elite affixes before wave 6', () => {
        for (let wave = 1; wave < 6; wave++) {
            const plan = planWave(wave, seeded(99 + wave))
            expect(plan.spawns.every(s => s.affix === null || s.affix === 'gilded')).toBe(true)
        }
    })

    it('is deterministic for a given rng', () => {
        const a = planWave(8, seeded(42))
        const b = planWave(8, seeded(42))
        expect(a).toEqual(b)
    })

    it('keeps the alive cap and spawn interval within sane bounds', () => {
        for (let wave = 1; wave <= 40; wave++) {
            const plan = planWave(wave, seeded(wave))
            expect(plan.maxAlive).toBeGreaterThanOrEqual(16)
            expect(plan.maxAlive).toBeLessThanOrEqual(64)
            expect(plan.spawnInterval).toBeGreaterThanOrEqual(0.4)
            expect(plan.batchSize).toBeLessThanOrEqual(8)
        }
    })
})

describe('voxel arena definitions', () => {
    it('every weapon and enemy id matches its key', () => {
        for (const id of WEAPON_IDS) expect(WEAPONS[id].id).toBe(id)
        for (const id of ENEMY_IDS) expect(ENEMIES[id].id).toBe(id)
    })

    it('weapons have positive damage, fire rate and magazines', () => {
        for (const id of WEAPON_IDS) {
            const w = WEAPONS[id]
            expect(w.damage).toBeGreaterThan(0)
            expect(w.fireRate).toBeGreaterThan(0)
            expect(w.magazine).toBeGreaterThan(0)
            expect(w.reloadTime).toBeGreaterThan(0)
            if (w.kind !== 'rail' && w.kind !== 'arc' && w.kind !== 'flame') expect(w.projectileSpeed).toBeGreaterThan(0)
        }
    })

    it('scales magazine size with stats and never drops below one round', () => {
        const stats = defaultStats()
        expect(magazineSize(WEAPONS.pulse, stats)).toBe(30)
        stats.magazineMult = 1.35
        expect(magazineSize(WEAPONS.pulse, stats)).toBe(41)
        stats.magazineMult = 0.01
        expect(magazineSize(WEAPONS.rail, stats)).toBe(1)
    })

    it('rewards combos and elites with more score', () => {
        const base = killScore(ENEMIES.grunt, 3, 0, null)
        expect(base).toBe(30)
        expect(killScore(ENEMIES.grunt, 3, 10, null)).toBeGreaterThan(base)
        expect(killScore(ENEMIES.grunt, 3, 0, 'swift')).toBeGreaterThan(base)
    })

    it('bosses always drop and luck raises the drop chance with a cap', () => {
        expect(dropChance(ENEMIES.titan, 1)).toBe(1)
        expect(dropChance(ENEMIES.grunt, 2)).toBeGreaterThan(dropChance(ENEMIES.grunt, 1))
        expect(dropChance(ENEMIES.grunt, 100)).toBe(0.5)
    })
})
