import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedShapezzState, shapezzArsenal } from '#server/utils/shapezz'
import { SHAPEZZ_WEAPON_TYPES, shapezzWeapon, type ShapezzWeaponType } from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const weaponType = body?.weaponType as ShapezzWeaponType
    if (!SHAPEZZ_WEAPON_TYPES.includes(weaponType)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid SHAPEZZ weapon type' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedShapezzState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot switch weapons during a run' })
        if (state.weaponType === weaponType) throw createError({ statusCode: 400, statusMessage: 'Weapon is already equipped' })

        const owned = shapezzArsenal(state)[weaponType]
        if (owned.rarity === null) throw createError({ statusCode: 400, statusMessage: 'Weapon type is not owned' })

        await tx.update(shapezzState).set({ weaponType }).where(eq(shapezzState.userId, userId))

        return { weapon: shapezzWeapon(weaponType, owned.rarity) }
    })
})
