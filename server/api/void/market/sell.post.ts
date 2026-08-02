import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import {
    VOID_RESOURCE_IDS, voidUnitPrice, voidNormalizeLevels, voidDerivedStats,
    type VoidResourceId, type VoidWeaponInstance, type VoidAffixId, type VoidSpecialId, type VoidRarityId
} from '#shared/utils/gamelogic/void'

/**
 * The only place material becomes money. Nothing in a run pays coins, so every
 * coin this game has ever produced passed through here — and through a
 * successful extraction before that.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const resource = String(body?.resource ?? '') as VoidResourceId
    if (!VOID_RESOURCE_IDS.includes(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })

    const rawAmount = body?.amount
    // `all` is the common case and avoids the client having to echo a number
    // back that it may have read before the last run settled.
    const sellAll = rawAmount === 'all'
    const requested = sellAll ? Infinity : Math.floor(Number(rawAmount) || 0)
    if (!sellAll && requested <= 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })

    return db.transaction(async (tx) => {
        // Lock-then-read: the held amount is read here and written below, so
        // two concurrent sells would otherwise both see the same stock.
        const s = await getLockedVoidState(tx, userId)
        const held = s.resources ?? {}
        const available = Math.max(0, Math.floor(held[resource] ?? 0))
        const amount = Math.min(available, requested)
        if (amount <= 0) throw createError({ statusCode: 400, statusMessage: `No ${resource} in your stores` })

        // Profiteering rolls and the Refinery track raise what the dock pays,
        // resolved from the current loadout rather than trusted from the client.
        const rows = await tx.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
        const weapons: VoidWeaponInstance[] = rows.map(row => ({
            id: row.id,
            rarityId: row.rarityId as VoidRarityId,
            name: row.name,
            affixes: row.affixes as Partial<Record<VoidAffixId, number>>,
            specialId: (row.specialId ?? null) as VoidSpecialId | null,
            slotIndex: row.slotIndex
        }))
        const stats = voidDerivedStats({
            levels: voidNormalizeLevels(s.upgradeLevels),
            shipId: s.equippedShipId,
            weapons
        })

        const unitPrice = voidUnitPrice(resource) * stats.marketPriceMult
        const payout = Math.round(unitPrice * amount)

        const left = available - amount
        // Rebuilt rather than mutated so an emptied stack drops out of the map
        // entirely instead of lingering as a zero.
        const nextResources: Record<string, number> = {}
        for (const id of VOID_RESOURCE_IDS) {
            const remaining = id === resource ? left : Math.max(0, Math.floor(held[id] ?? 0))
            if (remaining > 0) nextResources[id] = remaining
        }

        await tx.update(voidState).set({
            resources: nextResources,
            totalCreditsEarned: s.totalCreditsEarned + payout
        }).where(eq(voidState.userId, userId))

        if (payout > 0) await credit(userId, payout.toFixed(4), 'void', tx)

        return { resource, amount, payout, unitPrice: Math.round(unitPrice), remaining: left }
    })
})
