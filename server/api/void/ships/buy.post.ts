import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState, listVoidItems, voidCharge, voidOwnedShips } from '#server/utils/void'
import { VOID_SHIPS, voidAutoFit, voidShipUnlocked } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const ship = VOID_SHIPS.find(s => s.id === body?.shipId)
    if (!ship) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before visiting the shipyard' })
        const owned = voidOwnedShips(s)
        if (owned.includes(ship.id)) throw createError({ statusCode: 400, statusMessage: 'Already in your fleet' })
        if (s.highestSectorCleared < ship.requiresSector) {
            throw createError({ statusCode: 400, statusMessage: `Clear sector ${ship.requiresSector} first` })
        }
        if (!voidShipUnlocked(ship, s.highestSectorCleared, owned)) throw createError({ statusCode: 400, statusMessage: 'Own every other ship first' })
        const resources = await voidCharge(tx, userId, s.resources, { resources: ship.cost, coins: ship.coins, gems: ship.gems })
        // A new hull comes out of the yard fitted with your best gear.
        const fit = voidAutoFit(ship.id, await listVoidItems(tx, userId))
        await tx.update(voidState)
            .set({ ownedShipIds: [...owned, ship.id], equippedShipId: ship.id, resources, loadouts: { ...(s.loadouts ?? {}), [ship.id]: fit } })
            .where(eq(voidState.userId, userId))
        return { shipId: ship.id }
    })
})
