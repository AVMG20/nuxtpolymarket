import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { PIRATE_SHIP_STAT_IDS, PIRATE_MAX_STAT_LEVEL, pirateUpgradeCost, type PirateShipStatId } from '#shared/utils/gamelogic/pirates'

const LEVEL_COLUMN: Record<PirateShipStatId, 'hullLevel' | 'speedLevel' | 'defenseLevel' | 'ammoCapacityLevel'> = {
    hull: 'hullLevel',
    speed: 'speedLevel',
    defense: 'defenseLevel',
    ammoCapacity: 'ammoCapacityLevel'
}

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const body = await readBody(event)
    const stat = body?.stat as PirateShipStatId
    if (!PIRATE_SHIP_STAT_IDS.includes(stat)) throw createError({ statusCode: 400, statusMessage: 'Invalid stat' })

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot upgrade mid-voyage' })

    const column = LEVEL_COLUMN[stat]
    const level = s[column]
    if (level >= PIRATE_MAX_STAT_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

    const cost = pirateUpgradeCost(level)!

    await debit(userId, cost.toFixed(4), 'pirates')
    await db.update(pirateState).set({ [column]: level + 1 }).where(eq(pirateState.userId, userId))

    return { stat, newLevel: level + 1 }
})
