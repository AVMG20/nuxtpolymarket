import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { user, voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import { VOID_SHIPS, voidCanAfford, voidSubtractBundle } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const ship = VOID_SHIPS.find(s => s.id === body?.shipId)
    if (!ship || (ship.cost.credits <= 0 && !ship.cost.gems)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })
    }
    const gemCost = Math.max(0, Math.floor(ship.cost.gems ?? 0))

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

        if (gemCost > 0) {
            // The gte in the WHERE is the guard — a conditional UPDATE, not a
            // read-then-write, so parallel purchases can't both pass the check.
            const [charged] = await tx.update(user)
                .set({ gems: sql`${user.gems} - ${gemCost}` })
                .where(and(eq(user.id, userId), gte(user.gems, gemCost)))
                .returning({ gems: user.gems })
            if (!charged) throw createError({ statusCode: 400, statusMessage: `Need ${gemCost} gems` })
        }

        if (ship.cost.credits > 0) await debit(userId, ship.cost.credits.toFixed(4), 'void', tx)

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

        return { shipId: ship.id, equipped: true, gemsSpent: gemCost }
    })
})
