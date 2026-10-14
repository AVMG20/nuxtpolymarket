import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedHackerzState } from '#server/utils/hackerz'
import { hackerzCooldownRushCost, hackerzRunCooldownRemainingMs } from '#shared/utils/gamelogic/hackerz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedHackerzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot rush cooldown during an active run' })

        const remainingMs = hackerzRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'The uplink is already ready' })

        const cost = hackerzCooldownRushCost(remainingMs)
        const gems = await debitGems(userId, cost, tx)
        await tx.update(hackerzState)
            .set({ lastRunFinishedAt: null })
            .where(eq(hackerzState.userId, userId))

        return { cost, gems }
    })
})
