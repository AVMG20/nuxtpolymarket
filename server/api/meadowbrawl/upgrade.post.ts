import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { MEADOWBRAWL_LEVEL_COLUMN, getLockedMeadowbrawlState, meadowbrawlLevels } from '#server/utils/meadowbrawl'
import { meadowbrawlAccountEffects, meadowbrawlUpgradeById, meadowbrawlUpgradeCost } from '#shared/utils/gamelogic/meadowbrawl-meta'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const def = meadowbrawlUpgradeById(body?.upgradeId)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Invalid Meadowbrawl upgrade' })

    return db.transaction(async (tx) => {
        // The lock is what makes the read-then-write below safe: without it, N
        // concurrent buys all read the same level and all pay one level's price.
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Upgrades are locked during a run' })

        const column = MEADOWBRAWL_LEVEL_COLUMN[def.id]
        const level = state[column]
        const cost = meadowbrawlUpgradeCost(def, level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Upgrade is already maxed' })

        await debit(userId, cost.toFixed(4), 'meadowbrawl:upgrade', tx)
        const [updated] = await tx.update(meadowbrawlState)
            .set({ [column]: level + 1 })
            .where(eq(meadowbrawlState.userId, userId))
            .returning()

        const levels = meadowbrawlLevels(updated!)
        return { upgradeId: def.id, level: level + 1, cost, levels, effects: meadowbrawlAccountEffects(levels) }
    })
})
