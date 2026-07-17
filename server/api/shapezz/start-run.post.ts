import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedShapezzState } from '#server/utils/shapezz'
import {
    SHAPEZZ_CHECKPOINT_MS,
    SHAPEZZ_DIFFICULTY_IDS,
    shapezzDifficulty,
    shapezzPlayerStats,
    shapezzPower,
    shapezzWeapon,
    type ShapezzDifficultyId
} from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const difficultyId = body?.difficultyId as ShapezzDifficultyId
    if (!SHAPEZZ_DIFFICULTY_IDS.includes(difficultyId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid SHAPEZZ difficulty' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'A SHAPEZZ run is already active' })

        const levels = {
            core: state.coreLevel,
            overclock: state.overclockLevel,
            armor: state.armorLevel,
            thrusters: state.thrustersLevel,
            magnet: state.magnetLevel,
            killHeal: state.killHealLevel
        }
        const weapon = shapezzWeapon(state.weaponType, state.weaponRarity)
        const power = shapezzPower(levels, weapon)
        const startedAt = new Date()

        await tx.update(shapezzState).set({
            runStartedAt: startedAt,
            runDifficultySnapshot: difficultyId,
            runPowerSnapshot: power
        }).where(eq(shapezzState.userId, userId))

        return {
            startedAt,
            difficulty: shapezzDifficulty(difficultyId),
            checkpointMs: SHAPEZZ_CHECKPOINT_MS,
            power,
            stats: shapezzPlayerStats(levels),
            weapon
        }
    })
})
