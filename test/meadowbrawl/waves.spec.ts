import { describe, expect, it } from 'vitest'
import { buildWave, eliteFor } from '../../app/utils/meadowbrawl/waves'
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
    it('never fields an archetype before its unlock wave', () => {
        for (let seed = 1; seed <= 2; seed++) {
            for (let w = 1; w <= TOTAL_WAVES; w++) {
                for (const g of buildWave(w, seeded(seed * 100 + w))) {
                    expect(w, `${g.type} on wave ${w}`).toBeGreaterThanOrEqual(UNLOCK_WAVE[g.type])
                }
            }
        }
    })

    it('builds exactly the elites the payout ceiling counts on', () => {
        const eliteTypes: EnemyTypeId[] = ['ogre', 'warlord', 'briar', 'knight']
        for (let w = 1; w <= TOTAL_WAVES; w++) {
            const elites = buildWave(w, seeded(w)).filter(g => eliteTypes.includes(g.type)).map(g => g.type)
            expect(elites).toEqual(eliteFor(w))
        }
    })
})
