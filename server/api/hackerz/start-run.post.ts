import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzRuns, hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { hackerzCoinMultiplier, hackerzLevels, getLockedHackerzState } from '#server/utils/hackerz'
import {
    HACKERZ_DIFFICULTY_IDS,
    HACKERZ_SAVE_VERSION,
    hackerzDifficulty,
    hackerzDifficultyUnlocked,
    hackerzEmptyArmoury,
    hackerzLoadout,
    hackerzMainframeEffects,
    hackerzPower,
    hackerzRunCooldownRemainingMs,
    type HackerzDifficultyId,
    type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const difficultyId = body?.difficultyId as HackerzDifficultyId
    if (!HACKERZ_DIFFICULTY_IDS.includes(difficultyId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Hackerz difficulty' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedHackerzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'A Hackerz run is already active' })

        if (hackerzRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now()) > 0) {
            throw createError({ statusCode: 400, statusMessage: 'Hackerz uplink is cooling down' })
        }


        const difficulty = hackerzDifficulty(difficultyId)
        if (!hackerzDifficultyUnlocked(difficulty, state.bestWave)) {
            throw createError({
                statusCode: 400,
                statusMessage: `${difficulty.name} unlocks at wave ${difficulty.requiredBestWave}`
            })
        }

        const levels = hackerzLevels(state)
        const effects = hackerzMainframeEffects(levels)
        const armoury = hackerzEmptyArmoury(levels)
        const loadout = hackerzLoadout(armoury, levels, difficultyId)
        const startedAt = new Date()
        const coinMultiplier = hackerzCoinMultiplier(levels)

        const save: HackerzRunSave = {
            version: HACKERZ_SAVE_VERSION,
            difficulty: difficultyId,
            wave: 0,
            credits: effects.startingCredits,
            coins: 0,
            kills: 0,
            wallHp: loadout.wallMaxHp,
            armoury,
            bonusWave: 0
        }

        await tx.update(hackerzState).set({
            runStartedAt: startedAt,
            runDifficultySnapshot: difficultyId,
            runPowerSnapshot: hackerzPower(levels),
            runCoinMultiplierSnapshot: coinMultiplier.toFixed(4)
        }).where(eq(hackerzState.userId, userId))

        // A previous run's save is replaced outright — there is only ever one
        // HACKERZ run per account, and the active-run lock above is what makes
        // that safe to overwrite.
        await tx.insert(hackerzRuns).values({
            userId,
            revision: 0,
            saveVersion: HACKERZ_SAVE_VERSION,
            runState: save,
            updatedAt: startedAt
        }).onConflictDoUpdate({
            target: hackerzRuns.userId,
            set: { revision: 0, saveVersion: HACKERZ_SAVE_VERSION, runState: save, updatedAt: startedAt }
        })

        return {
            startedAt,
            difficulty,
            levels,
            effects,
            revision: 0,
            save,
            power: hackerzPower(levels)
        }
    })
})
