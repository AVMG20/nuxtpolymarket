import { describe, expect, it } from 'vitest'
import {
    SHOP_TRACKS,
    getShopTrack,
    isShopTrackId,
    maxLevelFor,
    shopTrackCost
} from '#shared/utils/hero-quest/content/shop'
import {
    BASE_CHAMPION_SLOTS,
    BASE_LOADOUT_SLOTS,
    LOADOUT_SLOT_BASE_COST_GEMS,
    MAX_CHAMPION_SLOTS,
    MAX_LOADOUT_SLOTS,
    MAX_OFFLINE_CAP_LEVEL,
    MAX_OFFLINE_EFFICIENCY,
    MAX_OFFLINE_EFFICIENCY_LEVEL,
    OFFLINE_CAP_BASE_COST,
    OFFLINE_CAP_MAX_HOURS,
    OFFLINE_EFFICIENCY_BASE_COST
} from '#shared/utils/hero-quest/constants'
import { offlineCapHours, offlineEfficiency } from '#shared/utils/hero-quest/settle'

describe('hero-quest prestige shop', () => {
    it('exposes only the tracks with locked formulas — the offline pair plus four slot tracks', () => {
        // One slot track per system that has slots. The remaining §4 sinks (Raid Keys,
        // kill-count reduction, boss-timer extension) still have no formula, level count or
        // magnitude in any doc, and the global stat multiplier was cut outright — see
        // `content/shop.ts` and `open-items.md` #11.4.
        expect(SHOP_TRACKS.map(track => track.id).sort()).toEqual([
            'artifactSlots', 'championSlots', 'loadoutSlots',
            'offlineCap', 'offlineEfficiency', 'skillSlots'
        ])
    })

    it('has no Gear slot track — the deliberate exception among the four gachas', () => {
        // All six Forge slots are available from account start (`gear-equipment.md` §1), because
        // they map onto Hero stats that exist on day one rather than a party size that grows.
        expect(SHOP_TRACKS.some(track => track.id.startsWith('gear'))).toBe(false)
    })

    it('prices Loadout slots in Gems and everything else in Void Shards', () => {
        // The only non-Void-Shard track in the game. Loadout slots add zero combat power on
        // their own — pure convenience — which is why they take the convenience currency
        // (`loadouts.md` §3).
        for (const track of SHOP_TRACKS) {
            expect(track.currency, track.id).toBe(track.id === 'loadoutSlots' ? 'gems' : 'voidShards')
        }
    })

    it('rounds every Gems price to an integer, since debitGems rejects a fraction', () => {
        for (const track of SHOP_TRACKS.filter(entry => entry.currency === 'gems')) {
            for (let level = 0; level < track.maxLevel; level++) {
                const cost = shopTrackCost(track.id, level)
                expect(Number.isInteger(cost), `${track.id} @ ${level}`).toBe(true)
            }
        }
    })

    it('runs the three 2→5 slot tracks on identical shapes', () => {
        // Skills and Artifacts both say "mirroring the Champion party-slot progression exactly"
        // (`skills-gacha.md` §6, `artifacts-dig-site-gacha.md` §7). Three entries rather than one
        // parameterised track only because `upgradeId` has to differ per system — so if the
        // shapes ever diverge it should be a decision, not a drift.
        const tracks = ['championSlots', 'skillSlots', 'artifactSlots'] as const
        for (const id of tracks) {
            expect(maxLevelFor(id), id).toBe(3)
            expect(shopTrackCost(id, 0), id).toBe(shopTrackCost('championSlots', 0))
        }
    })

    it('doubles the Loadout track across 4 levels, reaching 8× the base', () => {
        // 2 → 6 slots since #40 (`loadouts.md` §3 said 10). §3 flags the doubling's first pairing
        // with Gems as a balance unknown; pinned so a retune of either end is visible.
        expect(maxLevelFor('loadoutSlots')).toBe(MAX_LOADOUT_SLOTS - BASE_LOADOUT_SLOTS)
        expect(shopTrackCost('loadoutSlots', 0)).toBe(LOADOUT_SLOT_BASE_COST_GEMS)
        expect(shopTrackCost('loadoutSlots', 3)).toBe(LOADOUT_SLOT_BASE_COST_GEMS * 8)
        expect(shopTrackCost('loadoutSlots', 4)).toBeNull()
    })

    it('matches each track\'s level count to the constant that caps its effect', () => {
        expect(maxLevelFor('offlineEfficiency')).toBe(MAX_OFFLINE_EFFICIENCY_LEVEL)
        expect(maxLevelFor('offlineCap')).toBe(MAX_OFFLINE_CAP_LEVEL)
        // 2 slots to start, 5 at the cap — so exactly 3 purchases (§1).
        expect(maxLevelFor('championSlots')).toBe(MAX_CHAMPION_SLOTS - BASE_CHAMPION_SLOTS)
    })

    it('reaches each track\'s designed ceiling at exactly its last level, not before', () => {
        expect(offlineEfficiency(MAX_OFFLINE_EFFICIENCY_LEVEL)).toBeCloseTo(MAX_OFFLINE_EFFICIENCY, 10)
        expect(offlineEfficiency(MAX_OFFLINE_EFFICIENCY_LEVEL - 1)).toBeLessThan(MAX_OFFLINE_EFFICIENCY)
        expect(offlineCapHours(MAX_OFFLINE_CAP_LEVEL)).toBe(OFFLINE_CAP_MAX_HOURS)
        expect(offlineCapHours(MAX_OFFLINE_CAP_LEVEL - 1)).toBeLessThan(OFFLINE_CAP_MAX_HOURS)
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
        it('prices the first level at the track\'s base cost', () => {
            expect(shopTrackCost('offlineEfficiency', 0)).toBe(OFFLINE_EFFICIENCY_BASE_COST)
            expect(shopTrackCost('offlineCap', 0)).toBe(OFFLINE_CAP_BASE_COST)
        })

        it('doubles per level on the short track, exactly', () => {
            // `cost(level) = BASE × 2^(level-1)` — the doc's 5-level shape, unrounded.
            for (let level = 0; level < MAX_OFFLINE_EFFICIENCY_LEVEL; level++) {
                expect(shopTrackCost('offlineEfficiency', level))
                    .toBeCloseTo(OFFLINE_EFFICIENCY_BASE_COST * Math.pow(2, level), 10)
            }
        })

        it('climbs monotonically on the long track and stays whole', () => {
            let previous = 0
            for (let level = 0; level < MAX_OFFLINE_CAP_LEVEL; level++) {
                const cost = shopTrackCost('offlineCap', level)!
                expect(cost).toBeGreaterThan(previous)
                expect(Number.isInteger(cost), `level ${level + 1}`).toBe(true)
                previous = cost
            }
        })

        it('gates the last few levels hard, which is the point of the long curve', () => {
            const first = shopTrackCost('offlineCap', 0)!
            const last = shopTrackCost('offlineCap', MAX_OFFLINE_CAP_LEVEL - 1)!
            expect(last / first).toBeGreaterThan(1e6)
        })

        it('returns null at the cap so a maxed track can never be bought again', () => {
            expect(shopTrackCost('offlineEfficiency', MAX_OFFLINE_EFFICIENCY_LEVEL)).toBeNull()
            expect(shopTrackCost('offlineCap', MAX_OFFLINE_CAP_LEVEL)).toBeNull()
            expect(shopTrackCost('offlineCap', MAX_OFFLINE_CAP_LEVEL + 50)).toBeNull()
        })

        it('treats a nonsense owned level as zero rather than pricing off it', () => {
            expect(shopTrackCost('offlineEfficiency', -5)).toBe(OFFLINE_EFFICIENCY_BASE_COST)
        })
    })
})
