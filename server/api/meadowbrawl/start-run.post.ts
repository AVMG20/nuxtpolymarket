import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedMeadowbrawlState, meadowbrawlActivePet, meadowbrawlLevels, meadowbrawlRunCoinMult } from '#server/utils/meadowbrawl'
import {
    meadowbrawlAccountEffects,
    meadowbrawlIsWeaponId,
    meadowbrawlRunCooldownRemainingMs,
    meadowbrawlUnlockedWeapons
} from '#shared/utils/gamelogic/meadowbrawl-meta'

/**
 * A run older than this with no checkpoint is a dead tab that never made
 * it past wave one — it pays nothing and is cleared so it cannot lock the
 * account out. A run *with* a checkpoint is resumable and is only ever
 * cleared by an explicit finish (abandon) or a settle.
 */
const STALE_RUN_MS = 10 * 60 * 1000

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const weapon = body?.weapon
    if (!meadowbrawlIsWeaponId(weapon)) throw createError({ statusCode: 400, statusMessage: 'Invalid weapon' })

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (state.runStartedAt) {
            const resumable = state.runSave !== null
            if (resumable || Date.now() - state.runStartedAt.getTime() < STALE_RUN_MS) {
                throw createError({ statusCode: 409, statusMessage: 'A Meadowbrawl run is already active — resume or abandon it first' })
            }
        }
        if (meadowbrawlRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now()) > 0) {
            throw createError({ statusCode: 400, statusMessage: 'The meadow is still recovering — come back later or rush it with gems' })
        }
        const unlocked = meadowbrawlUnlockedWeapons(state.bestWaveByWeapon, state.unlockedWeapons)
        if (!unlocked.includes(weapon)) throw createError({ statusCode: 400, statusMessage: 'That weapon is still locked' })

        const levels = meadowbrawlLevels(state)
        const effects = meadowbrawlAccountEffects(levels)
        const pet = meadowbrawlActivePet(state)
        const coinMult = meadowbrawlRunCoinMult(state)
        const runStartedAt = new Date()
        await tx.update(meadowbrawlState).set({
            runStartedAt,
            runWeapon: weapon,
            runPet: pet?.id ?? null,
            runPetLevel: pet?.level ?? 0,
            // Snapshotted at the start so buying Prosperity mid-run cannot
            // inflate a payout the run already earned its way to.
            runCoinMult: coinMult.toFixed(4),
            runSave: null,
            runSaveRevision: 0
        }).where(eq(meadowbrawlState.userId, userId))

        return {
            weapon,
            pet,
            effects,
            coinMult,
            runStartedAt
        }
    })
})
