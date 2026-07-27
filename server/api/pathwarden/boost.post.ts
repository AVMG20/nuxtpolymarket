import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import {
    PATHWARDEN_BOOST_IDS,
    PATHWARDEN_BOOSTS,
    pathwardenBoostCost,
    type PathwardenBoostId
} from '#shared/utils/gamelogic/pathwarden'

const LEVEL_COLUMN: Record<PathwardenBoostId,
    'bulwarkLevel' | 'artificerLevel' | 'lensLevel' | 'reservoirLevel' | 'bannerLevel' | 'bountyLevel'> = {
        bulwark: 'bulwarkLevel',
        artificer: 'artificerLevel',
        lens: 'lensLevel',
        reservoir: 'reservoirLevel',
        banner: 'bannerLevel',
        bounty: 'bountyLevel'
    }

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const body = await readBody<{ boostId?: PathwardenBoostId }>(event)
    const boostId = body.boostId
    if (!boostId || !PATHWARDEN_BOOST_IDS.includes(boostId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Pathwarden boost' })
    }

    return db.transaction(async (tx) => {
        await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
        const [state] = await tx.select()
            .from(pathwardenState)
            .where(eq(pathwardenState.userId, userId))
            .for('update')
        if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize Pathwarden boosts' })
        if (state.runStartedAt) {
            throw createError({ statusCode: 400, statusMessage: 'Permanent boosts can only change between marches' })
        }
        const column = LEVEL_COLUMN[boostId]
        const level = state[column]
        const cost = pathwardenBoostCost(boostId, level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Boost is already maxed' })

        const useFreeCredit = state.freeBoostCredits > 0
        if (!debugMode && !useFreeCredit && PATHWARDEN_BOOSTS[boostId].currency === 'gems') {
            await debitGems(userId, cost, tx)
        } else if (!debugMode && !useFreeCredit) {
            await debit(userId, cost.toFixed(4), 'pathwarden:boost', tx)
        }
        const [updated] = await tx.update(pathwardenState)
            .set({
                [column]: level + 1,
                freeBoostCredits: useFreeCredit ? state.freeBoostCredits - 1 : state.freeBoostCredits
            })
            .where(and(
                eq(pathwardenState.userId, userId),
                eq(pathwardenState[column], level)
            ))
            .returning({ level: pathwardenState[column] })
        if (!updated) throw createError({ statusCode: 409, statusMessage: 'Boost changed; refresh and try again' })
        return { boostId, level: level + 1, cost: debugMode || useFreeCredit ? 0 : cost, free: debugMode || useFreeCredit }
    })
})
