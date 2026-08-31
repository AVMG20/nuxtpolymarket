/**
 * Draft repair and teardown: refitSet resets a hand-edited draft to the
 * fitter's output, deleteSet removes a run nobody has bought into. Both are
 * admin escape hatches, so the guards matter more than the happy path.
 * Real Postgres from .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate, tcgPack, tcgCopy } from '#server/database/schema'
import { commitSet, buyPack, openPack, deleteSet, refitSet } from '#server/utils/tcg/engine'
import type { RateTemplate } from '#shared/utils/tcg/rate-fitter'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-tcg-teardown-user'
const CODE = 'TRDN'
const createdSetIds: string[] = []

/** A one-slot template whose whole checklist is four commons. */
const RATES: RateTemplate = {
    code: 'trdn',
    slug: 'teardown',
    name: 'Teardown',
    url: 'https://example.test/teardown',
    scrapedAt: '2026-08-01T00:00:00Z',
    cardsPerPack: 1,
    packsPerBox: null,
    tiers: [
        { label: 'Common', group: 'guaranteed', pattern: null, baseRarity: null, perPack: 1, specificOneIn: null, poolSize: 4 }
    ]
}

/** A draft set with a four-card checklist and one hand-authored sheet. */
async function buildDraft(overrides: Partial<typeof tcgSet.$inferInsert> = {}): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `teardown spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: CODE,
        status: 'draft',
        targetPackCount: 10,
        ...overrides
    }).returning()
    createdSetIds.push(set!.id)

    const printingIds: string[] = []
    for (let i = 0; i < 4; i++) {
        const [card] = await db.insert(tcgCard).values({
            setId: set!.id,
            plaatjesBaseId: `trdn-${i}`,
            number: String(i + 1).padStart(3, '0'),
            name: `Teardownling ${i}`,
            rarity: 'Common',
            rarityCode: 'C',
            raw: {}
        }).returning()
        const [printing] = await db.insert(tcgPrinting).values({
            setId: set!.id, cardId: card!.id, plaatjesCardId: `trdn-${i}`, finish: 'nonholo'
        }).returning()
        printingIds.push(printing!.id)
    }

    // The 'manual edit': one sheet holding a single printing, so three of the
    // four cards can never be pulled.
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'hand-authored', role: 'base', packSlots: 1, layout: [printingIds[0]!]
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId: set!.id, kind: 'base', slots: [{ sheetId: sheet!.id, count: 1 }]
    })
    return set!.id
}

describe.skipIf(SKIP)('tcg draft repair and teardown', () => {
    beforeAll(async () => {
        await cleanupSets()
        await cleanupUser(USER)
        await seedUser(USER, { balance: '0', gems: 100 })
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        await cleanupUser(USER)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, CODE))
    }

    it('refit replaces hand-authored sheets with the automatic fit', async () => {
        const setId = await buildDraft({ templateCode: 'trdn', publishedRates: RATES })
        const result = await refitSet(setId)
        expect(result.warnings).toEqual([])
        expect(result.diagnostics.map(d => d.label)).toEqual(['Common'])

        const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
        expect(sheets).toHaveLength(1)
        expect(sheets[0]!.name).not.toBe('hand-authored')
        // Every card in the tier is back on the sheet.
        expect(new Set(sheets[0]!.layout).size).toBe(4)

        // The pack template was rebuilt against the new sheet, not orphaned.
        const templates = await db.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, setId))
        expect(templates).toHaveLength(1)
        expect(templates[0]!.slots).toEqual([{ sheetId: sheets[0]!.id, count: 1 }])
    }, 30_000)

    it('refit is refused without a rate template, and once committed', async () => {
        const manual = await buildDraft()
        await expect(refitSet(manual)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: expect.stringContaining('not created from a rate template')
        })

        const committed = await buildDraft({ templateCode: 'trdn-c', publishedRates: RATES })
        await commitSet(committed)
        await expect(refitSet(committed)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'Set is committed and frozen'
        })
    }, 30_000)

    it('deletes a draft with its checklist, printings and sheets', async () => {
        const setId = await buildDraft()
        const result = await deleteSet(setId)
        expect(result).toMatchObject({ cards: 4, printings: 4, sheets: 1 })

        expect(await db.select().from(tcgSet).where(eq(tcgSet.id, setId))).toHaveLength(0)
        expect(await db.select().from(tcgCard).where(eq(tcgCard.setId, setId))).toHaveLength(0)
        expect(await db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, setId))).toHaveLength(0)
        expect(await db.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))).toHaveLength(0)
        expect(await db.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, setId))).toHaveLength(0)
    }, 30_000)

    it('deletes a committed run that has sold nothing, but not one that has', async () => {
        const unsold = await buildDraft()
        await commitSet(unsold)
        await expect(deleteSet(unsold)).resolves.toMatchObject({ cards: 4 })

        const sold = await buildDraft()
        await commitSet(sold)
        const pack = await buyPack(sold, USER)
        await expect(deleteSet(sold)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: expect.stringContaining('have been sold')
        })
        // The player's pack and its set are untouched by the refusal.
        expect(await db.select().from(tcgPack).where(eq(tcgPack.id, pack.id))).toHaveLength(1)
        expect(await db.select().from(tcgSet).where(eq(tcgSet.id, sold))).toHaveLength(1)
    }, 30_000)

    it('refuses while a reprint still points at the run', async () => {
        const parent = await buildDraft()
        await commitSet(parent)
        const child = await buildDraft({ reprintOfSetId: parent, printRunLabel: 'Unlimited' })

        await expect(deleteSet(parent)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: expect.stringContaining('is a reprint of this run')
        })

        // Deleting the reprint first clears the way.
        await deleteSet(child)
        await expect(deleteSet(parent)).resolves.toMatchObject({ cards: 4 })
    }, 30_000)

    // The refusal is what keeps a player's collection intact: the cascade
    // from tcg_sets reaches copies, so a delete that got through here would
    // vaporise cards someone owns.
    it('keeps minted copies when a run with an opened pack refuses deletion', async () => {
        const setId = await buildDraft()
        await commitSet(setId)
        const pack = await buyPack(setId, USER)
        await openPack(pack.id, USER)
        expect(await db.select().from(tcgCopy).where(eq(tcgCopy.setId, setId))).toHaveLength(1)

        await expect(deleteSet(setId)).rejects.toMatchObject({ statusCode: 400 })
        expect(await db.select().from(tcgCopy).where(eq(tcgCopy.setId, setId))).toHaveLength(1)
    }, 30_000)
})
