import { and, asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy, tcgSheet } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import type { TcgCopySummary } from '#shared/types/tcg'

/**
 * The caller's copies of one printing, for the copy picker. Selects explicit
 * columns only — the condition column is NEVER read here (§6.1); wear data
 * comes exclusively from GET /api/tcg/copy-render.
 */
export default defineEventHandler(async (event): Promise<TcgCopySummary[]> => {
    const userId = await requireUserId(event)
    const printingId = getQuery(event).printingId
    if (typeof printingId !== 'string' || !printingId) {
        throw createError({ statusCode: 400, statusMessage: 'printingId is required' })
    }

    const rows = await db.select({
        id: tcgCopy.id,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset,
        createdAt: tcgCopy.createdAt,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots
    })
        .from(tcgCopy)
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .where(and(eq(tcgCopy.ownerId, userId), eq(tcgCopy.printingId, printingId)))
        .orderBy(asc(tcgCopy.createdAt), asc(tcgCopy.id))

    return rows.map(row => ({
        id: row.id,
        // Same display serial the pack opener shows (engine.ts openPack)
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        cutIndex: row.cutIndex,
        slotOffset: row.slotOffset,
        createdAt: row.createdAt.toISOString()
    }))
})
