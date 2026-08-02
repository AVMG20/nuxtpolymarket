import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import {
    VOID_UPGRADE_IDS, voidNormalizeLevels, voidUpgradeCost, voidCanAfford, voidSubtractBundle,
    type VoidUpgradeId
} from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const id = body?.upgrade as VoidUpgradeId
    if (!VOID_UPGRADE_IDS.includes(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upgrade' })

    return db.transaction(async (tx) => {
        // Lock-then-read: the level and the resource map are both read here and
        // written below, so two concurrent upgrades would otherwise each read
        // the same level, both pay, and both write level + 1.
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })

        const levels = voidNormalizeLevels(s.upgradeLevels)
        const cost = voidUpgradeCost(id, levels[id])
        if (!cost) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

        const held = s.resources ?? {}
        if (!voidCanAfford(held, cost.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough resources' })

        await debit(userId, cost.credits.toFixed(4), 'void', tx)

        const nextLevels = { ...levels, [id]: levels[id] + 1 }
        await tx.update(voidState)
            .set({ upgradeLevels: nextLevels, resources: voidSubtractBundle(held, cost.resources) as Record<string, number> })
            .where(eq(voidState.userId, userId))

        return { upgrade: id, level: nextLevels[id] }
    })
})
