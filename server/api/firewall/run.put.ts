import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallRuns, firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    FIREWALL_SAVE_VERSION,
    firewallMaxWaveForElapsedMs,
    firewallValidateSave,
    type FirewallRunSave
} from '#shared/utils/gamelogic/firewall'

/**
 * Stores the run between waves. Called once per uplink, which is the only point
 * the game is in a state worth freezing.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ revision?: number, save?: FirewallRunSave }>(event)
    const revision = Math.floor(Number(body?.revision))
    if (!Number.isInteger(revision) || revision < 0 || !firewallValidateSave(body?.save)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid FIREWALL save state' })
    }
    const save = body.save as FirewallRunSave

    const [progress] = await db.select({
        runStartedAt: firewallState.runStartedAt,
        difficulty: firewallState.runDifficultySnapshot
    }).from(firewallState).where(eq(firewallState.userId, userId))
    if (!progress?.runStartedAt) {
        throw createError({ statusCode: 409, statusMessage: 'No active FIREWALL run' })
    }
    // The difficulty is stamped at deploy and is what the payout ceiling is
    // computed from, so a save may never change it out from under the run.
    if (save.difficulty !== progress.difficulty) {
        throw createError({ statusCode: 400, statusMessage: 'Save difficulty does not match the active run' })
    }
    // A wave takes a fixed time, so a save can never claim more waves than the
    // clock allows. Two waves of grace absorb the uplink and the boundary moment
    // a wave completes.
    const elapsedMs = Date.now() - progress.runStartedAt.getTime()
    if (save.wave > firewallMaxWaveForElapsedMs(elapsedMs) + 2) {
        throw createError({ statusCode: 400, statusMessage: 'Save reports more progress than the run has had time for' })
    }

    const [saved] = await db.update(firewallRuns)
        .set({
            revision: revision + 1,
            saveVersion: FIREWALL_SAVE_VERSION,
            runState: save,
            updatedAt: new Date()
        })
        .where(and(
            eq(firewallRuns.userId, userId),
            eq(firewallRuns.revision, revision)
        ))
        .returning({ revision: firewallRuns.revision, updatedAt: firewallRuns.updatedAt })
    if (!saved) {
        throw createError({ statusCode: 409, statusMessage: 'The FIREWALL save changed in another session' })
    }
    return saved
})
