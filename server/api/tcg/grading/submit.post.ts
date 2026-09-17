import { requireUserId } from '#server/utils/auth'
import { submitForGrading } from '#server/utils/tcg/grading'

/** Send a copy to a grading service: one gem, back in 24 hours. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{
        copyId?: unknown
        service?: unknown
        predictedGrade?: unknown
    }>(event)
    if (typeof body?.copyId !== 'string' || typeof body?.service !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'copyId and service are required' })
    }
    const predictedGrade = typeof body.predictedGrade === 'string' && body.predictedGrade !== ''
        ? body.predictedGrade
        : null
    const row = await submitForGrading(userId, body.copyId, body.service, predictedGrade)
    return {
        id: row.id,
        copyId: row.copyId,
        service: row.service,
        fee: Number(row.fee),
        returnsAt: row.returnsAt.toISOString()
    }
})
