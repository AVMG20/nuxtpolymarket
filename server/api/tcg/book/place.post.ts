import { requireUserId } from '#server/utils/auth'
import { placeBuyOrder } from '#server/utils/tcg/book'
import { isTcgService } from '#shared/utils/tcg/grading-fees'
import { bookGradeOptions, bookDesignationOptions } from '#shared/utils/tcg/market'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const printingId = typeof body?.printingId === 'string' ? body.printingId : ''
    const gradeService = typeof body?.gradeService === 'string' ? body.gradeService : ''
    const grade = typeof body?.grade === 'string' ? body.grade : ''
    const gradeDesignation = typeof body?.gradeDesignation === 'string' && body.gradeDesignation
        ? body.gradeDesignation
        : null
    if (!printingId || !gradeService || !grade) {
        throw createError({ statusCode: 400, statusMessage: 'printingId, gradeService and grade are required' })
    }
    if (!isTcgService(gradeService) || !bookGradeOptions(gradeService).includes(String(Number(grade)))) {
        throw createError({ statusCode: 400, statusMessage: 'No such grade' })
    }
    const designations = bookDesignationOptions(gradeService, String(Number(grade)))
    if (gradeDesignation !== null ? !designations.includes(gradeDesignation) : designations.length > 0) {
        throw createError({ statusCode: 400, statusMessage: 'No such designation' })
    }
    return await placeBuyOrder(
        userId,
        { printingId, gradeService, grade, gradeDesignation },
        Number(body?.price),
        Number(body?.quantity)
    )
})
