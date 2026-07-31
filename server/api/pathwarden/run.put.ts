import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import type { PathwardenGameState } from '#shared/types/pathwarden-save'

const PHASES = new Set([
    'planning',
    'wave',
    'checkpoint',
    'path',
    'upgrade',
    'cashout',
    'victory',
    'defeat'
])

function finite(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
}

function validateGameState(state: PathwardenGameState) {
    if (!state || !PHASES.has(state.phase)) return false
    if (!finite(state.wave) || state.wave < 0 || state.wave > 12) return false
    if (!finite(state.lives) || !finite(state.aether) || !finite(state.score)) return false
    if (!Array.isArray(state.claimedRoomIds) || state.claimedRoomIds.length > 64) return false
    if (!Array.isArray(state.activeRoomIds) || state.activeRoomIds.length > 64) return false
    if (!Array.isArray(state.towers) || state.towers.length > 500) return false
    if (!Array.isArray(state.enemies) || state.enemies.length > 1000) return false
    if (!Array.isArray(state.projectiles) || state.projectiles.length > 2000) return false
    return true
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ revision?: number, gameState?: PathwardenGameState }>(event)
    const revision = Math.floor(Number(body.revision))
    if (!Number.isInteger(revision) || revision < 0 || !body.gameState || !validateGameState(body.gameState)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden save state' })
    }
    const [saved] = await db.update(pathwardenRuns)
        .set({
            revision: revision + 1,
            gameState: body.gameState,
            updatedAt: new Date()
        })
        .where(and(
            eq(pathwardenRuns.userId, userId),
            eq(pathwardenRuns.revision, revision)
        ))
        .returning({
            id: pathwardenRuns.id,
            revision: pathwardenRuns.revision,
            updatedAt: pathwardenRuns.updatedAt
        })
    if (!saved) {
        throw createError({
            statusCode: 409,
            statusMessage: 'The Pathwarden save changed in another session'
        })
    }
    return saved
})
