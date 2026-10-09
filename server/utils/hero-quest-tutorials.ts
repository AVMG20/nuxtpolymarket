/**
 * Feature unlocks and the guide's tutorials on the server (`shared/utils/hero-quest/tutorials.ts`).
 *
 * The unlocks are a gate, not only a hidden button: every route that acts for a feature asks
 * `requireFeature` first, so a client can't reach one early. They are read off the run's position,
 * which only moves forward, so a read a moment stale can only refuse, never let through.
 */

import { eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqState } from '#server/database/schema'
import type { HqStateRow } from '#server/utils/hero-quest'
import {
    checkpointLabel,
    featureCheckpoint,
    featureUnlocked,
    unlockedFeatures,
    type HqFeature,
    type TutorialId,
    type UnlockProgress
} from '#shared/utils/hero-quest/tutorials'

export function unlockProgressOf(state: Pick<HqStateRow, 'prestige' | 'world' | 'stage' | 'runCleared'>): UnlockProgress {
    return { prestige: state.prestige, world: state.world, stage: state.stage, runCleared: state.runCleared }
}

/** Refuse unless `feature` is open: its checkpoint reached. */
export async function requireFeature(userId: string, feature: HqFeature, executor: DbExecutor = db): Promise<void> {
    const [state] = await executor
        .select({ prestige: hqState.prestige, world: hqState.world, stage: hqState.stage, runCleared: hqState.runCleared })
        .from(hqState)
        .where(eq(hqState.userId, userId))
    if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    if (!featureUnlocked(feature, unlockProgressOf(state))) {
        throw createError({ statusCode: 403, statusMessage: `That opens once you ${checkpointLabel(featureCheckpoint(feature))}` })
    }
}

/** What the stage needs: the open features, in the order they opened, and the tutorials seen. */
export function serializeTutorials(state: HqStateRow) {
    return {
        unlocked: unlockedFeatures(unlockProgressOf(state)),
        seen: state.tutorialsSeen
    }
}

/** Record a tutorial as seen. A set, so a repeat is a no-op, and nothing of value moves. */
export async function markTutorialSeen(userId: string, id: TutorialId): Promise<void> {
    await db.update(hqState)
        .set({ tutorialsSeen: sql`${hqState.tutorialsSeen} || ${JSON.stringify([id])}::jsonb` })
        .where(sql`${hqState.userId} = ${userId} and not (${hqState.tutorialsSeen} ? ${id})`)
}

/** See every tutorial again. Locks nothing: the features stay as open as the run has earned. */
export async function resetTutorials(userId: string): Promise<void> {
    await db.update(hqState).set({ tutorialsSeen: [] }).where(eq(hqState.userId, userId))
}
