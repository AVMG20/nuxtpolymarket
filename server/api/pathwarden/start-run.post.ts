import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    generateValidatedPathwardenPlan,
    getLockedPathwardenState,
    pathwardenLevels,
    pathwardenRandomSeed,
    pathwardenRunIsResumable
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

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ realm?: number, useSurge?: boolean }>(event)
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
        if (state.runStartedAt && pathwardenRunIsResumable(existing)) {
            throw createError({ statusCode: 409, statusMessage: 'A Pathwarden run is already active' })
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
        // The map the player has been looking at was minted by pending-map and is
        // already in this row — a resumable march would have thrown above, so
        // adopting it is what keeps the march the client plays and the march the
        // save describes the same map. The seed is chosen before the march
        // begins, through pending-map, so nothing here can diverge from it.
        const { seed, plan: mapPlan } = currentVersions
            ? { seed: existing.seed, plan: { ...existing.mapPlan, realm } }
            : generateValidatedPathwardenPlan(pathwardenRandomSeed(), realm, true)
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
