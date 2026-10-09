import { eq } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    artifactSlots,
    championSlots,
    getShopLevels,
    skillSlots
} from '#server/utils/hero-quest'
import { validateLiveLoadout, type LoadoutInput } from '#server/utils/hero-quest-loadout'

/**
 * Set any part of the live loadout — party, formation, Skills, Artifacts, Gear, and the
 * Ascendant's picks (`tech-architecture.md` §5: "live equip: party/skills/artifacts/gear/formation";
 * the sixth joined with the Ascendant, `open-items.md` #43).
 *
 * **One route for all six components**, and that is not just tidiness. A formation is only valid
 * against a specific party, so accepting those two separately would leave a window where the
 * saved formation references a Champion no longer fielded; row capacity is checked across the
 * whole resulting party, Hero included, which cannot be done without both halves. Once the route
 * has to take two together it may as well take the set a Loadout is defined as — and then
 * `loadout/apply` is the same validation over a saved preset instead of a request body, which is
 * exactly how it is written.
 *
 * Every field is **optional**: omitting one leaves it untouched, so the Forge page can set Gear
 * without knowing anything about the party.
 *
 * No currency moves here, so this is a plain lock-and-validate rather than claim-then-reward. The
 * lock still matters: slot counts are read from the shop and the loadout is written against them,
 * and a concurrent slot purchase would otherwise let a save race past the count it was validated
 * against.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<LoadoutInput>(event)

    return db.transaction(async (tx: DbExecutor) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        const shopLevels = await getShopLevels(userId, tx)
        const writes = await validateLiveLoadout(tx, userId, state, body ?? {}, shopLevels)

        const [updated] = await tx.update(hqState)
            .set(writes)
            .where(eq(hqState.userId, userId))
            .returning()

        const after = updated ?? state
        return {
            partyChampionIds: after.partyChampionIds,
            formation: after.formation,
            equippedSkillIds: after.equippedSkillIds,
            equippedArtifactIds: after.equippedArtifactIds,
            equippedGear: after.equippedGear,
            ascendantSkillIds: after.ascendantSkillIds,
            slots: {
                champions: championSlots(shopLevels),
                skills: skillSlots(shopLevels),
                artifacts: artifactSlots(shopLevels)
            }
        }
    })
})
