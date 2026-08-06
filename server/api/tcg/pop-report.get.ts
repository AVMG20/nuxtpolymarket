import { requireUserId } from '#server/utils/auth'
import { popReport } from '#server/utils/tcg/grading'
import type { TcgPopReportRow } from '#shared/types/tcg'

/** Population report for one set — graded copies only (§6.5). */
export default defineEventHandler(async (event): Promise<TcgPopReportRow[]> => {
    await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }
    return await popReport(setId)
})
