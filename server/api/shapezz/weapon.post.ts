import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit, debit } from '#server/utils/balance'
import { SHAPEZZ_WEAPON_COLUMNS, getLockedShapezzState, shapezzArsenal } from '#server/utils/shapezz'
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
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot buy a weapon during a run' })

        const owned = shapezzArsenal(state)[weaponType]
        if (owned.rarity === weaponRarity) {
            throw createError({ statusCode: 400, statusMessage: 'Weapon is already owned' })
        }

        const weapon = shapezzWeapon(weaponType, weaponRarity)
        // The 25% trade-in only ever applies within the same weapon type: buying
        // a launcher never touches the blaster you own. If the type is not owned
        // yet there is nothing to trade in.
        const previousPrice = owned.rarity === null ? 0 : owned.purchasePrice
        const { refund, netCost } = shapezzWeaponReplacement(previousPrice, weapon.cost)

        // Refund and purchase are recorded separately, but inside the same
        // transaction — if the debit fails everything rolls back together.
        if (refund > 0) await credit(userId, refund.toFixed(4), 'shapezz:weapon-refund', tx)
        if (weapon.cost > 0) await debit(userId, weapon.cost.toFixed(4), 'shapezz:weapon', tx)

        const columns = SHAPEZZ_WEAPON_COLUMNS[weaponType]
        await tx.update(shapezzState).set({
            weaponType,
            [columns.rarity]: weaponRarity,
            [columns.price]: weapon.cost
        }).where(eq(shapezzState.userId, userId))

        return { weapon, refund, netCost }
    })
})
