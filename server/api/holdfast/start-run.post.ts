import { requireUserId } from '#server/utils/auth'
import { startHoldfastRun } from '#server/utils/holdfast'
import { holdfastIsDifficulty } from '#shared/utils/holdfast/meta'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const difficulty = body?.difficulty
    if (!holdfastIsDifficulty(difficulty)) throw createError({ statusCode: 400, statusMessage: 'Invalid difficulty' })
    return startHoldfastRun(userId, difficulty)
})
