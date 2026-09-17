import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedMeadowbrawlState } from '#server/utils/meadowbrawl'
import { meadowbrawlRunCooldownRemainingMs, meadowbrawlRushGemCost } from '#shared/utils/gamelogic/meadowbrawl-meta'

/** Spends gems to clear the two-hour cooldown between runs. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        const remainingMs = meadowbrawlRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'The meadow is ready — no need to rush' })

        const gemCost = meadowbrawlRushGemCost(remainingMs)
        const gems = await debitGems(userId, gemCost, tx)
        await tx.update(meadowbrawlState)
            .set({ lastRunFinishedAt: null })
            .where(eq(meadowbrawlState.userId, userId))

        return { gemCost, gems }
    })
})
