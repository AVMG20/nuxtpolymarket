import { describe, it, expect } from 'vitest'
import { ENEMIES, ENEMY_IDS, WEAPONS, WEAPON_IDS, MELEE_WEAPONS, MELEE_IDS, ECONOMY, planWave, isBossWave, waveEvent, waveEnemyCount, waveHpMult, waveDamageMult, eliteChance, defaultStats, magazineSize, reserveMax, killScore, dropChance, ammoDropChance, waveIncome, refillPrice, boonPrice, rerollPrice } from '../../app/utils/voxel-arena/data'

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

    it('adds titans on boss waves only, in pairs from wave 15 and threes from 25', () => {
        for (let wave = 1; wave <= 30; wave++) {
            const plan = planWave(wave, seeded(wave * 7))
            const titans = plan.spawns.filter(s => s.enemy === 'titan').length
            expect(plan.boss).toBe(isBossWave(wave))
            expect(titans).toBe(isBossWave(wave) ? (wave >= 25 ? 3 : wave >= 15 ? 2 : 1) : 0)
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
        expect(eliteChance(60)).toBeLessThanOrEqual(0.5)
    })

    it('ramps difficulty steeply: wave 20 is far tougher than wave 10 and wave 30 tougher still', () => {
        expect(waveHpMult(10)).toBeGreaterThan(3)
        expect(waveHpMult(20) / waveHpMult(10)).toBeGreaterThan(2.5)
        expect(waveHpMult(30) / waveHpMult(20)).toBeGreaterThan(1.8)
        expect(waveDamageMult(30)).toBeGreaterThan(3.5)
        expect(waveEnemyCount(30)).toBeGreaterThan(waveEnemyCount(20) * 1.3)
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

    it('weapons have positive damage, fire rate, magazines and reserve ammo', () => {
        for (const id of WEAPON_IDS) {
            const w = WEAPONS[id]
            expect(w.damage).toBeGreaterThan(0)
            expect(w.fireRate).toBeGreaterThan(0)
            expect(w.magazine).toBeGreaterThan(0)
            expect(w.reloadTime).toBeGreaterThan(0)
            expect(w.reserve).toBeGreaterThanOrEqual(w.magazine * 3)
            expect(w.price).toBeGreaterThan(0)
            expect(w.price % 5).toBe(0)
            expect(w.burst).toBeGreaterThanOrEqual(1)
            if (w.burst > 1) expect(w.burstGap).toBeGreaterThan(0)
            if (w.kind !== 'rail' && w.kind !== 'arc') expect(w.projectileSpeed).toBeGreaterThan(0)
        }
        expect(WEAPONS.burst.burst).toBe(3)
        expect(WEAPONS.flamer.kind).toBe('flame')
        expect(WEAPONS.flamer.burn).toBeGreaterThan(0)
        expect(WEAPONS.launcher.explosionRadius).toBeGreaterThan(0)
        expect(WEAPONS.launcher.gravity).toBeGreaterThan(0)
    })

    it('melee weapons have sane reach, timing and a rewarding finisher', () => {
        for (const id of MELEE_IDS) {
            const m = MELEE_WEAPONS[id]
            expect(m.id).toBe(id)
            expect(m.damage).toBeGreaterThan(0)
            expect(m.range).toBeGreaterThan(1)
            expect(m.swingTime).toBeGreaterThan(0.05)
            expect(m.finisherMult).toBeGreaterThanOrEqual(2)
        }
        expect(MELEE_WEAPONS.dagger.swingTime).toBeLessThan(MELEE_WEAPONS.axe.swingTime)
        expect(MELEE_WEAPONS.spear.range).toBeGreaterThan(MELEE_WEAPONS.sword.range)
    })

    it('scales magazine size with stats and never drops below one round', () => {
        const stats = defaultStats()
        expect(magazineSize(WEAPONS.rifle, stats)).toBe(30)
        stats.magazineMult = 1.35
        expect(magazineSize(WEAPONS.rifle, stats)).toBe(41)
        stats.magazineMult = 0.01
        expect(magazineSize(WEAPONS.sniper, stats)).toBe(1)
    })

    it('grows reserve ammo with the reserve stat from boons', () => {
        const stats = defaultStats()
        const base = reserveMax(WEAPONS.rifle, stats)
        expect(base).toBe(WEAPONS.rifle.reserve)
        stats.reserveMult = 1.4
        expect(reserveMax(WEAPONS.rifle, stats)).toBe(Math.round(base * 1.4))
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
        expect(dropChance(ENEMIES.grunt, 100)).toBe(0.35)
        expect(ammoDropChance(ENEMIES.grunt, 1)).toBeLessThan(0.1)
        expect(ammoDropChance(ENEMIES.grunt, 100)).toBe(0.3)
        expect(ammoDropChance(ENEMIES.titan, 1)).toBe(1)
    })
})

describe('voxel arena economy', () => {
    it('pays a fixed, rising income per wave with a boss bonus', () => {
        expect(waveIncome(1)).toBeGreaterThan(100)
        expect(waveIncome(2)).toBeGreaterThan(waveIncome(1))
        expect(waveIncome(5) - waveIncome(4)).toBeGreaterThan(100)
        expect(waveIncome(6)).toBeLessThan(waveIncome(5))
        for (let wave = 1; wave <= 30; wave++) expect(waveIncome(wave) % 5).toBe(0)
    })

    it('prices guns by strength: starters cost about a wave, machine guns a few waves of saving', () => {
        expect(WEAPONS.pistol.price).toBeLessThanOrEqual(waveIncome(1))
        expect(WEAPONS.smg.price).toBeLessThanOrEqual(waveIncome(1))
        expect(WEAPONS.lmg.price).toBeGreaterThan(waveIncome(3) + waveIncome(4))
        expect(WEAPONS.lmg.price).toBeLessThan(waveIncome(2) + waveIncome(3) + waveIncome(4))
        expect(WEAPONS.lmg.price).toBeGreaterThan(WEAPONS.rifle.price)
        expect(WEAPONS.raygun.price).toBeGreaterThan(WEAPONS.lmg.price)
    })

    it('lets a wave of income buy one to three boons depending on rarity', () => {
        for (let wave = 1; wave <= 30; wave++) {
            const income = waveIncome(wave)
            const commons = Math.floor(income / boonPrice('common', wave))
            expect(commons, `wave ${wave}`).toBeGreaterThanOrEqual(2)
            expect(commons, `wave ${wave}`).toBeLessThanOrEqual(6)
            expect(income).toBeGreaterThanOrEqual(boonPrice('epic', wave))
            expect(Math.floor(income / boonPrice('legendary', wave))).toBeLessThanOrEqual(2)
        }
    })

    it('charges little for ammo and nothing when the reserve is full', () => {
        expect(refillPrice(WEAPONS.rifle, 210, 210)).toBe(0)
        expect(refillPrice(WEAPONS.rifle, 0, 210)).toBe(ECONOMY.refillPrice.rare)
        expect(refillPrice(WEAPONS.rifle, 105, 210)).toBeLessThan(ECONOMY.refillPrice.rare)
        expect(refillPrice(WEAPONS.rifle, 209, 210)).toBe(5)
        expect(ECONOMY.refillPrice.legendary).toBeLessThan(WEAPONS.pistol.price)
    })

    it('prices boons by rarity with a gentle wave ramp', () => {
        expect(boonPrice('common', 1)).toBe(ECONOMY.boonPrice.common)
        expect(boonPrice('legendary', 1)).toBeGreaterThan(boonPrice('epic', 1))
        expect(boonPrice('common', 10)).toBeGreaterThan(boonPrice('common', 1))
        expect(boonPrice('common', 10)).toBeLessThan(boonPrice('common', 1) * 1.6)
        expect(rerollPrice(1)).toBe(ECONOMY.rerollPrice)
        expect(rerollPrice(1)).toBeLessThan(boonPrice('common', 1))
    })
})
