import { describe, expect, it } from 'vitest'
import {
    PLANT_TYPES,
    XENO_UPGRADE_MAX_LEVEL,
    XENO_UPGRADE_TRACKS
} from '../../shared/utils/xeno'
import {
    XENO_TIERS,
    xenoBestPlant,
    xenoStage,
    xenoTileIncome
} from '../../scripts/lib/economy-stages'

describe('xeno tier progression', () => {
    it('climbs 2.5-5x per tier with no flat stretches or cliffs', () => {
        // The failure this guards against: T7 -> T8 used to be a 40x jump while
        // T2 -> T3 was an outright regression, so every tier below the endgame
        // was pointless to farm and the endgame arrived all at once.
        for (const tier of XENO_TIERS.slice(1)) {
            const previous = xenoStage(tier - 1, 0).coinsPerHour
            const current = xenoStage(tier, 0).coinsPerHour
            expect(current / previous).toBeGreaterThanOrEqual(2.5)
            expect(current / previous).toBeLessThanOrEqual(5)
        }
    })

    it('never lets a lower-tier plant out-earn the tier you just unlocked', () => {
        // The global yield upgrade and grid artifacts both add a FLAT number of
        // plants per harvest, which favours short-cycle crops. Push those high
        // enough against a soft value curve and the best farm becomes a 3-minute
        // T1 filler, which makes the whole breeding chain pointless.
        for (const globalLevel of [0, 5, XENO_UPGRADE_MAX_LEVEL]) {
            for (const tier of XENO_TIERS) {
                const best = xenoBestPlant(tier, globalLevel)
                expect(best).not.toBeNull()
                expect(best!.plant.tier).toBe(tier)
            }
        }
    })

    it('counts harvest income net of the plant that goes back in the ground', () => {
        // Harvesting deletes the planted instance, so a yield-0 plant would be
        // a treadmill that never banks anything. Gross math would score it as
        // profitable and overstate every low-tier plant by 1.5-3x.
        const treadmill = { ...PLANT_TYPES[0]!, yield: 0, value: 100 }
        expect(xenoTileIncome(treadmill, 0)).toBe(0)
    })
})

describe('xeno global upgrades', () => {
    it('prices every level under 400 hours of the income it is bought with', () => {
        // The yield ladder used to total 801B — over 13,000 hours even at T9 —
        // because it had been priced against income almost nobody reached.
        for (const track of XENO_UPGRADE_TRACKS) {
            expect(track.costs).toHaveLength(XENO_UPGRADE_MAX_LEVEL)
            track.costs.forEach((cost, index) => {
                const tier = Math.min(9, 4 + Math.floor(index / 2))
                const hours = cost / xenoStage(tier, index).coinsPerHour
                expect(hours).toBeLessThanOrEqual(400)
            })
        }
    })

    it('never jumps more than 5x between consecutive levels', () => {
        // The speed track's last level was a 12.5x step (20B -> 250B) where
        // every other step is ~3x, which read as a typo rather than a wall.
        for (const track of XENO_UPGRADE_TRACKS) {
            for (let index = 1; index < track.costs.length; index++) {
                expect(track.costs[index]! / track.costs[index - 1]!).toBeLessThanOrEqual(5)
            }
        }
    })
})
