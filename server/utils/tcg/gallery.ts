import { and, count, desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgCopy } from '#server/database/schema'
import type { GalleryPayload, GalleryPrinting, GallerySet, TcgFinish } from '#shared/types/tcg'

/**
 * The owned-first collection view (§10): every printing a user owns, across
 * ALL committed sets at once, with the render fields the tiles need and a
 * public grade summary. Collections are public to logged-in users — same
 * policy as the trades counterpart view. Copy rows are projected to counts
 * and public grade columns ONLY — the condition column must never be read
 * into any payload (§6.1).
 */
export async function galleryFor(userId: string): Promise<GalleryPayload> {
    const ownedRows = await db.select({
        printingId: tcgCopy.printingId,
        owned: count()
    })
        .from(tcgCopy)
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            ne(tcgCopy.lifecycle, 'destroyed'),
            eq(tcgSet.status, 'committed')
        ))
        .groupBy(tcgCopy.printingId)
    if (ownedRows.length === 0) return []
    const ownedByPrinting = new Map(ownedRows.map(row => [row.printingId, row.owned]))
    const printingIds = [...ownedByPrinting.keys()]

    const [printings, slabRows] = await Promise.all([
        db.select({
            id: tcgPrinting.id,
            setId: tcgPrinting.setId,
            plaatjesCardId: tcgPrinting.plaatjesCardId,
            finish: tcgPrinting.finish,
            pattern: tcgPrinting.pattern,
            printRunLabel: tcgPrinting.printRunLabel,
            bundle: tcgPrinting.bundle,
            assetNumber: tcgPrinting.assetNumber,
            maskKind: tcgPrinting.maskKind,
            foilEffect: tcgPrinting.foilEffect,
            cardName: tcgCard.name,
            cardNumber: tcgCard.number,
            setTotal: tcgCard.setTotal,
            rarity: tcgCard.rarity,
            sortOrder: tcgCard.sortOrder
        })
            .from(tcgPrinting)
            .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
            .where(inArray(tcgPrinting.id, printingIds)),
        db.select({
            printingId: tcgCopy.printingId,
            service: tcgCopy.gradeService,
            grade: tcgCopy.grade,
            score: tcgCopy.gradeScore,
            designation: tcgCopy.gradeDesignation,
            subGrades: tcgCopy.gradeSubs,
            flaws: tcgCopy.gradeFlaws,
            certNumber: tcgCopy.certNumber,
            gradedAt: tcgCopy.gradedAt
        })
            .from(tcgCopy)
            .where(and(
                eq(tcgCopy.ownerId, userId),
                eq(tcgCopy.lifecycle, 'slabbed'),
                inArray(tcgCopy.printingId, printingIds)
            ))
    ])

    // Best slab per printing: numeric grade first, fine score as tiebreak.
    const slabbedByPrinting = new Map<string, number>()
    const topGradeByPrinting = new Map<string, GalleryPrinting['topGrade']>()
    const bestKey = new Map<string, [number, number]>()
    for (const slab of slabRows) {
        slabbedByPrinting.set(slab.printingId, (slabbedByPrinting.get(slab.printingId) ?? 0) + 1)
        if (!slab.service || !slab.grade || !slab.certNumber || !slab.gradedAt) continue
        const key: [number, number] = [Number(slab.grade) || 0, slab.score ?? 0]
        const prev = bestKey.get(slab.printingId)
        if (!prev || key[0] > prev[0] || (key[0] === prev[0] && key[1] > prev[1])) {
            bestKey.set(slab.printingId, key)
            topGradeByPrinting.set(slab.printingId, {
                service: slab.service,
                grade: slab.grade,
                score: slab.score,
                designation: slab.designation,
                subGrades: slab.subGrades,
                flaws: slab.flaws,
                certNumber: slab.certNumber,
                gradedAt: slab.gradedAt.toISOString()
            })
        }
    }

    const setIds = [...new Set(printings.map(printing => printing.setId))]
    const [setRows, totalRows] = await Promise.all([
        db.select({
            id: tcgSet.id,
            name: tcgSet.name,
            code: tcgSet.code,
            releaseDate: tcgSet.releaseDate,
            printRunLabel: tcgSet.printRunLabel,
            createdAt: tcgSet.createdAt
        })
            .from(tcgSet)
            .where(inArray(tcgSet.id, setIds))
            .orderBy(desc(tcgSet.createdAt)),
        db.select({ setId: tcgPrinting.setId, total: count() })
            .from(tcgPrinting)
            .where(inArray(tcgPrinting.setId, setIds))
            .groupBy(tcgPrinting.setId)
    ])
    const totalBySet = new Map(totalRows.map(row => [row.setId, row.total]))

    const printingsBySet = new Map<string, GalleryPrinting[]>()
    for (const printing of printings) {
        const list = printingsBySet.get(printing.setId) ?? []
        list.push({
            id: printing.id,
            plaatjesCardId: printing.plaatjesCardId,
            finish: printing.finish as TcgFinish,
            pattern: printing.pattern,
            printRunLabel: printing.printRunLabel,
            bundle: printing.bundle,
            assetNumber: printing.assetNumber,
            maskKind: printing.maskKind,
            foilEffect: printing.foilEffect,
            cardName: printing.cardName,
            cardNumber: printing.cardNumber,
            setTotal: printing.setTotal,
            rarity: printing.rarity,
            sortOrder: printing.sortOrder,
            owned: ownedByPrinting.get(printing.id) ?? 0,
            slabbed: slabbedByPrinting.get(printing.id) ?? 0,
            topGrade: topGradeByPrinting.get(printing.id) ?? null
        })
        printingsBySet.set(printing.setId, list)
    }

    const finishRank: Record<string, number> = { nonholo: 0, holo: 1, reverse: 2 }
    return setRows.map((set): GallerySet => ({
        id: set.id,
        name: set.name,
        code: set.code,
        releaseDate: set.releaseDate,
        printRunLabel: set.printRunLabel,
        printingsTotal: totalBySet.get(set.id) ?? 0,
        printings: (printingsBySet.get(set.id) ?? []).sort((a, b) =>
            a.sortOrder - b.sortOrder
            || (finishRank[a.finish] ?? 9) - (finishRank[b.finish] ?? 9)
            || (a.pattern ?? '').localeCompare(b.pattern ?? ''))
    }))
}
