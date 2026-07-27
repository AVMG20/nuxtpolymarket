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
    if (run.saveVersion !== PATHWARDEN_SAVE_VERSION
        || run.generatorVersion !== PATHWARDEN_GENERATOR_VERSION) {
        throw createError({
            statusCode: 409,
            statusMessage: 'This Pathwarden save belongs to an unsupported game version'
        })
    }
    return { run }
})
