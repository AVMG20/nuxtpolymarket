import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION
} from '#shared/types/pathwarden-save'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const run = await db.query.pathwardenRuns.findFirst({
        where: eq(pathwardenRuns.userId, userId)
    })
    if (!run) return { run: null }
    if (run.saveVersion !== PATHWARDEN_SAVE_VERSION
        || run.generatorVersion !== PATHWARDEN_GENERATOR_VERSION) {
        // There is no safe way to hydrate a run whose save schema or map
        // generator no longer matches the current game. Remove only that
        // incompatible run and release the matching active-run lock so the
        // player can start a fresh march instead of being trapped by a 409.
        await db.transaction(async (tx) => {
            await tx.delete(pathwardenRuns).where(eq(pathwardenRuns.userId, userId))
            await tx.update(pathwardenState)
                .set({
                    runStartedAt: null,
                    runRealmSnapshot: null,
                    runPowerSnapshot: null,
                    runSurgedSnapshot: null
                })
                .where(eq(pathwardenState.userId, userId))
        })
        return { run: null, recovered: true }
    }
    return { run }
})
