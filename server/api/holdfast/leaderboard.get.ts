import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { holdfastRankings } from '#server/utils/holdfast'
import { holdfastIsDifficulty } from '#shared/utils/holdfast/meta'

export default defineEventHandler(async (event) => {
    const difficulty = getQuery(event).difficulty
    if (!holdfastIsDifficulty(difficulty)) throw createError({ statusCode: 400, statusMessage: 'Invalid difficulty' })
    const userId = await getSessionUserId(event)
    const { entries, me } = await holdfastRankings(db, difficulty, userId)
    return { difficulty, entries, me }
})
