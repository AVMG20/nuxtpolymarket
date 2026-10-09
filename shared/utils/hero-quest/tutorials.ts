/**
 * Feature unlocks and the guide's tutorials (`idea-backlog.md` item 10, `open-items.md` #50).
 *
 * **Two trackers on the same checkpoints** (the backlog's rule). Which features are open is derived
 * from lifetime progress, never stored, so it can't drift and an account that got there before the
 * gates existed has them all. Which tutorials were seen is stored (`hq_state.tutorials_seen`).
 * Resetting the tutorials locks nothing; skipping them unlocks nothing early.
 *
 * Each feature has two tutorials: an **unlock** line when its checkpoint is reached, and a **visit**
 * explanation the first time its scene is opened. There is one more, the **intro**, on a new run.
 *
 * Pure, so the stage the client draws and the gate the server enforces are one function.
 */

import { BOSS_STAGE, FEATURE_UNLOCKS, type FeatureCheckpoint, type HqFeature } from './constants'
import { worldsClearedOf } from './milestones'

export type { HqFeature }

export const HQ_FEATURES: readonly HqFeature[] = FEATURE_UNLOCKS.map(u => u.feature)

const CHECKPOINT_OF = new Map(FEATURE_UNLOCKS.map(u => [u.feature, u.at]))

export function isHqFeature(value: unknown): value is HqFeature {
    return CHECKPOINT_OF.has(value as HqFeature)
}

/** The run's position, as much of it as the checkpoints read. */
export interface UnlockProgress {
    prestige: number
    world: number
    stage: number
    runCleared: boolean
}

export function checkpointReached(at: FeatureCheckpoint, p: UnlockProgress): boolean {
    switch (at.kind) {
        // a prestige is a whole run done, so every boss of every World is behind it
        case 'boss': return p.prestige > 0 || p.world > at.world || (p.world === at.world && p.stage > BOSS_STAGE)
        case 'worlds': return worldsClearedOf(p.prestige, p.world, p.runCleared) >= at.count
        case 'run_cleared': return p.runCleared || p.prestige > 0
        case 'prestiges': return p.prestige >= at.count
    }
}

export function featureUnlocked(feature: HqFeature, p: UnlockProgress): boolean {
    return checkpointReached(CHECKPOINT_OF.get(feature)!, p)
}

/** Every open feature, in the order they open. */
export function unlockedFeatures(p: UnlockProgress): HqFeature[] {
    return HQ_FEATURES.filter(f => featureUnlocked(f, p))
}

export function featureCheckpoint(feature: HqFeature): FeatureCheckpoint {
    return CHECKPOINT_OF.get(feature)!
}

/** What reaching a checkpoint takes, as a sentence's predicate: "Opens once you beat the World 1 boss". */
export function checkpointLabel(at: FeatureCheckpoint): string {
    switch (at.kind) {
        case 'boss': return `beat the World ${at.world} boss`
        case 'worlds': return at.count === 1 ? 'clear a World' : `clear ${at.count} Worlds`
        case 'run_cleared': return 'clear the run'
        case 'prestiges': return at.count === 1 ? 'prestige once' : `prestige ${at.count} times`
    }
}

// ── Tutorials ──────────────────────────────────────────────────────────────────────────

export type TutorialId = 'intro' | `${HqFeature}:unlock` | `${HqFeature}:visit`

export const TUTORIAL_IDS: readonly TutorialId[] = [
    'intro',
    ...HQ_FEATURES.flatMap(f => [`${f}:unlock`, `${f}:visit`] as const)
]

const TUTORIAL_ID_SET = new Set<string>(TUTORIAL_IDS)

export function isTutorialId(value: unknown): value is TutorialId {
    return typeof value === 'string' && TUTORIAL_ID_SET.has(value)
}

/**
 * The tutorial due now, or null. The intro first, on a new run; then the explanation of the open
 * scene, if it is a feature not yet explained; then the oldest unannounced unlock. An unlock already
 * explained by a visit is not announced after it.
 */
export function nextTutorial(unlocked: readonly HqFeature[], seen: readonly string[], scene: string): TutorialId | null {
    const had = new Set(seen)
    if (!had.has('intro')) return 'intro'
    if (isHqFeature(scene) && unlocked.includes(scene) && !had.has(`${scene}:visit`)) return `${scene}:visit`
    for (const f of unlocked) {
        if (!had.has(`${f}:unlock`) && !had.has(`${f}:visit`)) return `${f}:unlock`
    }
    return null
}
