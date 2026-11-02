import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { PIRATE_SHIP_SKINS } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

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

        const gems = await debitGems(userId, skin.cost, 'pirates', tx)

        await tx.update(pirateState)
            .set({ ownedSkinIds: [...ownedSkinIds, skin.id], equippedSkinId: skin.id })
            .where(eq(pirateState.userId, userId))

        return { skinId: skin.id, equipped: true, gems }
    })
})
