import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedShapezzState } from '#server/utils/shapezz'
import {
    SHAPEZZ_PERMANENT_UPGRADE_IDS,
    shapezzPermanentUpgradeCost,
    type ShapezzPermanentUpgradeId
} from '#shared/utils/gamelogic/shapezz'

const LEVEL_COLUMN: Record<ShapezzPermanentUpgradeId, 'coreLevel' | 'overclockLevel' | 'armorLevel' | 'thrustersLevel' | 'magnetLevel' | 'killHealLevel'> = {
    core: 'coreLevel',
    overclock: 'overclockLevel',
    armor: 'armorLevel',
    thrusters: 'thrustersLevel',
    magnet: 'magnetLevel',
    killHeal: 'killHealLevel'
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const upgradeId = body?.upgradeId as ShapezzPermanentUpgradeId
    if (!SHAPEZZ_PERMANENT_UPGRADE_IDS.includes(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid workshop upgrade' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot use the workshop during a run' })

        const column = LEVEL_COLUMN[upgradeId]
        const level = state[column]
        const cost = shapezzPermanentUpgradeCost(upgradeId, level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Upgrade is already maxed' })

        await debit(userId, cost.toFixed(4), 'shapezz:workshop', tx)
        await tx.update(shapezzState).set({ [column]: level + 1 }).where(eq(shapezzState.userId, userId))

        return { upgradeId, level: level + 1, cost }
    })
})
