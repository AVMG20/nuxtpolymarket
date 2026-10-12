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
    /** The boss at this gate beat the party (`hq_state.boss_lost`): it has been fought, if not yet beaten. */
    bossLost: boolean
}

export function checkpointReached(at: FeatureCheckpoint, p: UnlockProgress): boolean {
    switch (at.kind) {
        // a prestige is a whole run done, so every boss of every World is behind it; losing to the
        // boss counts too, since a wall is when the party needs what opens there (the user's call)
        case 'boss': return p.prestige > 0 || p.world > at.world
            || (p.world === at.world && (p.stage > BOSS_STAGE || (p.stage === BOSS_STAGE && p.bossLost)))
        case 'boss_beaten': return p.prestige > 0 || p.world > at.world || (p.world === at.world && p.stage > BOSS_STAGE)
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

/** Features that are a tab in another feature's scene since 2026-10-10, by the scene they live in. */
const TAB_FEATURES: Readonly<Partial<Record<HqFeature, HqFeature>>> = { speed: 'shop', milestones: 'calendar' }

/**
 * The menu button a feature lives behind: its own scene, except Battle Speed, a tab in the Shop,
 * and the Milestones, a tab in the Calendar. Its unlock points at that button, and its red dot sits there.
 */
export function featureMenuScene(feature: HqFeature): Exclude<HqFeature, 'speed' | 'milestones'> {
    return (TAB_FEATURES[feature] ?? feature) as Exclude<HqFeature, 'speed' | 'milestones'>
}

/** What reaching a checkpoint takes, as a sentence's predicate: "Opens once you beat the World 1 boss". */
export function checkpointLabel(at: FeatureCheckpoint): string {
    switch (at.kind) {
        case 'boss': return `fight the World ${at.world} boss`
        case 'boss_beaten': return `beat the World ${at.world} boss`
        case 'worlds': return at.count === 1 ? 'clear a World' : `clear ${at.count} Worlds`
        case 'run_cleared': return 'clear the run'
        case 'prestiges': return at.count === 1 ? 'prestige once' : `prestige ${at.count} times`
    }
}

// ── Tutorials ──────────────────────────────────────────────────────────────────────────

export type TutorialId = 'intro' | 'loss_reminder' | `${HqFeature}:unlock` | `${HqFeature}:visit`

export const TUTORIAL_IDS: readonly TutorialId[] = [
    'intro',
    'loss_reminder',
    ...HQ_FEATURES.flatMap(f => [`${f}:unlock`, `${f}:visit`] as const)
]

/**
 * Silent marks kept with the tutorials seen: the boss fights lost, counted to the second, which is
 * when the guide reminds the player once that the Gacha and Collections are the answer (the user's
 * call, 2026-10-09). A reset clears them with the rest.
 */
export const BOSS_LOSS_MARKS = ['boss_lost_1', 'boss_lost_2'] as const
export type TutorialMark = typeof BOSS_LOSS_MARKS[number]

/** Anything the seen set may hold: a tutorial read, or a mark. */
export type TutorialRecord = TutorialId | TutorialMark

const TUTORIAL_RECORD_SET = new Set<string>([...TUTORIAL_IDS, ...BOSS_LOSS_MARKS])

export function isTutorialRecord(value: unknown): value is TutorialRecord {
    return typeof value === 'string' && TUTORIAL_RECORD_SET.has(value)
}

/** The mark a lost boss fight records, or null once the count has reached the reminder. */
export function bossLossMark(seen: readonly string[]): TutorialMark | null {
    return BOSS_LOSS_MARKS.find(m => !seen.includes(m)) ?? null
}

/**
 * The tutorial due now, or null. The intro first, on a new run; then the open features one at a
 * time, in the order they opened, each finished only once its scene is explained (the user's call:
 * Collections never comes before the Gacha is done). The first one not explained is explained if
 * its scene is open, and announced otherwise, again until the player goes there, so a reload or a
 * second tab between the two can't let the next one jump the queue. An announcement waits for the
 * battle: it never cuts into a scene the player is still in, so a feature that opens with another
 * comes up once the player leaves the first (the user's call).
 */
export function nextTutorial(unlocked: readonly HqFeature[], seen: readonly string[], scene: string): TutorialId | null {
    const had = new Set(seen)
    if (!had.has('intro')) return 'intro'
    // once, on the battle after the second boss lost, and only once the scenes it names are explained
    if (scene === 'battle' && had.has('boss_lost_2') && !had.has('loss_reminder')
        && had.has('gacha:visit') && had.has('collections:visit')) return 'loss_reminder'
    const f = unlocked.find(u => !had.has(`${u}:visit`))
    if (!f) return null
    if (scene === f) return `${f}:visit`
    return scene === 'battle' ? `${f}:unlock` : null
}

/**
 * Whether two checkpoints open as one group. A boss fought and the same boss beaten are one: the
 * Shop, which takes the win, comes out after the Gacha and Collections when one fight opens all three.
 */
function sameCheckpoint(a: FeatureCheckpoint, b: FeatureCheckpoint): boolean {
    const group = (c: FeatureCheckpoint) => c.kind === 'boss_beaten' ? { kind: 'boss', world: c.world } : c
    return JSON.stringify(group(a)) === JSON.stringify(group(b))
}

/**
 * The open features the menu shows while tutorials are on. Features that open at the same
 * checkpoint come out one at a time (the user's call): of the group still being introduced, only
 * the one whose tutorial is on screen shows, and the rest wait their turn. Every other open feature
 * shows, so resetting the tutorials hides at most the group being walked through again.
 */
export function revealedFeatures(unlocked: readonly HqFeature[], seen: readonly string[], scene: string): HqFeature[] {
    const had = new Set(seen)
    const f = unlocked.find(u => !had.has(`${u}:visit`))
    if (!f) return [...unlocked]
    const due = nextTutorial(unlocked, seen, scene)
    const showing = due === `${f}:unlock` || due === `${f}:visit`
    const at = featureCheckpoint(f)
    const start = unlocked.indexOf(f)
    const held = new Set(unlocked.filter((u, i) => i >= start && sameCheckpoint(featureCheckpoint(u), at) && !(u === f && showing)))
    return unlocked.filter(u => !held.has(u))
}
