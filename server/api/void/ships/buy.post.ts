import { and, eq, gte } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import { VOID_SHIPS, voidCanAfford, voidSubtractBundle } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const ship = VOID_SHIPS.find(s => s.id === body?.shipId)
    if (!ship || ship.cost.credits <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before changing hulls' })

        const owned = Array.from(new Set(['skiff', ...(s.ownedShipIds ?? [])]))
        if (owned.includes(ship.id)) throw createError({ statusCode: 400, statusMessage: 'Hull already in the fleet' })
        if (s.highestSectorExtracted < ship.requiresSector) {
            throw createError({ statusCode: 400, statusMessage: `Extract from sector ${ship.requiresSector} first` })
        }

        const held = s.resources ?? {}
        if (!voidCanAfford(held, ship.cost.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough resources' })

        await debit(userId, ship.cost.credits.toFixed(4), 'void', tx)

        await tx.update(voidState).set({
            ownedShipIds: [...owned, ship.id],
            equippedShipId: ship.id,
            resources: voidSubtractBundle(held, ship.cost.resources) as Record<string, number>
        }).where(eq(voidState.userId, userId))

        // Hull swaps can drop hardpoints (the Wraith has three where the
        // Leviathan had four), so anything sitting past the new ceiling goes
        // back to storage rather than silently firing from a slot that no
        // longer exists.
        await tx.update(voidWeapons)
            .set({ slotIndex: null })
            .where(and(eq(voidWeapons.userId, userId), gte(voidWeapons.slotIndex, ship.turretSlots)))

        return { shipId: ship.id, equipped: true }
    })
})
