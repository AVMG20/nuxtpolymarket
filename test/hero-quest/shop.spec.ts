import { describe, expect, it } from 'vitest'
import {
    SHOP_TRACKS,
    getShopTrack,
    isShopTrackId,
    maxLevelFor,
    shopTrackCost,
    voidShardsFor
} from '#shared/utils/hero-quest/content/shop'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { makeParty } from '../../scripts/hero-quest/sim'
import {
    BASE_CHAMPION_SLOTS,
    MAX_CHAMPION_SLOTS,
    MAX_OFFLINE_CAP_LEVEL,
    MAX_OFFLINE_EFFICIENCY_LEVEL,
    OFFLINE_EFFICIENCY_BASE_COST,
    VOID_SHARD_BASE,
    VOID_SHARD_GROWTH
} from '#shared/utils/hero-quest/constants'

describe('hero-quest prestige shop', () => {
    describe('stat tracks', () => {
        it('reaches the whole party, Hero and Champions alike', () => {
            const without = partyUnitStats(makeParty('class_beginner', 30, 3))
            const with_ = partyUnitStats(makeParty('class_beginner', 30, 3, { shopStatLevels: { pwr: 10 } }))
            for (let index = 0; index < without.length; index++) {
                expect(with_[index]!.pwr.gt(without[index]!.pwr), `unit ${index}`).toBe(true)
                expect(with_[index]!.def.eq(without[index]!.def), `unit ${index}`).toBe(true)
            }
        })
    })

    it('rounds every Gems price to an integer, since debitGems rejects a fraction', () => {
        for (const track of SHOP_TRACKS.filter(entry => entry.currency === 'gems')) {
            for (let level = 0; level < track.maxLevel; level++) {
                const cost = shopTrackCost(track.id, level)
                expect(Number.isInteger(cost), `${track.id} @ ${level}`).toBe(true)
            }
        }
    })

    it('matches each track\'s level count to the constant that caps its effect', () => {
        expect(maxLevelFor('offlineEfficiency')).toBe(MAX_OFFLINE_EFFICIENCY_LEVEL)
        expect(maxLevelFor('offlineCap')).toBe(MAX_OFFLINE_CAP_LEVEL)
        // 2 slots to start, 5 at the cap — so exactly 3 purchases (§1).
        expect(maxLevelFor('championSlots')).toBe(MAX_CHAMPION_SLOTS - BASE_CHAMPION_SLOTS)
    })

    it('recognises its own track IDs and nothing else', () => {
        expect(isShopTrackId('offlineCap')).toBe(true)
        expect(isShopTrackId('championSlots')).toBe(true)
        expect(isShopTrackId('skillSlots')).toBe(true)
        expect(isShopTrackId('loadoutSlots')).toBe(true)
        expect(isShopTrackId('gearSlots')).toBe(false)
        expect(isShopTrackId('__proto__')).toBe(false)
    })

    it('throws on an unknown track rather than returning a default', () => {
        // @ts-expect-error deliberately out of the union — this is the runtime guard
        expect(() => getShopTrack('nope')).toThrow()
    })

    describe('cost curve', () => {
        it('returns null at the cap so a maxed track can never be bought again', () => {
            expect(shopTrackCost('offlineEfficiency', MAX_OFFLINE_EFFICIENCY_LEVEL)).toBeNull()
            expect(shopTrackCost('offlineCap', MAX_OFFLINE_CAP_LEVEL)).toBeNull()
            expect(shopTrackCost('offlineCap', MAX_OFFLINE_CAP_LEVEL + 50)).toBeNull()
        })

        it('treats a nonsense owned level as zero rather than pricing off it', () => {
            expect(shopTrackCost('offlineEfficiency', -5)).toBe(OFFLINE_EFFICIENCY_BASE_COST)
        })
    })

    it('pays whole Void Shards at every prestige', () => {
        // Decimal's pow is inexact: unrounded, prestige 4 paid 799.999… and missed an 800 price.
        for (let prestige = 0; prestige <= 40; prestige++) {
            expect(voidShardsFor(prestige).toNumber()).toBe(VOID_SHARD_BASE * VOID_SHARD_GROWTH ** prestige)
        }
    })
})
