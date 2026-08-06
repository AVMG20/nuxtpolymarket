/**
 * Cover for drizzle/0005_hack_gem_yield.sql, run as the real SQL against a real
 * Postgres. The migration is one-shot but unforgiving: it rewrites jsonb in place, and
 * a mistake either silently zeroes out gear people paid for or leaves a legacy key
 * behind that hard-500s /hack/loadout and /hack/upgrade on `MOD_RANGES[type].max`.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackArtifacts, hackItems } from '#server/database/schema'
import { MOD_RANGES, AGENT_TRAIT_RANGES, RARITY_MOD_COUNT, AGENT_TRAIT_COUNT } from '#shared/utils/hack-config'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-gem-migration-user'
const MIGRATION = readFileSync('drizzle/0005_hack_gem_yield.sql', 'utf8')

type Entry = { type: string, value: number }
const find = (rows: Entry[], type: string) => rows.find(r => r.type === type)

const BREAKPOINT = ['-->', ' statement-breakpoint'].join('')

async function runMigration() {
    await db.execute(sql.raw(MIGRATION))
}

async function items() {
    const rows = await db.query.hackItems.findMany({ where: eq(hackItems.userId, USER_ID) })
    return new Map(rows.map(r => [r.id, r]))
}
async function agents() {
    const rows = await db.query.hackAgents.findMany({ where: eq(hackAgents.userId, USER_ID) })
    return new Map(rows.map(r => [r.id, r]))
}

describe.skipIf(SKIP)('0005_hack_gem_yield migration', () => {
    beforeEach(async () => {
        await cleanupUser(USER_ID)
        await db.delete(hackItems).where(eq(hackItems.userId, USER_ID))
        await db.delete(hackAgents).where(eq(hackAgents.userId, USER_ID))
        await db.delete(hackArtifacts).where(eq(hackArtifacts.userId, USER_ID))
        await seedUser(USER_ID)

        await db.insert(hackItems).values([
            // god-roll gem_bonus, top of the old 1-3 band
            { id: 'gm-i1', userId: USER_ID, name: 'Bonus Only', slot: 'tool', itemLevel: 12, rarity: 'operative',
                mods: [{ type: 'power_flat', value: 20 }, { type: 'gem_bonus', value: 3 }] },
            // floor-roll gem_chance, bottom of the old 0.001-0.02 band
            { id: 'gm-i2', userId: USER_ID, name: 'Chance Only', slot: 'software', itemLevel: 5, rarity: 'operative',
                mods: [{ type: 'loot_percent', value: 5 }, { type: 'gem_chance', value: 0.001 }] },
            // both stats on one item, at max mod count for its rarity
            { id: 'gm-i3', userId: USER_ID, name: 'Both Phantom', slot: 'tool', itemLevel: 20, rarity: 'phantom',
                mods: [{ type: 'gem_bonus', value: 3 }, { type: 'gem_chance', value: 0.02 },
                    { type: 'speed_percent', value: 11 }, { type: 'loot_percent', value: 9 }, { type: 'power_flat', value: 25 }] },
            // already converted — must not be touched twice
            { id: 'gm-i4', userId: USER_ID, name: 'Already New', slot: 'software', itemLevel: 3, rarity: 'operative',
                mods: [{ type: 'gem_yield', value: 31.5 }, { type: 'xp_flat', value: 4 }] }
        ] as never)

        await db.insert(hackAgents).values([
            // fractionally stacked by artifacts, which accumulate in sub-integer steps
            { id: 'gm-a1', userId: USER_ID, name: 'FracBonus', class: 'bruteforce', rarity: 'operative', level: 7, xp: 0, active: false,
                traits: [{ type: 'gem_bonus', value: 1.65 }, { type: 'power_flat', value: 30 }] },
            { id: 'gm-a2', userId: USER_ID, name: 'BothPhantom', class: 'social_engineer', rarity: 'phantom', level: 15, xp: 0, active: false,
                traits: [{ type: 'gem_bonus', value: 2.4 }, { type: 'gem_chance', value: 0.045 },
                    { type: 'speed_percent', value: 8 }, { type: 'power_flat', value: 50 }, { type: 'power_percent', value: 22 }] }
        ] as never)

        await db.insert(hackArtifacts).values([
            { id: 'gm-r1', userId: USER_ID, traitType: 'gem_bonus', rarity: 'phantom', count: 4 },
            { id: 'gm-r2', userId: USER_ID, traitType: 'gem_chance', rarity: 'phantom', count: 3 },
            { id: 'gm-r3', userId: USER_ID, traitType: 'gem_yield', rarity: 'phantom', count: 2 },
            { id: 'gm-r4', userId: USER_ID, traitType: 'gem_chance', rarity: 'ghost', count: 6 }
        ] as never)
    })

    afterEach(async () => {
        await db.delete(hackItems).where(eq(hackItems.userId, USER_ID))
        await db.delete(hackAgents).where(eq(hackAgents.userId, USER_ID))
        await db.delete(hackArtifacts).where(eq(hackArtifacts.userId, USER_ID))
        await cleanupUser(USER_ID)
    })

    it('carries no breakpoint marker, so it runs as one atomic statement', async () => {
        // Drizzle's migrator splits on this marker wherever it appears — including inside
        // a comment, which once cut this file mid-sentence and failed the deploy on a
        // syntax error. Splitting also costs the all-or-nothing rollback the conversion
        // relies on, so the marker must not appear at all.
        expect(MIGRATION).not.toContain(BREAKPOINT)
    })

    it('leaves no legacy gem key anywhere, which is what stops the pages 500ing', async () => {
        await runMigration()
        for (const row of (await items()).values()) {
            expect(JSON.stringify(row.mods)).not.toMatch(/gem_bonus|gem_chance/)
        }
        for (const row of (await agents()).values()) {
            expect(JSON.stringify(row.traits)).not.toMatch(/gem_bonus|gem_chance/)
        }
        const arts = await db.query.hackArtifacts.findMany({ where: eq(hackArtifacts.userId, USER_ID) })
        expect(arts.every(a => a.traitType === 'gem_yield')).toBe(true)
    })

    it('never converts a roll into a below-average one', async () => {
        await runMigration()
        const rows = await items()
        // A floor-rolled gem_chance is the worst case in the data; it must still land at
        // or above the midpoint of the new band, or holders feel robbed.
        const floorRoll = find(rows.get('gm-i2')!.mods as Entry[], 'gem_yield')!
        const midpoint = (MOD_RANGES.gem_yield.min + MOD_RANGES.gem_yield.max) / 2
        expect(floorRoll.value).toBeGreaterThanOrEqual(midpoint)
        // A god roll still maps to a god roll.
        expect(find(rows.get('gm-i1')!.mods as Entry[], 'gem_yield')!.value).toBe(MOD_RANGES.gem_yield.max)
    })

    it('keeps every converted value inside the new band', async () => {
        await runMigration()
        for (const row of (await items()).values()) {
            const m = find(row.mods as Entry[], 'gem_yield')
            if (m) {
                expect(m.value).toBeGreaterThanOrEqual(MOD_RANGES.gem_yield.min)
                expect(m.value).toBeLessThanOrEqual(MOD_RANGES.gem_yield.max)
            }
        }
        for (const row of (await agents()).values()) {
            const t = find(row.traits as Entry[], 'gem_yield')
            if (t) {
                expect(t.value).toBeGreaterThanOrEqual(AGENT_TRAIT_RANGES.gem_yield.min)
                expect(t.value).toBeLessThanOrEqual(AGENT_TRAIT_RANGES.gem_yield.max)
            }
        }
    })

    it('merges two gem stats into one without costing a slot', async () => {
        await runMigration()
        const item = (await items()).get('gm-i3')!
        const mods = item.mods as Entry[]
        expect(mods).toHaveLength(RARITY_MOD_COUNT.phantom)
        expect(new Set(mods.map(m => m.type)).size).toBe(mods.length)
        expect(find(mods, 'gem_yield')!.value).toBe(MOD_RANGES.gem_yield.max)

        const agent = (await agents()).get('gm-a2')!
        const traits = agent.traits as Entry[]
        expect(traits).toHaveLength(AGENT_TRAIT_COUNT.phantom)
        expect(new Set(traits.map(t => t.type)).size).toBe(traits.length)
        expect(find(traits, 'gem_yield')!.value).toBe(AGENT_TRAIT_RANGES.gem_yield.max)
    })

    it('carries a fractionally-stacked artifact trait across', async () => {
        await runMigration()
        // 1.65 sits 32.5% up the old 1-3 band, so it lands 32.5% up the floored new band.
        const t = find((await agents()).get('gm-a1')!.traits as Entry[], 'gem_yield')!
        expect(t.value).toBeCloseTo(43.1, 1)
    })

    it('sums colliding artifact stacks instead of discarding them', async () => {
        await runMigration()
        const arts = await db.query.hackArtifacts.findMany({ where: eq(hackArtifacts.userId, USER_ID) })
        const phantom = arts.filter(a => a.rarity === 'phantom')
        expect(phantom).toHaveLength(1)
        expect(phantom[0]!.count).toBe(9)
        expect(arts.find(a => a.rarity === 'ghost')!.count).toBe(6)
    })

    it('leaves already-converted rows untouched', async () => {
        await runMigration()
        expect((await items()).get('gm-i4')!.mods).toEqual([
            { type: 'gem_yield', value: 31.5 }, { type: 'xp_flat', value: 4 }
        ])
    })

    it('is a no-op on a second run, so a re-deploy cannot double-convert', async () => {
        await runMigration()
        const before = JSON.stringify([...(await items())].concat([...(await agents())] as never))
        const artsBefore = await db.query.hackArtifacts.findMany({ where: eq(hackArtifacts.userId, USER_ID) })
        await runMigration()
        const after = JSON.stringify([...(await items())].concat([...(await agents())] as never))
        const artsAfter = await db.query.hackArtifacts.findMany({ where: eq(hackArtifacts.userId, USER_ID) })
        expect(after).toBe(before)
        expect(artsAfter).toEqual(artsBefore)
    })
})
