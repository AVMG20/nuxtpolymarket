import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedPirateState } from '#server/utils/pirates'
import { PIRATE_MARQUE_MAX_LEVEL, pirateMarqueUpgradeCost } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        // Lock-then-read: a burst of parallel upgrades queues on the row, so
        // each one sees the level the previous one wrote and pays for its own.
        const s = await getLockedPirateState(tx, userId)
        // The level scales a voyage's settlement, so it must not move mid-voyage.
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot sign letters mid-voyage' })
        if (s.marqueLevel >= PIRATE_MARQUE_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

        const cost = pirateMarqueUpgradeCost(s.marqueLevel)!
        await debit(userId, cost.toFixed(4), 'pirates', tx)
        await tx.update(pirateState).set({ marqueLevel: s.marqueLevel + 1 }).where(eq(pirateState.userId, userId))

        return { newLevel: s.marqueLevel + 1 }
    })
})
