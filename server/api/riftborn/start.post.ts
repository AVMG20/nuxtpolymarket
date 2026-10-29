import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { riftbornState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { ensureRiftbornState, getLockedRiftbornState } from '#server/utils/riftborn'
import {
    riftbornClass,
    riftbornCleanSkills,
    riftbornMetaEffects,
    riftbornUnlockedClasses
} from '#shared/utils/gamelogic/riftborn'

/**
 * Deploys a run. Starting again abandons an unfinished one: its runId is
 * replaced, so a late finish for it finds nothing to claim.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const classDef = riftbornClass(body?.classId)
    if (!classDef) throw createError({ statusCode: 400, statusMessage: 'Invalid Riftborn class' })

    await ensureRiftbornState(userId)
    return db.transaction(async (tx) => {
        const state = await getLockedRiftbornState(tx, userId)
        if (!riftbornUnlockedClasses(state.achievements).includes(classDef.id)) {
            throw createError({ statusCode: 400, statusMessage: `${classDef.name} is locked` })
        }

        const skills = riftbornCleanSkills(state.skills)
        const runId = crypto.randomUUID()
        const startedAt = new Date()
        await tx.update(riftbornState).set({
            runId,
            runClass: classDef.id,
            runStartedAt: startedAt,
            runSkills: skills
        }).where(eq(riftbornState.userId, userId))

        return { runId, classId: classDef.id, startedAt, effects: riftbornMetaEffects(skills) }
    })
})
