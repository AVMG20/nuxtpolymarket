import { and, asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy, tcgSheet, tcgListing } from '#server/database/schema'
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
        packSlots: tcgSheet.packSlots,
        lifecycle: tcgCopy.lifecycle,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        gradeScore: tcgCopy.gradeScore,
        gradeDesignation: tcgCopy.gradeDesignation,
        gradeSubs: tcgCopy.gradeSubs,
        gradeFlaws: tcgCopy.gradeFlaws,
        certNumber: tcgCopy.certNumber,
        gradedAt: tcgCopy.gradedAt,
        listingId: tcgListing.id,
        listedPrice: tcgListing.price
    })
        .from(tcgCopy)
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .leftJoin(tcgListing, and(eq(tcgListing.copyId, tcgCopy.id), eq(tcgListing.state, 'active')))
        .where(and(eq(tcgCopy.ownerId, userId), eq(tcgCopy.printingId, printingId)))
        .orderBy(asc(tcgCopy.createdAt), asc(tcgCopy.id))

    return rows.map(row => ({
        id: row.id,
        // Same display serial the pack opener shows (engine.ts openPack)
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        cutIndex: row.cutIndex,
        slotOffset: row.slotOffset,
        createdAt: row.createdAt.toISOString(),
        lifecycle: row.lifecycle,
        listingId: row.listingId,
        listedPrice: row.listedPrice !== null ? parseFloat(row.listedPrice) : null,
        grade: row.grade && row.gradeService && row.certNumber && row.gradedAt
            ? {
                    service: row.gradeService,
                    grade: row.grade,
                    score: row.gradeScore,
                    designation: row.gradeDesignation,
                    subGrades: row.gradeSubs,
                    flaws: row.gradeFlaws,
                    certNumber: row.certNumber,
                    gradedAt: row.gradedAt.toISOString()
                }
            : null
    }))
})
