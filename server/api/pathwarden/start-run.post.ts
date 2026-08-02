import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedPathwardenState, pathwardenLevels } from '#server/utils/pathwarden'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION
} from '#shared/types/pathwarden-save'
import {
    pathwardenBoostEffects,
    pathwardenPower,
    pathwardenRunCooldownRemainingMs
} from '#shared/utils/gamelogic/pathwarden'
import { createPathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map'
import { validatePathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map-validation'

function randomSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0]!
}

// The generator is deterministic and structurally sound (0 invalid plans across
// a 100k-seed sweep), so this validation is insurance against a future
// regression, and it never rejects a real seed in practice.
function generateValidatedPlan(seed: number, realm: number, allowRegeneration: boolean) {
    let candidateSeed = seed
    for (let attempt = 0; attempt < 8; attempt++) {
        const plan = createPathwardenMapPlan({ seed: candidateSeed, realm })
        if (validatePathwardenMapPlan(plan).errors.length === 0) return { seed: candidateSeed, plan }
        if (!allowRegeneration) break
        candidateSeed = randomSeed()
    }
    throw createError({ statusCode: 500, statusMessage: 'Could not generate a valid Pathwarden map' })
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const body = await readBody<{ realm?: number, useSurge?: boolean, seed?: number }>(event)
    const realm = Math.floor(Number(body.realm))
    if (!Number.isInteger(realm) || realm < 1 || realm > 5) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden realm' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        if (state.runStartedAt) {
            // An active run whose save/generator version no longer matches can
            // never be resumed, so starting a fresh march overwrites it rather
            // than trapping the player behind a 409 (this is the recovery path
            // that used to live, as a write, inside the run.get GET handler).
            const [existing] = await tx.select({
                saveVersion: pathwardenRuns.saveVersion,
                generatorVersion: pathwardenRuns.generatorVersion
            }).from(pathwardenRuns).where(eq(pathwardenRuns.userId, userId))
            const resumable = existing
                && existing.saveVersion === PATHWARDEN_SAVE_VERSION
                && existing.generatorVersion === PATHWARDEN_GENERATOR_VERSION
            if (resumable) {
                throw createError({ statusCode: 409, statusMessage: 'A Pathwarden run is already active' })
            }
        }
        if (pathwardenRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now()) > 0) {
            throw createError({ statusCode: 400, statusMessage: 'The wardens are still recovering. Wait or rush the recovery with Gems.' })
        }
        const maxRealm = Math.min(5, state.highestCompletedRealm + 1)
        if (realm > maxRealm) {
            throw createError({ statusCode: 400, statusMessage: 'Complete the previous realm first' })
        }
        const surged = body.useSurge === true
        if (surged && state.surgeCharges < 1) {
            throw createError({ statusCode: 400, statusMessage: 'No Mist Surge charges available' })
        }
        const levels = pathwardenLevels(state)
        const power = pathwardenPower(levels)
        // The seed is server-chosen. A client-supplied seed would let a player
        // scout layouts offline and replay the easiest one, and pin generation
        // on a worst-case (slow) seed; only development builds honour it.
        const requestedSeed = Number(body.seed)
        const hasDevSeed = debugMode && Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xFFFFFFFF
        const { seed, plan: mapPlan } = generateValidatedPlan(
            hasDevSeed ? requestedSeed : randomSeed(),
            realm,
            !hasDevSeed
        )
        const [run] = await tx.insert(pathwardenRuns)
            .values({
                userId,
                saveVersion: PATHWARDEN_SAVE_VERSION,
                generatorVersion: PATHWARDEN_GENERATOR_VERSION,
                seed,
                realm,
                mapPlan
            })
            .onConflictDoUpdate({
                target: pathwardenRuns.userId,
                set: {
                    revision: 0,
                    saveVersion: PATHWARDEN_SAVE_VERSION,
                    generatorVersion: PATHWARDEN_GENERATOR_VERSION,
                    seed,
                    realm,
                    mapPlan,
                    gameState: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            })
            .returning()
        await tx.update(pathwardenState)
            .set({
                surgeCharges: surged ? state.surgeCharges - 1 : state.surgeCharges,
                runStartedAt: new Date(),
                runRealmSnapshot: realm,
                runPowerSnapshot: power,
                runSurgedSnapshot: surged,
                claimedCheckpointWaves: []
            })
            .where(eq(pathwardenState.userId, userId))
        return {
            realm,
            surged,
            surgeCharges: state.surgeCharges - (surged ? 1 : 0),
            power,
            effects: pathwardenBoostEffects(levels, surged),
            run
        }
    })
})
