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
 * Reserve a different map for the next march. Nothing is at stake until wave 1
 * calls start-run, so the plan can be rerolled — and named by seed — freely up
 * to that point. A march that has begun owns its row and is refused, which is
 * what stops a reload from rerolling a march already in progress.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ seed?: number }>(event).catch(() => ({} as { seed?: number }))
    const requestedSeed = Number(body?.seed)
    const hasRequestedSeed = Number.isInteger(requestedSeed)
        && requestedSeed >= 0
        && requestedSeed <= 0xFFFFFFFF

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        await tx.select({ userId: pathwardenRuns.userId })
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        if (state.runStartedAt) {
            throw createError({ statusCode: 409, statusMessage: 'A Pathwarden run is already active' })
        }
        const realm = Math.max(1, state.runRealmSnapshot ?? 1)
        // A named seed is honoured exactly; regenerating past it would hand back
        // a different map than the one that was asked for.
        const { seed, plan } = generateValidatedPathwardenPlan(
            hasRequestedSeed ? requestedSeed : pathwardenRandomSeed(),
            realm,
            !hasRequestedSeed
        )
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
