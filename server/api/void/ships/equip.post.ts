import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState, voidOwnedShips } from '#server/utils/void'
import { VOID_SHIP_IDS } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const shipId = String(body?.shipId)
    if (!VOID_SHIP_IDS.includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before changing ships' })
        if (!voidOwnedShips(s).includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Ship not owned' })
        await tx.update(voidState).set({ equippedShipId: shipId }).where(eq(voidState.userId, userId))
        return { shipId }
    })
})
