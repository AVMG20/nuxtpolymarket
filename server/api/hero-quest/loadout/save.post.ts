import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqLoadouts, hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getShopLevels, loadoutSlots } from '#server/utils/hero-quest'
import { LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'

/**
 * Save the live state into a Loadout slot (`loadouts.md` §2).
 *
 * Captures **all five components at once** — party, formation, Skills, Artifacts, Gear — because
 * that is what a Loadout *is* (§1), and the entire point is bundling what would otherwise be four
 * or five separate manual swaps into one action. Anything less would be a partial snapshot that
 * applies to a state it was never taken from.
 *
 * **Hero class is deliberately excluded** (§1). The Hero's node in the 16-node tree can only
 * change at prestige (`classes-and-combat.md` §5), so it is not a mid-run choice the way
 * everything else here is.
 *
 * Free and unlimited outside combat, so no currency moves and nothing needs claiming. The upsert
 * on `(userId, slotIndex)` is what makes a double-submit idempotent rather than a second row.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ slotIndex?: number; name?: string }>(event)

    const slotIndex = Math.floor(Number(body?.slotIndex))
    if (!Number.isFinite(slotIndex) || slotIndex < 0) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a loadout slot' })
    }

    const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
    // A sensible default rather than a rejection (§2 — "player-named, with a sensible default").
    const name = (rawName || `Loadout ${slotIndex + 1}`).slice(0, LOADOUT_NAME_MAX_LENGTH)

    return db.transaction(async (tx) => {
        // Lock the state being copied, so a concurrent equip cannot half-land inside the snapshot.
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        const shopLevels = await getShopLevels(userId, tx)
        const slots = loadoutSlots(shopLevels)
        if (slotIndex >= slots) {
            throw createError({ statusCode: 400, statusMessage: `Only ${slots} loadout slots unlocked` })
        }

        const snapshot = {
            name,
            partyChampionIds: state.partyChampionIds as string[],
            formation: state.formation as Record<string, 'front' | 'back'>,
            equippedSkillIds: state.equippedSkillIds as string[],
            equippedArtifactIds: state.equippedArtifactIds as string[],
            equippedGear: state.equippedGear as Record<string, string>,
            ascendantSkillIds: state.ascendantSkillIds,
            updatedAt: new Date()
        }

        const [saved] = await tx.insert(hqLoadouts)
            .values({ userId, slotIndex, ...snapshot })
            .onConflictDoUpdate({
                target: [hqLoadouts.userId, hqLoadouts.slotIndex],
                set: snapshot
            })
            .returning()

        return { slotIndex, name, saved: saved !== undefined }
    })
})
