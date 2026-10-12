import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqLoadouts, hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { getShopLevels, loadoutSlots, restoreLoadoutSession, settleHq } from '#server/utils/hero-quest'
import { validateLiveLoadout } from '#server/utils/hero-quest-loadout'

/**
 * Apply a saved Loadout as the new live state (`loadouts.md` §2).
 *
 * Sets **all six components at once** — that is the entire point of the feature. The one
 * exception is the Ascendant's picks: a preset saved without any (before the Ascendant existed, or
 * before any were picked) leaves the live picks alone rather than clearing them.
 *
 * ## Why a preset goes through the same validation as a hand-typed request
 *
 * §1 promises a Loadout "never goes stale": nothing in this game is ever un-owned and slot counts
 * only ever grow, so an old preset stays valid and "applying it just fills however many slots it
 * references". Running it through `validateLiveLoadout` is what *keeps* that promise honest
 * rather than assuming it — a preset saved before a slot count changed, or referencing content a
 * roster edit dropped, is filtered rather than rejected. The promise holds because filtering can
 * only ever be a no-op or a truncation, never a loss.
 *
 * It also closes the obvious hole: a preset is client-writable state, so trusting it on apply
 * would let a save-then-apply pair bypass every ownership check `loadout/set` performs.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'loadouts')
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    const body = await readBody<{ slotIndex?: number }>(event)

    const slotIndex = Math.floor(Number(body?.slotIndex))
    if (!Number.isFinite(slotIndex) || slotIndex < 0) {
        throw createError({ statusCode: 400, statusMessage: 'Pick a loadout slot' })
    }

    return db.transaction(async (tx) => {
        const [locked] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!locked) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
        // a raid's preferred Loadout still live goes back first: the player has left the raid
        const state = await restoreLoadoutSession(tx, userId, locked)

        const shopLevels = await getShopLevels(userId, tx)
        if (slotIndex >= loadoutSlots(shopLevels)) {
            throw createError({ statusCode: 400, statusMessage: 'That loadout slot is locked' })
        }

        const [preset] = await tx.select().from(hqLoadouts)
            .where(and(eq(hqLoadouts.userId, userId), eq(hqLoadouts.slotIndex, slotIndex)))
        if (!preset) {
            throw createError({ statusCode: 400, statusMessage: 'Nothing saved in that slot' })
        }

        const writes = await validateLiveLoadout(tx, userId, state, {
            championIds: preset.partyChampionIds,
            formation: preset.formation,
            skillIds: preset.equippedSkillIds,
            artifactIds: preset.equippedArtifactIds,
            gear: preset.equippedGear,
            ...(preset.ascendantSkillIds.length ? { ascendantSkillIds: preset.ascendantSkillIds } : {})
        }, shopLevels)

        const [updated] = await tx.update(hqState)
            .set(writes)
            .where(eq(hqState.userId, userId))
            .returning()

        const after = updated ?? state
        return {
            slotIndex,
            name: preset.name,
            partyChampionIds: after.partyChampionIds,
            formation: after.formation,
            equippedSkillIds: after.equippedSkillIds,
            equippedArtifactIds: after.equippedArtifactIds,
            equippedGear: after.equippedGear,
            ascendantSkillIds: after.ascendantSkillIds
        }
    })
})
