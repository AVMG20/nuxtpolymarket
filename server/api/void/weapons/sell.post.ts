import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import { voidAddBundles, voidWeaponSellValue, type VoidRarityId } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const weaponId = String(body?.weaponId ?? '')
    if (!weaponId) throw createError({ statusCode: 400, statusMessage: 'Missing weapon' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })

        // Conditional DELETE ... RETURNING is the guard: only the request that
        // actually removes the row gets paid for it, so N parallel sells of the
        // same turret refund exactly once.
        const [removed] = await tx.delete(voidWeapons)
            .where(and(eq(voidWeapons.id, weaponId), eq(voidWeapons.userId, userId)))
            .returning()
        if (!removed) throw createError({ statusCode: 404, statusMessage: 'Turret not found' })

        const remaining = await tx.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
        if (remaining.length === 0) throw createError({ statusCode: 400, statusMessage: 'You need at least one turret' })

        const refund = voidWeaponSellValue(removed.rarityId as VoidRarityId)
        await tx.update(voidState)
            .set({ resources: voidAddBundles(s.resources ?? {}, refund.resources) as Record<string, number> })
            .where(eq(voidState.userId, userId))
        if (refund.credits > 0) await credit(userId, refund.credits.toFixed(4), 'void', tx)

        return { weaponId, refund }
    })
})
