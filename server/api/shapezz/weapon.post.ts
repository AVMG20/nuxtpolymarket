import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit, debit } from '#server/utils/balance'
import { getLockedShapezzState } from '#server/utils/shapezz'
import {
    SHAPEZZ_WEAPON_RARITIES,
    SHAPEZZ_WEAPON_TYPES,
    shapezzWeapon,
    shapezzWeaponReplacement,
    type ShapezzWeaponRarity,
    type ShapezzWeaponType
} from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const weaponType = body?.weaponType as ShapezzWeaponType
    const weaponRarity = body?.weaponRarity as ShapezzWeaponRarity
    if (!SHAPEZZ_WEAPON_TYPES.includes(weaponType) || !SHAPEZZ_WEAPON_RARITIES.includes(weaponRarity)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid SHAPEZZ weapon' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot replace a weapon during a run' })
        if (state.weaponType === weaponType && state.weaponRarity === weaponRarity) {
            throw createError({ statusCode: 400, statusMessage: 'Weapon is already equipped' })
        }

        const weapon = shapezzWeapon(weaponType, weaponRarity)
        const { refund, netCost } = shapezzWeaponReplacement(state.weaponPurchasePrice, weapon.cost)

        // Record the 25% trade-in and the new purchase separately, but inside
        // the same transaction. If the purchase debit fails, the refund and
        // weapon swap roll back with it.
        if (refund > 0) await credit(userId, refund.toFixed(4), 'shapezz:weapon-refund', tx)
        if (weapon.cost > 0) await debit(userId, weapon.cost.toFixed(4), 'shapezz:weapon', tx)

        await tx.update(shapezzState).set({
            weaponType,
            weaponRarity,
            weaponPurchasePrice: weapon.cost
        }).where(eq(shapezzState.userId, userId))

        return { weapon, refund, netCost }
    })
})
