import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState, voidCharge, voidOwnedShips } from '#server/utils/void'
import { VOID_MAX_SHIP_TIER, VOID_SHIP_IDS, voidNormalizeShipTiers, voidRefitCost, voidShipTier } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const shipId = String(body?.shipId)
    if (!VOID_SHIP_IDS.includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })

    return db.transaction(async (tx) => {
        // The row lock makes the tier read and the charge one step, so a burst of refits pays for each tier it takes.
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before visiting the shipyard' })
        if (!voidOwnedShips(s).includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Ship not owned' })
        const tier = voidShipTier(shipId, s.shipTiers) + 1
        const cost = tier <= VOID_MAX_SHIP_TIER ? voidRefitCost(tier) : null
        if (!cost) throw createError({ statusCode: 400, statusMessage: 'This hull is fully refitted' })
        if (s.highestSectorCleared < tier - 1) throw createError({ statusCode: 400, statusMessage: `Clear sector ${tier - 1} first` })
        const resources = await voidCharge(tx, userId, s.resources, cost)
        await tx.update(voidState)
            .set({ resources, shipTiers: { ...voidNormalizeShipTiers(s.shipTiers), [shipId]: tier } })
            .where(eq(voidState.userId, userId))
        return { shipId, tier }
    })
})
