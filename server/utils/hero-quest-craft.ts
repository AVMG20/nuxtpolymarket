import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqState } from '#server/database/schema'
import { ESSENCE_NAME, essenceBalance, essenceSpend, lockLiveLoadout } from '#server/utils/hero-quest'
import type { HqCraftResponse } from '#server/utils/hero-quest-api'
import { autoEquipFirstPieces, isGearId } from '#shared/utils/hero-quest/content/gear'
import { gachaContent } from '#shared/utils/hero-quest/content/registry'
import { applyCraft, craftCostFor, craftMaxCopies, type GachaSystem } from '#shared/utils/hero-quest/gacha'

/**
 * Craft one copy of a specific item with its gacha's Essence, or with `max` as many as it buys.
 * Lock-then-read, because a max's copy count depends on the balance: a second request in a burst finds it spent.
 */
export async function craftItem(userId: string, system: GachaSystem, contentId: string, max = false): Promise<HqCraftResponse> {
    const content = gachaContent(system)
    if (!content.isId(contentId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown item' })
    }

    // Rarity comes from the item, never the request: a client must not ask for a Mythic at Common prices.
    const definition = content.get(contentId)
    const cost = craftCostFor(definition.rarity)

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        const [existing] = await tx.select().from(hqCollection)
            .where(and(
                eq(hqCollection.userId, userId),
                eq(hqCollection.system, system),
                eq(hqCollection.contentId, contentId)
            ))
        const before = existing
            ? { star: existing.star, level: existing.level, dupeProgress: existing.dupeProgress }
            : null

        const essence = essenceBalance(state, system)
        if (essence < cost) {
            throw createError({
                statusCode: 400,
                statusMessage: `Crafting ${definition.name} needs ${cost} ${ESSENCE_NAME[system]}`
            })
        }

        const count = max ? craftMaxCopies(before, essence, definition.rarity) : 1
        if (count === 0) throw createError({ statusCode: 400, statusMessage: `${definition.name} is already maxed` })

        // A single craft onto a maxed copy still converts back to Essence, like any other duplicate.
        const { entry, essenceGained: refunded } = applyCraft(before, count, definition.rarity)
        const spent = cost * count

        await tx.insert(hqCollection)
            .values({ userId, system, contentId, ...entry })
            .onConflictDoUpdate({
                target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                set: { star: entry.star, level: entry.level, dupeProgress: entry.dupeProgress }
            })

        // A crafted first piece fills an empty slot like a pulled one; another slot may already be filled.
        let autoEquipped: Record<string, string> | null = null
        if (system === 'gear') {
            const ownedGear = await tx.select().from(hqCollection)
                .where(and(eq(hqCollection.userId, userId), eq(hqCollection.system, 'gear')))
            autoEquipped = autoEquipFirstPieces(
                ownedGear
                    .filter(row => isGearId(row.contentId))
                    .map(row => ({ contentId: row.contentId, star: row.star, level: row.level })),
                // on the player's own loadout: a raid's preferred one still live goes back first
                (await lockLiveLoadout(tx, userId)).equippedGear as Record<string, string>
            )
        }

        const [updated] = await tx.update(hqState)
            .set({ ...essenceSpend(system, spent - refunded), ...(autoEquipped ? { equippedGear: autoEquipped } : {}) })
            .where(eq(hqState.userId, userId))
            .returning()

        return {
            system,
            contentId,
            name: definition.name,
            rarity: definition.rarity,
            isNew: before === null,
            star: entry.star,
            level: entry.level,
            crafted: count,
            spent,
            refunded,
            essence: essenceBalance(updated!, system)
        }
    })
}
