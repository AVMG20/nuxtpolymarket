import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { PIRATE_SHIP_SKINS } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = session.user.id
    const body = await readBody(event)
    const skin = PIRATE_SHIP_SKINS.find(item => item.id === body?.skinId)
    if (!skin) throw createError({ statusCode: 400, statusMessage: 'Invalid skin' })

    const state = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Finish the active voyage before changing skins' })

    const ownedSkinIds = new Set(['starter', ...(state.ownedSkinIds ?? [])])
    if (!ownedSkinIds.has(skin.id)) throw createError({ statusCode: 403, statusMessage: 'Purchase this skin first' })

    await db.update(pirateState).set({ equippedSkinId: skin.id }).where(eq(pirateState.userId, userId))
    return { skinId: skin.id, equipped: true }
})
