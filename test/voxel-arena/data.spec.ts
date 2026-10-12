import { describe, it, expect } from 'vitest'
import { ENEMIES, ENEMY_IDS, JUGGERNAUT, bossForWave, WEAPONS, WEAPON_IDS, MELEE_WEAPONS, MELEE_IDS, ECONOMY, planWave, isBossWave, waveEvent, waveEnemyCount, waveHpMult, waveDamageMult, eliteChance, defaultStats, magazineSize, reserveMax, killScore, dropChance, ammoDropChance, waveIncome, refillPrice, boonPrice, rerollPrice } from '../../app/utils/voxel-arena/data'

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

    it('adds bosses on boss waves only, in pairs from wave 15 and threes from 25', () => {
        for (let wave = 1; wave <= 30; wave++) {
            const plan = planWave(wave, seeded(wave * 7))
            const bosses = plan.spawns.filter(s => ENEMIES[s.enemy].behavior === 'boss').length
            expect(plan.boss).toBe(isBossWave(wave))
            expect(bosses).toBe(isBossWave(wave) ? (wave >= 25 ? 3 : wave >= 15 ? 2 : 1) : 0)
        }
    })

    it('alternates the Titan and the Juggernaut on successive boss waves', () => {
        const order = [5, 10, 15, 20, 25, 30].map(bossForWave)
        expect(order).toEqual(['titan', 'juggernaut', 'titan', 'juggernaut', 'titan', 'juggernaut'])
        for (const wave of [5, 10, 15, 20, 25, 30]) {
            const kinds = new Set(planWave(wave, seeded(wave)).spawns.filter(s => ENEMIES[s.enemy].behavior === 'boss').map(s => s.enemy))
            expect([...kinds]).toEqual([bossForWave(wave)])
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
            expect(m.rate).toBeGreaterThan(0)
            // the animation must finish before the next attack is allowed
            expect(m.swingTime).toBeLessThanOrEqual(1 / m.rate)
            expect(m.finisherMult).toBeGreaterThanOrEqual(2)
        }
        expect(MELEE_WEAPONS.dagger.swingTime).toBeLessThan(MELEE_WEAPONS.axe.swingTime)
        expect(MELEE_WEAPONS.dagger.rate).toBeGreaterThan(MELEE_WEAPONS.axe.rate)
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
        expect(WEAPONS.lmg.price).toBeGreaterThan(waveIncome(2) + waveIncome(3))
        expect(WEAPONS.lmg.price).toBeLessThan(waveIncome(2) + waveIncome(3) + waveIncome(4))
        expect(WEAPONS.lmg.price).toBeGreaterThan(WEAPONS.rifle.price)
        expect(WEAPONS.raygun.price).toBeGreaterThan(WEAPONS.lmg.price)
    })

    it('lets a wave of income buy one to three boons depending on rarity', () => {
        for (let wave = 1; wave <= 30; wave++) {
            const income = waveIncome(wave)
            const commons = Math.floor(income / boonPrice('common', wave))
            expect(commons, `wave ${wave}`).toBeGreaterThanOrEqual(2)
            expect(commons, `wave ${wave}`).toBeLessThanOrEqual(8)
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

describe('voxel arena new enemies', () => {
    const regulars = ['splitter', 'sniper', 'burrower'] as const

    it('gates the new enemies behind their wave and never rolls the splinter', () => {
        for (let wave = 1; wave <= 30; wave++) {
            for (let seed = 1; seed <= 3; seed++) {
                const kinds = new Set(planWave(wave, seeded(wave * 31 + seed)).spawns.map(s => s.enemy))
                expect(kinds.has('splinter')).toBe(false)
                for (const id of regulars) if (wave < ENEMIES[id].minWave) expect(kinds.has(id), `${id} on wave ${wave}`).toBe(false)
            }
        }
        const late = new Set(planWave(20, seeded(5)).spawns.map(s => s.enemy))
        for (const id of regulars) expect(late.has(id), `${id} should appear by wave 20`).toBe(true)
    })

    it('introduces them gradually after the first mechanics enemies', () => {
        expect(ENEMIES.splitter.minWave).toBeGreaterThan(ENEMIES.charger.minWave)
        expect(ENEMIES.burrower.minWave).toBeGreaterThan(ENEMIES.splitter.minWave)
        expect(ENEMIES.sniper.minWave).toBeGreaterThan(ENEMIES.burrower.minWave)
    })

    it('splits a Splitter into two faster, weaker Splinters', () => {
        const split = ENEMIES.splitter.splitInto!
        expect(split.id).toBe('splinter')
        expect(split.count).toBe(2)
        const child = ENEMIES[split.id]
        expect(child.speed).toBeGreaterThan(ENEMIES.splitter.speed)
        expect(child.hp * split.count).toBeLessThan(ENEMIES.splitter.hp)
        expect(child.score).toBeLessThan(ENEMIES.splitter.score)
        expect(child.splitInto).toBeUndefined()
        expect(child.weight(10)).toBe(0)
    })

    it('makes the Sniper a fragile, long range, hard hitting target', () => {
        const sniper = ENEMIES.sniper
        expect(sniper.behavior).toBe('sniper')
        expect(sniper.attackRange).toBeGreaterThan(ENEMIES.spitter.attackRange * 2)
        expect(sniper.hp).toBeLessThan(ENEMIES.spitter.hp)
        expect(sniper.damage).toBeGreaterThan(ENEMIES.spitter.damage)
        expect(sniper.attackCooldown).toBeGreaterThan(ENEMIES.spitter.attackCooldown * 2)
        expect(sniper.headRadius).toBeGreaterThan(0)
    })

    it('keeps one Sniper hit from killing a full health player until very late', () => {
        for (let wave = 10; wave <= 25; wave++) {
            expect(ENEMIES.sniper.damage * waveDamageMult(wave)).toBeLessThan(defaultStats().maxHealth)
        }
    })

    it('makes the Burrower a mid-weight ambusher with a punishing but dodgeable eruption', () => {
        const burrower = ENEMIES.burrower
        expect(burrower.behavior).toBe('burrower')
        expect(burrower.hp).toBeGreaterThan(ENEMIES.grunt.hp)
        expect(burrower.hp).toBeLessThan(ENEMIES.brute.hp)
        expect(burrower.damage).toBeGreaterThan(ENEMIES.grunt.damage)
        expect(burrower.score).toBeGreaterThan(ENEMIES.grunt.score)
    })

    it('scores and drops in line with how dangerous each new enemy is', () => {
        for (const id of regulars) {
            const def = ENEMIES[id]
            expect(killScore(def, 10, 0, null)).toBeGreaterThan(killScore(ENEMIES.grunt, 10, 0, null))
            expect(dropChance(def, 1)).toBeLessThan(1)
        }
    })
})

describe('voxel arena juggernaut boss', () => {
    const jug = ENEMIES.juggernaut
    const titan = ENEMIES.titan

    it('is a boss tougher than the Titan with a weak point on its back', () => {
        expect(jug.behavior).toBe('boss')
        expect(jug.hp).toBeGreaterThan(titan.hp)
        expect(jug.score).toBeGreaterThan(titan.score)
        expect(jug.weight(10)).toBe(0)
        // the weak point is the head hit-sphere, so it needs a real radius
        expect(jug.headRadius).toBeGreaterThan(0.3)
        expect(jug.headY).toBeGreaterThan(0)
        expect(dropChance(jug, 1)).toBe(1)
    })

    it('soaks most frontal damage but is far from invulnerable', () => {
        expect(JUGGERNAUT.armorMult).toBeGreaterThan(0.1)
        expect(JUGGERNAUT.armorMult).toBeLessThan(0.5)
        expect(JUGGERNAUT.flankMult).toBeGreaterThan(JUGGERNAUT.armorMult)
        expect(JUGGERNAUT.flankMult).toBeLessThanOrEqual(1)
        // at the front the effective health pool stays within a sane multiple of the Titan's
        expect(jug.hp / JUGGERNAUT.armorMult).toBeLessThan(titan.hp * 5)
    })

    it('shatters its plating at half health and opens up long enough to punish', () => {
        expect(JUGGERNAUT.shatterAt).toBe(0.5)
        expect(JUGGERNAUT.ventTime).toBeGreaterThanOrEqual(3)
        expect(JUGGERNAUT.ventTime).toBeLessThanOrEqual(8)
    })
})
