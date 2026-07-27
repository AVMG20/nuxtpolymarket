import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getLockedPathwardenState, pathwardenLevels } from '#server/utils/pathwarden'
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
        if (state.runStartedAt) {
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
        await tx.update(pathwardenState)
            .set({
                surgeCharges: surged ? state.surgeCharges - 1 : state.surgeCharges,
                runStartedAt: new Date(),
                runRealmSnapshot: realm,
                runPowerSnapshot: power,
                runSurgedSnapshot: surged
            })
            .where(eq(pathwardenState.userId, userId))
        return {
            realm,
            surged,
            surgeCharges: state.surgeCharges - (surged ? 1 : 0),
            power,
            effects: pathwardenBoostEffects(levels, surged)
        }
    })
})
