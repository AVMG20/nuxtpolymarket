import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { PIRATE_SHIP_SKINS } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id
    const body = await readBody(event)
    const skin = PIRATE_SHIP_SKINS.find(item => item.id === body?.skinId)
    if (!skin || skin.cost <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid premium skin' })

    return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM pirate_state WHERE user_id = ${userId} FOR UPDATE`)
        const state = await tx.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
        if (!state) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Finish the active voyage before changing skins' })

        const ownedSkinIds = Array.from(new Set(['starter', ...(state.ownedSkinIds ?? [])]))
        if (ownedSkinIds.includes(skin.id)) throw createError({ statusCode: 400, statusMessage: 'Skin already owned' })

        const [updatedUser] = await tx.update(user)
            .set({ gems: sql`${user.gems} - ${skin.cost}` })
            .where(and(eq(user.id, userId), gte(user.gems, skin.cost)))
            .returning({ gems: user.gems })
        if (!updatedUser) throw createError({ statusCode: 400, statusMessage: `Need ${skin.cost} gems` })

        await tx.update(pirateState)
            .set({ ownedSkinIds: [...ownedSkinIds, skin.id], equippedSkinId: skin.id })
            .where(eq(pirateState.userId, userId))

        return { skinId: skin.id, equipped: true, gems: updatedUser.gems }
    })
})
