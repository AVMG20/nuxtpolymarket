import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    generateValidatedPathwardenPlan,
    getLockedPathwardenState,
    pathwardenLevels,
    pathwardenRandomSeed
} from '#server/utils/pathwarden'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION
} from '#shared/types/pathwarden-save'
import {
    pathwardenBoostEffects,
    pathwardenPower,
    pathwardenRunCooldownRemainingMs
} from '#shared/utils/gamelogic/pathwarden'
import { pathwardenSaveIsHydratable } from '#shared/utils/gamelogic/pathwarden-map-validation'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ realm?: number, useSurge?: boolean, seed?: number }>(event)
    const realm = Math.floor(Number(body.realm))
    if (!Number.isInteger(realm) || realm < 1 || realm > 5) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden realm' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedPathwardenState(tx, userId)
        const [existing] = await tx.select()
            .from(pathwardenRuns)
            .where(eq(pathwardenRuns.userId, userId))
            .for('update')
        const currentVersions = existing
            && existing.saveVersion === PATHWARDEN_SAVE_VERSION
            && existing.generatorVersion === PATHWARDEN_GENERATOR_VERSION
        if (state.runStartedAt) {
            // An active run whose save cannot be hydrated — a stale save/generator
            // version, or a save recorded against another map — can never be
            // resumed, so starting a fresh march overwrites it rather than
            // trapping the player behind a 409 (this is the recovery path that
            // used to live, as a write, inside the run.get GET handler).
            const resumable = currentVersions
                && (!existing.gameState || pathwardenSaveIsHydratable(existing.mapPlan, existing.gameState))
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
        // A request may name the seed to generate the march from; anything
        // outside a uint32 falls back to a server-chosen seed.
        const requestedSeed = Number(body.seed)
        const hasRequestedSeed = Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xFFFFFFFF
        // The map the player has been looking at was minted by pending-map and is
        // already in this row — a resumable march would have thrown above, so
        // adopting it is what keeps the march the client plays and the march the
        // save describes the same map.
        const { seed, plan: mapPlan } = hasRequestedSeed || !currentVersions
            ? generateValidatedPathwardenPlan(hasRequestedSeed ? requestedSeed : pathwardenRandomSeed(), realm, !hasRequestedSeed)
            : { seed: existing.seed, plan: { ...existing.mapPlan, realm } }
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
            run: run!
        }
    })
})
