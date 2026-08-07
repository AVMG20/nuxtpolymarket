import { desc, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSubmission, tcgCopy, tcgPrinting, tcgCard, tcgSet, tcgSheet } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import type { TcgSubmissionSummary } from '#shared/types/tcg'

/**
 * The caller's grading submissions, newest first: pending ones with their
 * countdown, collected ones as history (carrying the grade the copy holds).
 * The condition column is never selected (§6.1).
 */
export default defineEventHandler(async (event): Promise<TcgSubmissionSummary[]> => {
    const userId = await requireUserId(event)

    const rows = await db.select({
        id: tcgSubmission.id,
        copyId: tcgSubmission.copyId,
        service: tcgSubmission.service,
        fee: tcgSubmission.fee,
        predictedGrade: tcgSubmission.predictedGrade,
        state: tcgSubmission.state,
        result: tcgSubmission.gradeResult,
        submissionCertNumber: tcgSubmission.certNumber,
        submissionGradedAt: tcgSubmission.gradedAt,
        submittedAt: tcgSubmission.submittedAt,
        returnsAt: tcgSubmission.returnsAt,
        ready: sql<boolean>`${tcgSubmission.returnsAt} <= now()`,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        cardName: tcgCard.name,
        rarity: tcgCard.rarity,
        number: tcgCard.number,
        setTotal: tcgCard.setTotal,
        setName: tcgSet.name,
        setCode: tcgSet.code,
        releaseDate: tcgSet.releaseDate,
        bundle: tcgPrinting.bundle,
        assetNumber: tcgPrinting.assetNumber,
        maskKind: tcgPrinting.maskKind,
        foilEffect: tcgPrinting.foilEffect,
        pattern: tcgPrinting.pattern,
        finish: tcgPrinting.finish,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        gradeScore: tcgCopy.gradeScore,
        gradeDesignation: tcgCopy.gradeDesignation,
        gradeSubs: tcgCopy.gradeSubs,
        gradeFlaws: tcgCopy.gradeFlaws,
        certNumber: tcgCopy.certNumber,
        gradedAt: tcgCopy.gradedAt
    })
        .from(tcgSubmission)
        .innerJoin(tcgCopy, eq(tcgSubmission.copyId, tcgCopy.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .where(eq(tcgSubmission.userId, userId))
        .orderBy(desc(tcgSubmission.submittedAt))
        .limit(100)

    return rows.map(row => ({
        id: row.id,
        copyId: row.copyId,
        service: row.service,
        fee: Number(row.fee),
        predictedGrade: row.predictedGrade,
        state: row.state,
        submittedAt: row.submittedAt.toISOString(),
        returnsAt: row.returnsAt.toISOString(),
        ready: row.ready,
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        card: {
            name: row.cardName,
            rarity: row.rarity,
            number: row.number,
            setTotal: row.setTotal,
            setName: row.setName,
            setCode: row.setCode,
            releaseDate: row.releaseDate
        },
        render: {
            bundle: row.bundle,
            assetNumber: row.assetNumber,
            maskKind: row.maskKind,
            foilEffect: row.foilEffect,
            pattern: row.pattern,
            finish: row.finish,
            plaatjesCardId: row.plaatjesCardId
        },
        grade: row.state === 'graded' && row.result && row.submissionCertNumber && row.submissionGradedAt
            ? {
                    service: row.result.service,
                    grade: String(row.result.grade),
                    score: row.result.score,
                    designation: row.result.designation,
                    subGrades: row.result.subGrades,
                    flaws: row.result.flaws,
                    certNumber: row.submissionCertNumber,
                    gradedAt: row.submissionGradedAt.toISOString()
                }
            : row.state === 'graded' && row.grade && row.gradeService && row.certNumber && row.gradedAt
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
