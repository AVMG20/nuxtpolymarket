import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { getLockedPathwardenState } from '#server/utils/pathwarden'
import { PATHWARDEN_ABANDON_COST_GEMS } from '#shared/utils/gamelogic/pathwarden'

const STRATEGIC_PHASES = new Set(['planning', 'checkpoint', 'path', 'upgrade'])

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ currency?: 'gems' | 'coins' }>(event)
    if (body.currency !== 'gems' && body.currency !== 'coins') {
        throw createError({ statusCode: 400, statusMessage: 'Choose Gems or Coins for the retreat' })
    }
    const coinCost = Math.max(1, Math.ceil(await getGemGuidePrice() * PATHWARDEN_ABANDON_COST_GEMS))
    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        const [run] = await tx.select()
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        if (!state.runStartedAt || !run) {
            throw createError({ statusCode: 409, statusMessage: 'No active Pathwarden run' })
        }
        const phase = run.gameState?.phase ?? 'planning'
        if (!STRATEGIC_PHASES.has(phase)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'A march cannot be abandoned while a battle is in progress'
            })
        }
        if (body.currency === 'gems') {
            await debitGems(userId, PATHWARDEN_ABANDON_COST_GEMS, tx)
        } else {
            await debit(userId, coinCost.toFixed(4), 'pathwarden:abandon', tx)
        }
        await tx.delete(pathwardenRuns).where(eq(pathwardenRuns.userId, userId))
        await tx.update(pathwardenState)
            .set({
                runsPlayed: state.runsPlayed + 1,
                runStartedAt: null,
                runRealmSnapshot: null,
                runPowerSnapshot: null,
                runSurgedSnapshot: null
            })
            .where(eq(pathwardenState.userId, userId))
        return {
            currency: body.currency,
            cost: body.currency === 'gems' ? PATHWARDEN_ABANDON_COST_GEMS : coinCost
        }
    })
})
