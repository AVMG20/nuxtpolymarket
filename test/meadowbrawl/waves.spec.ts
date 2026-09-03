import { describe, expect, it } from 'vitest'
import { buildWave, countEnemies, eliteFor, waveSpawnSpan } from '../../app/utils/meadowbrawl/waves'
import { UNLOCK_WAVE } from '../../app/utils/meadowbrawl/enemies'
import { TOTAL_WAVES } from '../../app/utils/meadowbrawl/types'
import type { EnemyTypeId } from '../../app/utils/meadowbrawl/types'

function seeded(seed: number) {
    let s = seed
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296
        return s / 4294967296
    }
}

describe('wave schedule', () => {
    it('front-loads the roster: each archetype debuts on its unlock wave and never earlier', () => {
        const debuts: Record<EnemyTypeId, number> = { grunt: 1, charger: 1, swarmer: 3, shield: 5, ranged: 7, ogre: 4, warlord: 8 }
        for (let seed = 1; seed <= 5; seed++) {
            for (let w = 1; w <= TOTAL_WAVES; w++) {
                const types = new Set(buildWave(w, seeded(seed * 100 + w)).map(g => g.type))
                for (const t of Object.keys(debuts) as EnemyTypeId[]) {
                    if (w < UNLOCK_WAVE[t]) expect(types.has(t), `${t} on wave ${w}`).toBe(false)
                    if (w === debuts[t]) expect(types.has(t), `${t} debut on wave ${w}`).toBe(true)
                }
            }
        }
    })

    it('spawns an elite every four waves, alternating, pairs from 16, and three on the final wave', () => {
        expect(eliteFor(1)).toEqual([])
        expect(eliteFor(4)).toEqual(['ogre'])
        expect(eliteFor(8)).toEqual(['warlord'])
        expect(eliteFor(12)).toEqual(['ogre'])
        expect(eliteFor(16)).toEqual(['warlord', 'ogre'])
        expect(eliteFor(20)).toEqual(['ogre', 'warlord'])
        expect(eliteFor(TOTAL_WAVES)).toEqual(['ogre', 'warlord', 'ogre'])
        for (let w = 1; w <= TOTAL_WAVES; w++) {
            const elites = buildWave(w, seeded(w)).filter(g => g.type === 'ogre' || g.type === 'warlord').map(g => g.type)
            expect(elites).toEqual(eliteFor(w))
        }
    })

    it('escalates through count, and keeps waves within the 20–40 second window', () => {
        let prev = 0
        for (let w = 1; w <= TOTAL_WAVES; w++) {
            const groups = buildWave(w, seeded(w * 7))
            const count = countEnemies(groups)
            if (w > 1 && w % 4 !== 0) expect(count).toBeGreaterThanOrEqual(prev * 0.8)
            prev = count
            const lastSpawn = Math.max(...groups.map(g => g.time))
            expect(lastSpawn).toBeLessThanOrEqual(waveSpawnSpan(w) + 8)
            expect(groups.every(g => g.count > 0)).toBe(true)
            expect(groups).toEqual([...groups].sort((a, b) => a.time - b.time))
        }
        expect(countEnemies(buildWave(1, seeded(3)))).toBeLessThan(countEnemies(buildWave(10, seeded(3))))
        expect(countEnemies(buildWave(10, seeded(3)))).toBeLessThan(countEnemies(buildWave(19, seeded(3))))
        expect(countEnemies(buildWave(19, seeded(3)))).toBeLessThan(countEnemies(buildWave(29, seeded(3))))
    })
})
