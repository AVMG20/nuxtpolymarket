import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    PIRATE_STAT_IDS, PIRATE_MAX_STAT_LEVEL, PIRATE_RUN_DURATION_MS,
    pirateUpgradeCost, pirateMaxHp, pirateShipSpeed, pirateCannonStats,
    pirateCannonRange, pirateReloadMs, piratePowerLevel
} from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id

    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    ])

    const s = existing ?? (await db.insert(pirateState).values({ userId }).returning())[0]!

    const levels = {
        hull: s.hullLevel,
        speed: s.speedLevel,
        damage: s.damageLevel,
        range: s.rangeLevel,
        reload: s.reloadLevel
    }

    return {
        balance,
        levels,
        maxLevel: PIRATE_MAX_STAT_LEVEL,
        costs: Object.fromEntries(PIRATE_STAT_IDS.map(id => [id, pirateUpgradeCost(levels[id])])),
        power: piratePowerLevel(levels),
        stats: {
            maxHp: pirateMaxHp(s.hullLevel),
            speed: pirateShipSpeed(s.speedLevel),
            cannon: pirateCannonStats(s.damageLevel),
            range: pirateCannonRange(s.rangeLevel),
            reloadMs: pirateReloadMs(s.reloadLevel)
        },
        runsPlayed: s.runsPlayed,
        totalCoinsEarned: s.totalCoinsEarned,
        bestSurvivalMs: s.bestSurvivalMs,
        runDurationMs: PIRATE_RUN_DURATION_MS,
        activeRun: s.runStartedAt ? { startedAt: s.runStartedAt } : null
    }
})
