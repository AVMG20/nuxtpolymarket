import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { prestigeBlockers, prestigeWipeTables } from '#server/utils/prestige'
import { nextPrestigeTier } from '#shared/utils/prestige'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const [current] = await db.select({
        balance: user.balance,
        gems: user.gems,
        prestige: user.prestige,
        prestigeTokens: user.prestigeTokens
    })
        .from(user)
        .where(eq(user.id, userId))
    if (!current) throw createError({ statusCode: 404, statusMessage: 'User not found' })

    const next = nextPrestigeTier(current.prestige)
    const [blockers, wipeTables] = await Promise.all([
        prestigeBlockers(userId),
        prestigeWipeTables()
    ])

    return {
        level: current.prestige,
        tokens: current.prestigeTokens,
        balance: current.balance,
        gems: current.gems,
        blockers,
        // Purely for the confirmation screen — "37 systems will be purged"
        // lands harder than a vague warning, and the number is honest because
        // it comes from the same scan the wipe itself runs.
        systemsCleared: wipeTables.length,
        affordable: !!next
            && parseFloat(current.balance) >= next.coinCost
            && current.gems >= next.gemCost
    }
})
