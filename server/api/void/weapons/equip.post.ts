import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedVoidState } from '#server/utils/void'
import { voidShip } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const weaponId = String(body?.weaponId ?? '')
    const rawSlot = body?.slotIndex
    // null means "put it back in storage".
    const slotIndex = rawSlot === null || rawSlot === undefined ? null : Number(rawSlot)
    if (!weaponId) throw createError({ statusCode: 400, statusMessage: 'Missing weapon' })
    if (slotIndex !== null && (!Number.isInteger(slotIndex) || slotIndex < 0)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid slot' })
    }

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })

        const ship = voidShip(s.equippedShipId)
        if (slotIndex !== null && slotIndex >= ship.turretSlots) {
            throw createError({ statusCode: 400, statusMessage: `${ship.name} only has ${ship.turretSlots} hardpoint${ship.turretSlots === 1 ? '' : 's'}` })
        }

        const weapon = await tx.query.voidWeapons.findFirst({
            where: and(eq(voidWeapons.id, weaponId), eq(voidWeapons.userId, userId))
        })
        if (!weapon) throw createError({ statusCode: 404, statusMessage: 'Turret not found' })

        if (slotIndex !== null) {
            // Whatever was already bolted into this hardpoint goes to storage,
            // so the swap can never leave two turrets claiming one slot.
            await tx.update(voidWeapons)
                .set({ slotIndex: null })
                .where(and(eq(voidWeapons.userId, userId), eq(voidWeapons.slotIndex, slotIndex)))
        }

        await tx.update(voidWeapons)
            .set({ slotIndex })
            .where(and(eq(voidWeapons.id, weaponId), eq(voidWeapons.userId, userId)))

        return { weaponId, slotIndex }
    })
})
