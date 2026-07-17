import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedPirateState } from '#server/utils/pirates'
import { PIRATE_SHIP_STAT_IDS, pirateStatMaxLevel, pirateStatUpgradeCost, type PirateShipStatId } from '#shared/utils/gamelogic/pirates'

const LEVEL_COLUMN: Record<PirateShipStatId, 'hullLevel' | 'speedLevel' | 'defenseLevel' | 'ammoCapacityLevel' | 'regenLevel'> = {
    hull: 'hullLevel',
    speed: 'speedLevel',
    defense: 'defenseLevel',
    ammoCapacity: 'ammoCapacityLevel',
    regen: 'regenLevel'
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const stat = body?.stat as PirateShipStatId
    if (!PIRATE_SHIP_STAT_IDS.includes(stat)) throw createError({ statusCode: 400, statusMessage: 'Invalid stat' })

    return db.transaction(async (tx) => {
        // Lock the row so the level read, debit and increment are atomic — two
        // concurrent upgrades would otherwise both read the same level, both pay,
        // and both write the same level + 1 (paying twice for one level).
        const s = await getLockedPirateState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot upgrade mid-voyage' })

        const column = LEVEL_COLUMN[stat]
        const level = s[column]
        const maxLevel = pirateStatMaxLevel(stat)
        if (level >= maxLevel) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

        const cost = pirateStatUpgradeCost(stat, level)!

        await debit(userId, cost.toFixed(4), 'pirates', tx)
        await tx.update(pirateState).set({ [column]: level + 1 }).where(eq(pirateState.userId, userId))

        return { stat, newLevel: level + 1 }
    })
})
