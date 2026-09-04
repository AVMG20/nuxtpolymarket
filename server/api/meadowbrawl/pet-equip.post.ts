import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedMeadowbrawlState, meadowbrawlPetLevel } from '#server/utils/meadowbrawl'
import { meadowbrawlIsPetId } from '#shared/utils/gamelogic/meadowbrawl-meta'

/** Fields one adopted pet for the next run, or none (`petId: null`). */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const petId = body?.petId ?? null
    if (petId !== null && !meadowbrawlIsPetId(petId)) throw createError({ statusCode: 400, statusMessage: 'Invalid pet' })

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Pets are locked during a run' })
        if (petId !== null && meadowbrawlPetLevel(state, petId) < 1) {
            throw createError({ statusCode: 400, statusMessage: 'Adopt that pet first' })
        }
        await tx.update(meadowbrawlState).set({ activePet: petId }).where(eq(meadowbrawlState.userId, userId))
        return { activePet: petId }
    })
})
