import { and, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import {
    ESSENCE_COLUMN,
    ESSENCE_NAME,
    essenceBalance,
    essenceGain,
    essenceSpend
} from '#server/utils/hero-quest'
import { applyDupes, craftCostFor, isGachaSystem, newEntry } from '#shared/utils/hero-quest/gacha'
import { gachaContent } from '#shared/utils/hero-quest/content/registry'
import { autoEquipFirstPieces, isGearId } from '#shared/utils/hero-quest/content/gear'

/**
 * Craft a specific item in any of the four gachas with that gacha's Essence — the full RNG
 * bypass (`gacha-shared-system.md` §6).
 *
 * Essence has exactly one source: duplicates that land on an already-maxed copy. That is what
 * makes this the sink at the far end of the collection loop rather than a parallel currency —
 * you can only buy your way to a specific item using the overflow from items you have already
 * finished.
 *
 * **Rarity is not a parameter.** The shared doc frames crafting as picking an item *and* a
 * rarity, but every one of the four systems fixes rarity to identity — a Champion's rarity is
 * part of who it is, a Gear piece's rarity is half its name, an Artifact's decides its effect-line
 * count. So the price is looked up from the target rather than requested. Accepting a rarity here
 * would let a client ask for a Mythic at Common prices.
 *
 * ## Concurrency
 *
 * Claim-then-reward, with the **conditional Essence debit as the guard**. Two concurrent crafts
 * against one craft's worth of Essence would otherwise both read the balance, both pass, and both
 * grant. Only the request whose `WHERE <essence> >= cost` matches gets to write a collection row.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'gacha')
    const body = await readBody<{ system?: string; contentId?: string }>(event)

    const system = body?.system
    if (typeof system !== 'string' || !isGachaSystem(system)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown gacha' })
    }
    const content = gachaContent(system)

    const contentId = body?.contentId
    if (typeof contentId !== 'string' || !content.isId(contentId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown item' })
    }

    const definition = content.get(contentId)
    const cost = craftCostFor(definition.rarity)

    return db.transaction(async (tx) => {
        // The debit is the mutex. Nothing below runs for a request that lost the race.
        const [claimed] = await tx.update(hqState)
            .set(essenceSpend(system, cost))
            .where(and(
                eq(hqState.userId, userId),
                sql`${ESSENCE_COLUMN[system]} >= ${cost}`
            ))
            .returning()

        if (!claimed) {
            throw createError({
                statusCode: 400,
                statusMessage: `Crafting ${definition.name} needs ${cost} ${ESSENCE_NAME[system]}`
            })
        }

        const [existing] = await tx.select().from(hqCollection)
            .where(and(
                eq(hqCollection.userId, userId),
                eq(hqCollection.system, system),
                eq(hqCollection.contentId, contentId)
            ))

        // A craft of something already owned behaves exactly like pulling it: one duplicate,
        // merged on the shared curve. Never a no-op, and never wasted.
        const before = existing
            ? { star: existing.star, level: existing.level, dupeProgress: existing.dupeProgress }
            : null
        const outcome = before ? applyDupes(before, 1, definition.rarity) : null
        const entry = outcome ? outcome.entry : newEntry()
        const refunded = outcome?.essenceGained ?? 0

        await tx.insert(hqCollection)
            .values({ userId, system, contentId, ...entry })
            .onConflictDoUpdate({
                target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                set: { star: entry.star, level: entry.level, dupeProgress: entry.dupeProgress }
            })

        /**
         * Gear's first-piece-per-slot auto-equip (`gear-equipment.md` §3) applies to a crafted
         * piece exactly as it does to a pulled one — the player has a slot with one option in it
         * either way, and which route the piece arrived through is not a distinction the rule
         * makes. Needs every owned Gear row, not just this one, since another slot may already
         * be filled.
         */
        let autoEquipped: Record<string, string> | null = null
        if (system === 'gear') {
            const ownedGear = await tx.select().from(hqCollection)
                .where(and(eq(hqCollection.userId, userId), eq(hqCollection.system, 'gear')))
            autoEquipped = autoEquipFirstPieces(
                ownedGear
                    .filter(row => isGearId(row.contentId))
                    .map(row => ({ contentId: row.contentId, star: row.star, level: row.level })),
                claimed.equippedGear as Record<string, string>
            )
        }

        // Crafting onto an already-maxed copy converts straight back to Essence, same as any
        // other duplicate would. A net loss, but not a black hole.
        const writes = { ...essenceGain(system, refunded), ...(autoEquipped ? { equippedGear: autoEquipped } : {}) }
        const [updated] = Object.keys(writes).length > 0
            ? await tx.update(hqState).set(writes).where(eq(hqState.userId, userId)).returning()
            : [claimed]

        return {
            system,
            contentId,
            name: definition.name,
            rarity: definition.rarity,
            isNew: before === null,
            star: entry.star,
            level: entry.level,
            spent: cost,
            refunded,
            essence: essenceBalance(updated ?? claimed, system)
        }
    })
})
