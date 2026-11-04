import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { riftbornState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { ensureRiftbornState, getLockedRiftbornState, riftbornProgress } from '#server/utils/riftborn'
import {
    riftbornCleanSkills,
    riftbornLevelForXp,
    riftbornSkillPoints,
    riftbornSkillsError
} from '#shared/utils/gamelogic/riftborn'

/**
 * Saves the whole skill tree. Respeccing is free: the body is the full
 * allocation, checked against the points the account has. A run in progress
 * keeps the tree it deployed with.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const skills = riftbornCleanSkills(body?.skills)

    await ensureRiftbornState(userId)
    return db.transaction(async (tx) => {
        const state = await getLockedRiftbornState(tx, userId)
        const points = riftbornSkillPoints(riftbornLevelForXp(state.xp).level, state.achievements)
        const error = riftbornSkillsError(skills, points)
        if (error) throw createError({ statusCode: 400, statusMessage: error })

        const [updated] = await tx.update(riftbornState)
            .set({ skills })
            .where(eq(riftbornState.userId, userId))
            .returning()

        return riftbornProgress(updated!)
    })
})
