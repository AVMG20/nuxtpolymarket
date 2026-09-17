import { requireUserId } from '#server/utils/auth'
import { collectSubmission } from '#server/utils/tcg/grading'

/** Open the return package: the grade is decided here, not before. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ submissionId?: unknown }>(event)
    if (typeof body?.submissionId !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'submissionId is required' })
    }
    const collected = await collectSubmission(userId, body.submissionId)
    return {
        submissionId: collected.submissionId,
        copyId: collected.copyId,
        certNumber: collected.certNumber,
        result: {
            service: collected.result.service,
            grade: String(collected.result.grade),
            score: collected.result.score,
            designation: collected.result.designation,
            subGrades: collected.result.subGrades,
            flaws: collected.result.flaws
        }
    }
})
