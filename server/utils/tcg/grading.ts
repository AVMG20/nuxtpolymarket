import { and, eq, sql, isNotNull, desc } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy, tcgSubmission, tcgPrinting, tcgCard } from '#server/database/schema'
import { debit } from '#server/utils/balance'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { submit } from '#shared/utils/tcg/grading-model'
import type { TcgGradeResult, TcgServiceKey, TcgCondition } from '#shared/utils/tcg/grading-model-types'
import { gaussSample } from '#shared/utils/tcg/condition'
import { TCG_GRADING, gradingFeeFor, isTcgService, isValidGrade } from '#shared/utils/tcg/grading-fees'
import { randomInt, randomChance, randomFloat, randomPick } from '#shared/utils/random'
import { lockCopyForUpdate, hasActiveListing } from '#server/utils/tcg/market'

/*
 * Grading (§6.4): submit → wait → collect → (maybe) crack and try again.
 *
 * Concurrency doctrine throughout: every state change is a conditional
 * UPDATE whose WHERE clause is the guard. The copy's lifecycle carries the
 * grading state machine — 'raw' → 'grading' → 'slabbed' → (crack) → 'raw' —
 * and only the transition that wins its claim performs side effects.
 *
 * The grade is computed at COLLECTION time, not submission time. Nothing is
 * predetermined while the card is at the grader, which matches how it feels
 * — and re-submitting a cracked card genuinely re-rolls the reading.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

export interface SubmissionRow {
    id: string
    copyId: string
    service: TcgServiceKey
    fee: string
    predictedGrade: string | null
    state: string
    submittedAt: Date
    returnsAt: Date
}

export async function submitForGrading(
    userId: string,
    copyId: string,
    service: string,
    predictedGrade: string | null
): Promise<SubmissionRow> {
    if (!isTcgService(service)) badRequest('Unknown grading service')
    if (predictedGrade !== null && !isValidGrade(predictedGrade)) {
        badRequest('Invalid predicted grade')
    }
    // Anchored to the gem exchange at submission time: the price you saw is
    // the price you pay, and it moves with the market between submissions.
    const fee = gradingFeeFor(service as TcgServiceKey, await getGemGuidePrice())

    return await db.transaction(async (tx) => {
        // Copy row lock first: market and grading mutations all queue here,
        // so the listing check below cannot race a concurrent listCopy.
        await lockCopyForUpdate(tx, copyId)
        if (await hasActiveListing(tx, copyId)) badRequest('Copy is listed on the market')
        // The claim: raw → grading. Losing it means the copy is already at a
        // grader, already slabbed, or not this player's to send.
        const [claimed] = await tx.update(tcgCopy)
            .set({ lifecycle: 'grading' })
            .where(and(
                eq(tcgCopy.id, copyId),
                eq(tcgCopy.ownerId, userId),
                eq(tcgCopy.lifecycle, 'raw')
            ))
            .returning({ id: tcgCopy.id, condition: tcgCopy.condition })
        if (!claimed) badRequest('Copy is not available for grading')
        // Pre-condition-model copies have nothing to grade; the throw rolls
        // the lifecycle claim back with the transaction.
        if (!claimed!.condition) badRequest('This copy predates the condition model')

        await debit(userId, fee.toFixed(4), 'tcg:grading', tx)

        const [row] = await tx.insert(tcgSubmission).values({
            copyId,
            userId,
            service,
            fee: fee.toFixed(4),
            predictedGrade,
            returnsAt: new Date(Date.now() + TCG_GRADING.turnaroundMs)
        }).returning()
        return row as SubmissionRow
    })
}

/**
 * GAG reads centering harder than everyone else — deviations from perfect
 * are amplified before the locked model grades them. Applied here rather
 * than inside grading-model.ts, which stays byte-identical to its reference.
 * The rest of the condition passes through untouched; the amplified reading
 * also flows into GAG's reported centering sub-grades, so the report is
 * consistent with the grade it explains.
 */
export const GAG_CENTERING_STRICTNESS = 1.15
const CONDITION_FLOOR = 6.3

export function applyServiceReading(service: TcgServiceKey, condition: TcgCondition): TcgCondition {
    if (service !== 'GAG') return condition
    const subs = [...condition.subs]
    for (const k of [0, 1]) {
        subs[k] = Math.max(CONDITION_FLOOR, 10 - (10 - subs[k]!) * GAG_CENTERING_STRICTNESS)
    }
    return { ...condition, subs }
}

/** Random but collision-checked cert number, service-prefixed. */
function mintCertNumber(service: TcgServiceKey): string {
    return `${service}-${String(randomInt(0, 99999999)).padStart(8, '0')}`
}

export interface CollectedGrade {
    submissionId: string
    copyId: string
    result: TcgGradeResult
    certNumber: string
}

export async function collectSubmission(userId: string, submissionId: string): Promise<CollectedGrade> {
    return await db.transaction(async (tx) => {
        // The claim: pending → graded, and only once the turnaround elapsed.
        // A burst of collects on one submission grades exactly once.
        const [claimed] = await tx.update(tcgSubmission)
            .set({ state: 'graded' })
            .where(and(
                eq(tcgSubmission.id, submissionId),
                eq(tcgSubmission.userId, userId),
                eq(tcgSubmission.state, 'pending'),
                sql`${tcgSubmission.returnsAt} <= now()`
            ))
            .returning()
        if (!claimed) {
            const [existing] = await tx.select({ state: tcgSubmission.state, returnsAt: tcgSubmission.returnsAt })
                .from(tcgSubmission)
                .where(and(eq(tcgSubmission.id, submissionId), eq(tcgSubmission.userId, userId)))
            if (!existing) throw createError({ statusCode: 404, statusMessage: 'Submission not found' })
            badRequest(existing.state === 'pending'
                ? 'Still at the grader'
                : 'Already collected')
        }

        const [copy] = await tx.select({ id: tcgCopy.id, condition: tcgCopy.condition, lifecycle: tcgCopy.lifecycle })
            .from(tcgCopy)
            .where(eq(tcgCopy.id, claimed!.copyId))
        if (!copy?.condition) badRequest('Copy vanished while at the grader')

        const service = claimed!.service as TcgServiceKey
        const graded = applyServiceReading(service, copy!.condition as TcgCondition)
        const result = submit(service, graded, () => gaussSample()) as TcgGradeResult

        // Cert collisions are ~1e-8 per pair; retry twice and then give up
        // loudly rather than loop forever.
        let certNumber = mintCertNumber(service)
        for (let attempt = 0; attempt < 3; attempt++) {
            const [existing] = await tx.select({ id: tcgCopy.id }).from(tcgCopy)
                .where(eq(tcgCopy.certNumber, certNumber))
            if (!existing) break
            if (attempt === 2) throw createError({ statusCode: 500, statusMessage: 'Cert mint failed' })
            certNumber = mintCertNumber(service)
        }

        await tx.update(tcgCopy)
            .set({
                lifecycle: 'slabbed',
                gradeService: service,
                grade: String(result.grade),
                gradeScore: result.score,
                gradeDesignation: result.designation,
                gradeSubs: result.subGrades,
                gradeFlaws: result.flaws,
                certNumber,
                gradedAt: new Date()
            })
            .where(eq(tcgCopy.id, copy!.id))

        return { submissionId, copyId: copy!.id, result, certNumber }
    })
}

export interface CrackResult {
    copyId: string
    damaged: boolean
}

/**
 * Crack a slab: the copy goes back to raw — resubmittable, re-rollable —
 * and with a small probability the tools slip and a corner or edge takes
 * new damage (§6.4: the gamble has teeth). The damage writes into the
 * stored condition, so it is real and permanent, and the wear render picks
 * it up like any other flaw.
 */
export interface CrackRng {
    chance: (p: number) => boolean
    pick: <T>(items: T[]) => T
    float: () => number
}

const CRACK_RNG: CrackRng = { chance: randomChance, pick: randomPick, float: randomFloat }

export async function crackSlab(userId: string, copyId: string, rng: CrackRng = CRACK_RNG): Promise<CrackResult> {
    return await db.transaction(async (tx) => {
        await lockCopyForUpdate(tx, copyId)
        if (await hasActiveListing(tx, copyId)) badRequest('Copy is listed on the market')
        const [claimed] = await tx.update(tcgCopy)
            .set({
                lifecycle: 'raw',
                gradeService: null,
                grade: null,
                gradeScore: null,
                gradeDesignation: null,
                gradeSubs: null,
                gradeFlaws: null,
                certNumber: null,
                gradedAt: null
            })
            .where(and(
                eq(tcgCopy.id, copyId),
                eq(tcgCopy.ownerId, userId),
                eq(tcgCopy.lifecycle, 'slabbed')
            ))
            .returning({ id: tcgCopy.id, condition: tcgCopy.condition })
        if (!claimed) badRequest('Copy is not slabbed')

        let damaged = false
        const condition = claimed!.condition as TcgCondition | null
        if (condition && rng.chance(TCG_GRADING.crackDamageChance)) {
            // One random corner/edge site takes a hit. Only ever downward,
            // so the category sub-score is a simple min-update.
            const site = rng.pick(condition.sites)
            const hit = Math.max(6.3, site.value - (0.4 + rng.float() * 1.2))
            if (hit < site.value) {
                site.value = hit
                condition.subs[site.category] = Math.min(condition.subs[site.category]!, hit)
                await tx.update(tcgCopy)
                    .set({ condition })
                    .where(eq(tcgCopy.id, copyId))
                damaged = true
            }
        }
        return { copyId, damaged }
    })
}

export interface PopReportRow {
    printingId: string
    cardName: string
    finish: string
    pattern: string | null
    rarity: string | null
    service: TcgServiceKey
    grade: string
    designation: string | null
    count: number
}

/**
 * Population report (§6.5): graded copies only, never collapsed across
 * services. Raw and sealed populations stay genuinely unknown — the report
 * understates true supply and players have to reason about that.
 */
export async function popReport(setId: string): Promise<PopReportRow[]> {
    const rows = await db.select({
        printingId: tcgCopy.printingId,
        cardName: tcgCard.name,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        rarity: tcgCard.rarity,
        service: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        designation: tcgCopy.gradeDesignation,
        count: sql<number>`count(*)::int`
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .where(and(eq(tcgCopy.setId, setId), isNotNull(tcgCopy.grade)))
        .groupBy(tcgCopy.printingId, tcgCard.name, tcgPrinting.finish, tcgPrinting.pattern,
            tcgCard.rarity, tcgCopy.gradeService, tcgCopy.grade, tcgCopy.gradeDesignation)
        .orderBy(tcgCard.name, desc(sql`count(*)`))
    return rows as PopReportRow[]
}
