/**
 * Integration tests for the player purchase flows (daily allowance + Friday
 * bundle) against the real Postgres from .env. Skips when DATABASE_URL is
 * unset. Every entry point takes an injected `now`, so windows and date keys
 * are fixed — no clock stubbing needed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate, tcgPack, tcgAllowance, tcgBundle } from '#server/database/schema'
import { commitSet } from '#server/utils/tcg/engine'
import { playerBuyPacks, claimBundle } from '#server/utils/tcg/player'
import { TCG_SHOP_DEFAULTS } from '#server/utils/tcg/settings'
import { amsterdamDateKey } from '#shared/utils/tcg/time'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const { packsPerDay: PACKS_PER_DAY, bundlePacks: BUNDLE_PACKS, bundleGems: BUNDLE_GEMS } = TCG_SHOP_DEFAULTS

// 2026-08-01 is a Saturday in Amsterdam — inside the Fri→Mon bundle window.
const IN_WINDOW = new Date('2026-08-01T12:00:00Z')
// 2026-08-05 is a Wednesday — window closed.
const CLOSED = new Date('2026-08-05T12:00:00Z')

const USERS = {
    allowance: 'test-tcg-player-allowance',
    bundle: 'test-tcg-player-bundle',
    broke: 'test-tcg-player-broke',
    closed: 'test-tcg-player-closed',
    sellout: 'test-tcg-player-sellout'
}
const createdSetIds: string[] = []

async function makePrintings(setId: string, prefix: string, count: number): Promise<string[]> {
    const cards = await db.insert(tcgCard).values(
        Array.from({ length: count }, (_, i) => ({
            setId,
            plaatjesBaseId: `${prefix}-${i}`,
            number: `${prefix}${i}`,
            name: `${prefix} card ${i}`,
            raw: {}
        }))
    ).returning()
    const printings = await db.insert(tcgPrinting).values(
        cards.map((card, i) => ({
            setId,
            cardId: card.id,
            plaatjesCardId: `${prefix}-${i}`,
            finish: 'nonholo'
        }))
    ).returning()
    return printings.map(p => p.id)
}

/** Committed set with one base sheet (M=12, k=4) and one hit sheet (M=6, k=1). */
async function buildCommittedSet(N: number): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `player spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'PLYR',
        status: 'draft',
        targetPackCount: N
    }).returning()
    const setId = set!.id
    createdSetIds.push(setId)

    const basePrintingIds = await makePrintings(setId, 'base', 12)
    const hitPrintingIds = await makePrintings(setId, 'hit', 6)
    const [baseSheet] = await db.insert(tcgSheet).values({
        setId, name: 'commons', role: 'base', packSlots: 4, layout: basePrintingIds
    }).returning()
    const [hitSheet] = await db.insert(tcgSheet).values({
        setId, name: 'hits', role: 'base', packSlots: 1, layout: hitPrintingIds
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId,
        kind: 'base',
        slots: [
            { sheetId: baseSheet!.id, count: 4 },
            { sheetId: hitSheet!.id, count: 1 }
        ]
    })
    await commitSet(setId)
    return setId
}

async function gemsOf(userId: string): Promise<number> {
    const [row] = await db.select({ gems: user.gems }).from(user).where(eq(user.id, userId))
    return row!.gems
}

describe.skipIf(SKIP)('tcg player integration', () => {
    let setId: string

    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { gems: id === USERS.broke ? 0 : 100 })
        }
        setId = await buildCommittedSet(80)
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'PLYR'))
    }

    it('allowance burst: 1 pair bought, then 20 concurrent pairs → exactly 1 more succeeds', async () => {
        const userId = USERS.allowance
        const first = await playerBuyPacks(setId, userId, 1, IN_WINDOW)
        expect(first).toHaveLength(2)

        const result = await burst(20, () => playerBuyPacks(setId, userId, 1, IN_WINDOW))
        expect(result).toEqual({ ok: 1, rejected: 19 })

        const [allowance] = await db.select().from(tcgAllowance).where(and(
            eq(tcgAllowance.userId, userId),
            eq(tcgAllowance.dateKey, amsterdamDateKey(IN_WINDOW))
        ))
        expect(allowance!.packsBought).toBe(PACKS_PER_DAY)

        const packs = await db.select().from(tcgPack).where(eq(tcgPack.ownerId, userId))
        expect(packs).toHaveLength(4)
        // 2 pairs succeeded in total → exactly 2 gems debited.
        expect(await gemsOf(userId)).toBe(98)
    }, 60_000)

    it('rejects invalid pair counts without touching anything', async () => {
        for (const pairs of [0, 3, 1.5, -1]) {
            await expect(playerBuyPacks(setId, USERS.closed, pairs, IN_WINDOW))
                .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid pair count' })
        }
        const rows = await db.select().from(tcgAllowance).where(eq(tcgAllowance.userId, USERS.closed))
        expect(rows).toHaveLength(0)
    })

    it('bundle double-claim burst: 1 bundle, 36 linked packs, 18 gems once', async () => {
        const userId = USERS.bundle
        const result = await burst(10, () => claimBundle(setId, userId, IN_WINDOW))
        expect(result).toEqual({ ok: 1, rejected: 9 })

        const bundles = await db.select().from(tcgBundle).where(eq(tcgBundle.ownerId, userId))
        expect(bundles).toHaveLength(1)
        const packs = await db.select().from(tcgPack).where(eq(tcgPack.ownerId, userId))
        expect(packs).toHaveLength(BUNDLE_PACKS)
        for (const pack of packs) expect(pack.bundleId).toBe(bundles[0]!.id)
        expect(await gemsOf(userId)).toBe(100 - BUNDLE_GEMS)
    }, 120_000)

    it('zero gems: buy rejects atomically — no allowance consumed, no packs', async () => {
        const userId = USERS.broke
        await expect(playerBuyPacks(setId, userId, 1, IN_WINDOW)).rejects.toMatchObject({
            statusCode: 400, statusMessage: 'Not enough gems'
        })
        const allowances = await db.select().from(tcgAllowance).where(eq(tcgAllowance.userId, userId))
        expect(allowances).toHaveLength(0)
        const packs = await db.select().from(tcgPack).where(eq(tcgPack.ownerId, userId))
        expect(packs).toHaveLength(0)
    })

    it('window-closed claim rejects with no rows written', async () => {
        const userId = USERS.closed
        await expect(claimBundle(setId, userId, CLOSED)).rejects.toMatchObject({
            statusCode: 400, statusMessage: 'Bundle window is closed'
        })
        const bundles = await db.select().from(tcgBundle).where(eq(tcgBundle.ownerId, userId))
        expect(bundles).toHaveLength(0)
        expect(await gemsOf(userId)).toBe(100)
    })

    it('bundle sellout: claim on a tiny set rolls back bundle row, gems and packs', async () => {
        const userId = USERS.sellout
        const tinySetId = await buildCommittedSet(10)
        await expect(claimBundle(tinySetId, userId, IN_WINDOW)).rejects.toMatchObject({
            statusCode: 400, statusMessage: 'Sold out'
        })
        const bundles = await db.select().from(tcgBundle).where(eq(tcgBundle.ownerId, userId))
        expect(bundles).toHaveLength(0)
        const packs = await db.select().from(tcgPack).where(eq(tcgPack.ownerId, userId))
        expect(packs).toHaveLength(0)
        expect(await gemsOf(userId)).toBe(100)
        // The failed claim did not consume the weekly slot.
        const retrySetId = await buildCommittedSet(40)
        const { packs: claimed } = await claimBundle(retrySetId, userId, IN_WINDOW)
        expect(claimed).toHaveLength(BUNDLE_PACKS)
    }, 120_000)
})
