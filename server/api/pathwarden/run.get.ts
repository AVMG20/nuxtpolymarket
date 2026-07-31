import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns } from '#server/database/schema'
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
    // A run whose save or map version no longer matches cannot be hydrated. The
    // GET stays read-only and just reports it as gone; start-run overwrites the
    // stale row and releases the active-run lock when the player begins again.
    if (run.saveVersion !== PATHWARDEN_SAVE_VERSION
        || run.generatorVersion !== PATHWARDEN_GENERATOR_VERSION) {
        return { run: null, recovered: true }
    }
    return { run }
})
