import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedPathwardenState } from '#server/utils/pathwarden'
import { PATHWARDEN_CHECKPOINT_WAVES, pathwardenCheckpointReward } from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ wave?: number }>(event)
    const wave = Math.floor(Number(body.wave) || 0)
    if (!PATHWARDEN_CHECKPOINT_WAVES.includes(wave as 4 | 8 | 12)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden checkpoint' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        if (!state.runStartedAt || !state.runRealmSnapshot) {
            throw createError({ statusCode: 409, statusMessage: 'No active Pathwarden run' })
        }
        const [run] = await tx.select({ gameState: pathwardenRuns.gameState })
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        if (!run?.gameState || run.gameState.wave < wave || run.gameState.phase !== 'checkpoint') {
            throw createError({ statusCode: 409, statusMessage: 'Checkpoint has not been reached yet' })
        }
        const claimed = state.claimedCheckpointWaves ?? []
        if (claimed.includes(wave)) {
            return { wave, reward: 0, alreadyClaimed: true }
        }

        const reward = pathwardenCheckpointReward(wave, state.runRealmSnapshot)
        await credit(userId, reward.toFixed(4), 'pathwarden:checkpoint', tx)
        await tx.update(pathwardenState)
            .set({ claimedCheckpointWaves: [...claimed, wave] })
            .where(eq(pathwardenState.userId, userId))

        return { wave, reward, alreadyClaimed: false }
    })
})
