import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
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

        const [updatedUser] = debugMode
            ? await tx.select({ gems: user.gems }).from(user).where(eq(user.id, userId))
            : await tx.update(user)
                .set({ gems: sql`${user.gems} - ${skin.gemCost}` })
                .where(and(eq(user.id, userId), gte(user.gems, skin.gemCost)))
                .returning({ gems: user.gems })
        if (!updatedUser) throw createError({ statusCode: 400, statusMessage: `Need ${skin.gemCost} gems` })
        await tx.update(pathwardenState)
            .set({ ownedSkinIds: [...owned, skin.id], equippedSkinId: skin.id })
            .where(eq(pathwardenState.userId, userId))
        return { skinId: skin.id, equipped: true, gems: updatedUser.gems, cost: debugMode ? 0 : skin.gemCost }
    })
})
