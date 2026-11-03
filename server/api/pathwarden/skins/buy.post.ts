import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { PATHWARDEN_SKINS } from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const body = await readBody(event)
    const skin = PATHWARDEN_SKINS.find(item => item.id === body?.skinId)
    if (!skin || skin.gemCost <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid premium skin' })

    return db.transaction(async (tx) => {
        await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
        await tx.execute(sql`SELECT id FROM pathwarden_state WHERE user_id = ${userId} FOR UPDATE`)
        const state = await tx.query.pathwardenState.findFirst({ where: eq(pathwardenState.userId, userId) })
        if (!state) throw createError({ statusCode: 404, statusMessage: 'Pathwarden state not initialized' })
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Finish the active march before changing livery' })
        const owned = Array.from(new Set(['warden-stone', ...(state.ownedSkinIds ?? [])]))
        if (owned.includes(skin.id)) throw createError({ statusCode: 400, statusMessage: 'Skin already owned' })

        let gems: number | undefined
        if (debugMode) {
            const [current] = await tx.select({ gems: user.gems }).from(user).where(eq(user.id, userId))
            gems = current?.gems
        } else {
            gems = await debitGems(userId, skin.gemCost, 'pathwarden', tx)
        }
        if (gems === undefined) throw createError({ statusCode: 404, statusMessage: 'User not found' })
        await tx.update(pathwardenState)
            .set({ ownedSkinIds: [...owned, skin.id], equippedSkinId: skin.id })
            .where(eq(pathwardenState.userId, userId))
        return { skinId: skin.id, equipped: true, gems, cost: debugMode ? 0 : skin.gemCost }
    })
})
