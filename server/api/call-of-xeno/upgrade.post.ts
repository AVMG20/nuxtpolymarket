import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { CALL_OF_XENO_LEVEL_COLUMN, callOfXenoLevels, getLockedCallOfXenoState } from '#server/utils/call-of-xeno'
import {
    CALL_OF_XENO_UPGRADES,
    CALL_OF_XENO_UPGRADE_IDS,
    callOfXenoUpgradeCost,
    callOfXenoUpgradeEffects,
    type CallOfXenoUpgradeId
} from '#shared/utils/gamelogic/call-of-xeno-meta'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const upgradeId = body?.upgradeId as CallOfXenoUpgradeId
    if (!CALL_OF_XENO_UPGRADE_IDS.includes(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid CALL OF XENO upgrade' })
    }
    const def = CALL_OF_XENO_UPGRADES.find(u => u.id === upgradeId)!

    return db.transaction(async (tx) => {
        // The lock is what makes the read-then-write below safe: without it, N
        // concurrent buys all read the same level and all pay one level's price.
        const state = await getLockedCallOfXenoState(tx, userId)
        if (state.runStartedAt) {
            throw createError({ statusCode: 400, statusMessage: 'Upgrades are locked during a run' })
        }

        const column = CALL_OF_XENO_LEVEL_COLUMN[upgradeId]
        const level = state[column]
        const cost = callOfXenoUpgradeCost(def, level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Upgrade is already maxed' })

        await debit(userId, cost.toFixed(4), 'call-of-xeno:upgrade', tx)
        const [updated] = await tx.update(callOfXenoState)
            .set({ [column]: level + 1 })
            .where(eq(callOfXenoState.userId, userId))
            .returning()

        const levels = callOfXenoLevels(updated!)
        return {
            upgradeId,
            level: level + 1,
            cost,
            levels,
            effects: callOfXenoUpgradeEffects(levels)
        }
    })
})
