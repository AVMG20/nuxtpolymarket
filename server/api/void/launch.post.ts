import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { ensureVoidState, getLockedVoidState, grantVoidStarterKit, listVoidItems, voidLoadoutFor } from '#server/utils/void'
import { VOID_SUPPLY_CARRY, VOID_SUPPLY_IDS, voidNormalizeSupplies } from '#shared/utils/gamelogic/void-station'
import { randomFloat } from '#shared/utils/random'
import { voidAutoFit, voidBeaconStates, voidCleanBeacons, voidRollBeaconAttack, VOID_STALE_RUN_MS, voidDerivedStats, voidSector, voidSectorUnlocked } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const tier = Number(body?.sector)
    if (!Number.isInteger(tier) || !voidSectorUnlocked(tier, Number.POSITIVE_INFINITY)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid sector' })
    }
    await ensureVoidState(userId)
    await grantVoidStarterKit(userId)

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) {
            // A run nobody finished is a closed tab. It banks nothing, but it
            // still counts as a run so the history stays honest.
            const stale = Date.now() - s.runStartedAt.getTime() > VOID_STALE_RUN_MS
            if (!stale && body?.force !== true) {
                throw createError({ statusCode: 409, statusMessage: 'A run is already in progress' })
            }
            // Supplies loaded into that run were spent with it.
            await tx.update(voidState)
                .set({ runStartedAt: null, runSector: null, runShipId: null, runCargo: null, runsPlayed: s.runsPlayed + 1, runSupplies: null })
                .where(eq(voidState.userId, userId))
        }
        if (!voidSectorUnlocked(tier, s.highestSectorCleared)) {
            throw createError({ statusCode: 400, statusMessage: 'Kill the previous warden first' })
        }

        const items = await listVoidItems(tx, userId)
        // A hull that has never been fitted flies with your best gear instead of bare hardpoints.
        const stored = s.loadouts?.[s.equippedShipId]
        if (!stored && items.length) {
            s.loadouts = { ...(s.loadouts ?? {}), [s.equippedShipId]: voidAutoFit(s.equippedShipId, items) }
            await tx.update(voidState).set({ loadouts: s.loadouts }).where(eq(voidState.userId, userId))
        }
        const loadout = voidLoadoutFor(s, items)
        const stats = voidDerivedStats(loadout.shipId, loadout.levels, loadout.fit, items, loadout.perks)
        const startedAt = new Date()
        // The ship takes up to a full rack of each supply out of stock.
        const stock = voidNormalizeSupplies(s.supplies)
        const taken = {} as Record<string, number>
        const left = { ...stock }
        for (const id of VOID_SUPPLY_IDS) {
            taken[id] = Math.min(VOID_SUPPLY_CARRY, stock[id])
            left[id] = stock[id] - taken[id]
        }
        // Raiders may have moved on a beacon held past its 32 hours. Rolled inside the row lock.
        const beacons = voidRollBeaconAttack(voidCleanBeacons(s.beacons), tier, startedAt.getTime(), randomFloat)
        const [claimed] = await tx.update(voidState)
            .set({ beacons, runStartedAt: startedAt, runSector: tier, runShipId: loadout.shipId, runCargo: stats.cargo, supplies: left, runSupplies: taken })
            .where(and(eq(voidState.userId, userId), isNull(voidState.runStartedAt)))
            .returning({ userId: voidState.userId })
        if (!claimed) throw createError({ statusCode: 409, statusMessage: 'A run is already in progress' })

        return { startedAt, sector: voidSector(tier), loadout, stats, supplies: taken, beacons: voidBeaconStates(beacons, tier) }
    })
})
