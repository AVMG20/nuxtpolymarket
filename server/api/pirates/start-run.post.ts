import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
    PIRATE_RUN_DURATION_MS, piratePowerLevel,
    pirateMaxHp, pirateShipSpeed, pirateCannonStats, pirateCannonRange, pirateReloadMs
} from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })

    const levels = {
        hull: s.hullLevel,
        speed: s.speedLevel,
        damage: s.damageLevel,
        range: s.rangeLevel,
        reload: s.reloadLevel
    }
    const power = piratePowerLevel(levels)
    const startedAt = new Date()

    await db.update(pirateState)
        .set({ runStartedAt: startedAt, runPowerSnapshot: power })
        .where(eq(pirateState.userId, userId))

    return {
        startedAt,
        power,
        runDurationMs: PIRATE_RUN_DURATION_MS,
        stats: {
            maxHp: pirateMaxHp(s.hullLevel),
            speed: pirateShipSpeed(s.speedLevel),
            cannon: pirateCannonStats(s.damageLevel),
            range: pirateCannonRange(s.rangeLevel),
            reloadMs: pirateReloadMs(s.reloadLevel)
        }
    }
})
