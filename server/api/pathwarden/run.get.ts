import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION
} from '#shared/types/pathwarden-save'
import { pathwardenSaveIsHydratable } from '#shared/utils/gamelogic/pathwarden-map-validation'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const run = await db.query.pathwardenRuns.findFirst({
        where: eq(pathwardenRuns.userId, userId)
    })
    if (!run) return { run: null, recovered: false }
    // A run whose save or map version no longer matches cannot be hydrated. The
    // GET stays read-only and just reports it as gone; start-run overwrites the
    // stale row and releases the active-run lock when the player begins again.
    if (run.saveVersion !== PATHWARDEN_SAVE_VERSION
        || run.generatorVersion !== PATHWARDEN_GENERATOR_VERSION) {
        return { run: null, recovered: true }
    }
    // A save whose road no longer joins up with the stored map cannot be
    // hydrated either: the engine throws while rebuilding the march, which used
    // to leave the player stuck on a run they could neither play nor abandon.
    if (run.gameState && !pathwardenSaveIsHydratable(run.mapPlan, run.gameState)) {
        return { run: null, recovered: true }
    }
    return { run, recovered: false }
})
