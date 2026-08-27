import { requireUserId } from '#server/utils/auth'
import { bookFor } from '#server/utils/tcg/book'

/** Aggregated bid levels for one slab identity, plus the caller's orders. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const q = getQuery(event)
    const printingId = typeof q.printingId === 'string' ? q.printingId : ''
    const gradeService = typeof q.gradeService === 'string' ? q.gradeService : ''
    const grade = typeof q.grade === 'string' ? q.grade : ''
    const gradeDesignation = typeof q.gradeDesignation === 'string' && q.gradeDesignation
        ? q.gradeDesignation
        : null
    if (!printingId || !gradeService || !grade) {
        throw createError({ statusCode: 400, statusMessage: 'printingId, gradeService and grade are required' })
    }
    return await bookFor(userId, { printingId, gradeService, grade, gradeDesignation })
})
