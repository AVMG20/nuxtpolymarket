/**
 * Shop settings (§7.3): the admin-tunable pack economics, and their effect on
 * the buy path. Real Postgres from .env; restores defaults afterwards so the
 * other specs' assumptions hold.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate, tcgSettings } from '#server/database/schema'
import { getShopSettings, updateShopSettings, TCG_SHOP_DEFAULTS } from '#server/utils/tcg/settings'
import { playerBuyPacks } from '#server/utils/tcg/player'
import { commitSet } from '#server/utils/tcg/engine'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-tcg-settings-user'
const createdSetIds: string[] = []
// Saturday inside the bundle window, same anchor player.spec.ts uses.
const IN_WINDOW = new Date('2026-08-01T12:00:00Z')

let setId: string

async function buildCommittedSet(): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `settings spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'STNG',
        status: 'draft',
        targetPackCount: 50
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'stng-0', number: '001', name: 'Settingling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'stng-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 's', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId: set!.id, kind: 'base', slots: [{ sheetId: sheet!.id, count: 1 }]
    })
    await commitSet(set!.id)
    return set!.id
}

describe.skipIf(SKIP)('tcg shop settings', () => {
    beforeAll(async () => {
        await cleanupSets()
        await db.delete(tcgSettings).where(eq(tcgSettings.id, 'shop'))
        await cleanupUser(USER)
        await seedUser(USER, { balance: '0', gems: 100 })
        setId = await buildCommittedSet()
    }, 60_000)

    afterAll(async () => {
        // The row must not outlive the spec: player.spec.ts asserts against
        // the defaults.
        await db.delete(tcgSettings).where(eq(tcgSettings.id, 'shop'))
        await cleanupSets()
        await cleanupUser(USER)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'STNG'))
    }

    it('defaults apply when no row exists; updates round-trip', async () => {
        expect(await getShopSettings()).toEqual(TCG_SHOP_DEFAULTS)

        const next = { packsPerPair: 2, gemsPerPair: 3, packsPerDay: 2, bundlePacks: 5, bundleGems: 4 }
        await updateShopSettings(next)
        expect(await getShopSettings()).toEqual(next)
    })

    it('validates: non-integers, out-of-range, cap below one pair', async () => {
        await expect(updateShopSettings({ ...TCG_SHOP_DEFAULTS, gemsPerPair: 0 }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(updateShopSettings({ ...TCG_SHOP_DEFAULTS, packsPerDay: 1.5 }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(updateShopSettings({ ...TCG_SHOP_DEFAULTS, packsPerDay: 1, packsPerPair: 2 }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Daily cap below one pair — nothing would be buyable' })
    })

    it('the buy path prices and caps from settings', async () => {
        // From the previous test: 2 packs/pair at 3 gems, cap 2/day.
        const packs = await playerBuyPacks(setId, USER, 1, IN_WINDOW)
        expect(packs).toHaveLength(2)
        // A second pair the same day exceeds the tightened cap.
        await expect(playerBuyPacks(setId, USER, 1, IN_WINDOW))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Daily pack allowance reached' })

        // 3 gems paid, not the default 1.
        const { user } = await import('#server/database/schema')
        const [row] = await db.select({ gems: user.gems }).from(user).where(eq(user.id, USER))
        expect(row!.gems).toBe(97)
    })
})
