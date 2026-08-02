import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { PATHWARDEN_DEFENSE_BLUEPRINTS } from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const body = await readBody(event)
    const blueprint = PATHWARDEN_DEFENSE_BLUEPRINTS.find(item => item.id === body?.defenseId)
    if (!blueprint || blueprint.coinCost <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid premium defense' })
    }

    return db.transaction(async (tx) => {
        await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
        await tx.execute(sql`SELECT id FROM pathwarden_state WHERE user_id = ${userId} FOR UPDATE`)
        const state = await tx.query.pathwardenState.findFirst({ where: eq(pathwardenState.userId, userId) })
        if (!state) throw createError({ statusCode: 404, statusMessage: 'Pathwarden state not initialized' })
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Finish the active march before buying blueprints' })

        const owned = Array.from(new Set(['bolt', 'mortar', 'frost', ...(state.ownedDefenseIds ?? [])]))
        if (owned.includes(blueprint.id)) throw createError({ statusCode: 400, statusMessage: 'Blueprint already owned' })
        if (!debugMode) await debit(userId, blueprint.coinCost.toFixed(4), 'pathwarden:defense', tx)
        await tx.update(pathwardenState)
            .set({ ownedDefenseIds: [...owned, blueprint.id] })
            .where(eq(pathwardenState.userId, userId))
        return { defenseId: blueprint.id, owned: true, cost: debugMode ? 0 : blueprint.coinCost }
    })
})
