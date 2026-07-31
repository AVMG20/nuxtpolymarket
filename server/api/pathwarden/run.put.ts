import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenRuns, pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    PATHWARDEN_MAX_WAVE,
    pathwardenMaxWaveForElapsedMs
} from '#shared/utils/gamelogic/pathwarden'
import type { PathwardenGameState, PathwardenGridPoint } from '#shared/types/pathwarden-save'

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

const MAX_PATH_POINTS = 512
const GRID_MAX = 4096

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isBoundedPoint(point: unknown): point is PathwardenGridPoint {
    return typeof point === 'object' && point !== null
        && finite((point as PathwardenGridPoint).col) && finite((point as PathwardenGridPoint).row)
        && Math.abs((point as PathwardenGridPoint).col) <= GRID_MAX
        && Math.abs((point as PathwardenGridPoint).row) <= GRID_MAX
}

function validateGameState(state: PathwardenGameState) {
    if (!state || !PHASES.has(state.phase)) return false
    if (!finite(state.wave) || state.wave < 0 || state.wave > PATHWARDEN_MAX_WAVE) return false
    if (!finite(state.lives) || !finite(state.aether) || !finite(state.score)) return false
    if (!Array.isArray(state.claimedRoomIds) || state.claimedRoomIds.length > 64) return false
    if (!Array.isArray(state.activeRoomIds) || state.activeRoomIds.length > 64) return false
    if (!Array.isArray(state.towers) || state.towers.length > 500) return false
    if (!Array.isArray(state.enemies) || state.enemies.length > 1000) return false
    if (!Array.isArray(state.projectiles) || state.projectiles.length > 2000) return false
    // The route path was previously unbounded and unchecked — the one field a
    // client could inflate into a multi-megabyte jsonb write.
    if (!Array.isArray(state.path) || state.path.length > MAX_PATH_POINTS) return false
    if (!state.path.every(isBoundedPoint)) return false
    return true
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ revision?: number, gameState?: PathwardenGameState }>(event)
    const revision = Math.floor(Number(body.revision))
    if (!Number.isInteger(revision) || revision < 0 || !body.gameState || !validateGameState(body.gameState)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden save state' })
    }

    const [progress] = await db.select({ runStartedAt: pathwardenState.runStartedAt })
        .from(pathwardenState)
        .where(eq(pathwardenState.userId, userId))
    if (!progress?.runStartedAt) {
        throw createError({ statusCode: 409, statusMessage: 'No active Pathwarden run' })
    }
    // A save can never claim more waves than the wall-clock plausibly allows, so
    // a checkpoint or victory cannot be forged into the save early. One wave of
    // grace absorbs the boundary moment a wave completes.
    const elapsedMs = Date.now() - progress.runStartedAt.getTime()
    if (body.gameState.wave > pathwardenMaxWaveForElapsedMs(elapsedMs) + 1) {
        throw createError({ statusCode: 400, statusMessage: 'Save reports more progress than the run has had time for' })
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
