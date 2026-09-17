import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    generateValidatedPathwardenPlan,
    getLockedPathwardenState,
    pathwardenRandomSeed
} from '#server/utils/pathwarden'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION
} from '#shared/types/pathwarden-save'

/**
 * The map the next march will be fought on. The client used to generate its own
 * plan and only send the seed, which production ignores — so the run row held a
 * map the player never saw, and the save could not be hydrated on reload.
 *
 * The plan is minted here and kept until the run that uses it ends, so a reload
 * or a realm switch cannot reroll it into an easier layout.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        const [existing] = await tx.select()
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        const usable = existing
            && existing.saveVersion === PATHWARDEN_SAVE_VERSION
            && existing.generatorVersion === PATHWARDEN_GENERATOR_VERSION
        if (usable) return { seed: existing.seed, mapPlan: existing.mapPlan }
        // A started march owns its row even when the row is unusable; start-run
        // is what replaces it, so nothing is minted over the top of it here.
        if (state.runStartedAt) return { seed: null, mapPlan: null }

        const realm = Math.max(1, state.runRealmSnapshot ?? 1)
        const { seed, plan } = generateValidatedPathwardenPlan(pathwardenRandomSeed(), realm, true)
        await tx.insert(pathwardenRuns)
            .values({
                userId,
                saveVersion: PATHWARDEN_SAVE_VERSION,
                generatorVersion: PATHWARDEN_GENERATOR_VERSION,
                seed,
                realm,
                mapPlan: plan
            })
            .onConflictDoUpdate({
                target: pathwardenRuns.userId,
                set: {
                    revision: 0,
                    saveVersion: PATHWARDEN_SAVE_VERSION,
                    generatorVersion: PATHWARDEN_GENERATOR_VERSION,
                    seed,
                    realm,
                    mapPlan: plan,
                    gameState: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            })
        return { seed, mapPlan: plan }
    })
})
