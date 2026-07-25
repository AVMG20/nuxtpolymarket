import { and, eq, gte } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState } from '#server/utils/void'
import { VOID_SHIPS } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const ship = VOID_SHIPS.find(s => s.id === body?.shipId)
    if (!ship) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before changing hulls' })

        const owned = Array.from(new Set(['skiff', ...(s.ownedShipIds ?? [])]))
        if (!owned.includes(ship.id)) throw createError({ statusCode: 400, statusMessage: 'Hull not owned' })

        await tx.update(voidState).set({ equippedShipId: ship.id }).where(eq(voidState.userId, userId))
        await tx.update(voidWeapons)
            .set({ slotIndex: null })
            .where(and(eq(voidWeapons.userId, userId), gte(voidWeapons.slotIndex, ship.turretSlots)))

        return { shipId: ship.id }
    })
})
