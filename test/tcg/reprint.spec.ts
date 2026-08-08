/**
 * Reprints (§3.6): the announcement gate on the buy path and the
 * createTemplateSet guards that let a reprint share its parent's template
 * while plain duplicates keep 409ing. Real Postgres from .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { commitSet, buyPack } from '#server/utils/tcg/engine'
import { createTemplateSet } from '#server/utils/tcg/import'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-tcg-reprint-user'
const createdSetIds: string[] = []
const TEMPLATE = 'rpt-test'

async function buildCommittedSet(overrides: Partial<typeof tcgSet.$inferInsert> = {}): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `reprint spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'RPRT',
        status: 'draft',
        targetPackCount: 20,
        ...overrides
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'rpt-0', number: '001', name: 'Reprintling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'rpt-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'r', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId: set!.id, kind: 'base', slots: [{ sheetId: sheet!.id, count: 1 }]
    })
    await commitSet(set!.id)
    return set!.id
}

/** Minimal one-card payload for createTemplateSet. */
function templatePayload(setId: string, printRunLabel?: string) {
    const cardId = crypto.randomUUID()
    const printingId = crypto.randomUUID()
    return {
        cardRows: [{ id: cardId, setId, plaatjesBaseId: 'rpt-t0', number: '001', name: 'Reprintling', raw: {} }],
        printingRows: [{
            id: printingId, setId, cardId, plaatjesCardId: 'rpt-t0',
            finish: 'nonholo', ...(printRunLabel ? { printRunLabel } : {})
        }],
        sheets: [{ name: 'r', role: 'base' as const, packSlots: 1, mults: [[printingId, 1]] as [string, number][], layout: [printingId] }],
        slots: [{ sheetName: 'r', count: 1 }]
    }
}

describe.skipIf(SKIP)('tcg reprints', () => {
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
        await db.delete(tcgSet).where(eq(tcgSet.code, 'RPRT'))
        await db.delete(tcgSet).where(eq(tcgSet.templateCode, TEMPLATE))
    }

    it('the announcement gate: committed but not yet on sale sells nothing', async () => {
        const future = new Date(Date.now() + 3600_000)
        const announced = await buildCommittedSet({ onSaleAt: future, printRunLabel: 'Unlimited' })
        await expect(buyPack(announced, USER))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not on sale yet' })

        await db.update(tcgSet).set({ onSaleAt: sql`now() - interval '1 second'` }).where(eq(tcgSet.id, announced))
        const pack = await buyPack(announced, USER)
        expect(pack.state).toBe('sealed')

        // NULL onSaleAt (every first run) keeps today's behavior.
        const plain = await buildCommittedSet()
        const pack2 = await buyPack(plain, USER)
        expect(pack2.state).toBe('sealed')
    }, 30_000)

    it('createTemplateSet: reprints share the template, duplicates do not', async () => {
        const parentId = await buildCommittedSet({ templateCode: TEMPLATE })

        // Plain duplicate of a committed template → still 409.
        const dupId = crypto.randomUUID()
        const dup = templatePayload(dupId)
        await expect(createTemplateSet(
            { id: dupId, name: 'dup', code: 'RPRT', templateCode: TEMPLATE, status: 'draft' },
            dup.cardRows, dup.printingRows, dup.sheets, dup.slots
        )).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Set already exists for this template' })

        // A reprint of the parent is allowed, and its printings carry the label.
        const reprintId = crypto.randomUUID()
        const rp = templatePayload(reprintId, 'Unlimited')
        await createTemplateSet(
            {
                id: reprintId, name: 'reprint', code: 'RPRT', templateCode: TEMPLATE,
                status: 'draft', reprintOfSetId: parentId, printRunLabel: 'Unlimited',
                onSaleAt: new Date(Date.now() + 3600_000)
            },
            rp.cardRows, rp.printingRows, rp.sheets, rp.slots
        )
        createdSetIds.push(reprintId)
        const [row] = await db.select().from(tcgSet).where(eq(tcgSet.id, reprintId))
        expect(row).toMatchObject({ reprintOfSetId: parentId, printRunLabel: 'Unlimited' })
        const printings = await db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, reprintId))
        expect(printings.every(p => p.printRunLabel === 'Unlimited')).toBe(true)
        // The parent's printings stay first-run.
        const parentPrintings = await db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, parentId))
        expect(parentPrintings.every(p => p.printRunLabel === '1st')).toBe(true)

        // A second draft reprint of the same parent → 409.
        const secondId = crypto.randomUUID()
        const second = templatePayload(secondId, '3rd')
        await expect(createTemplateSet(
            {
                id: secondId, name: 'third', code: 'RPRT', templateCode: TEMPLATE,
                status: 'draft', reprintOfSetId: parentId, printRunLabel: '3rd'
            },
            second.cardRows, second.printingRows, second.sheets, second.slots
        )).rejects.toMatchObject({ statusCode: 409, statusMessage: 'A reprint of this set is already in draft' })
    }, 30_000)
})
