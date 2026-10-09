/**
 * Milestones (`idea-backlog.md` item 11): rewards for feats, claimed in the Milestones scene.
 *
 * Not a list of milestones. Each kind of feat is a **track** with a formula for its k-th step's
 * target and its k-th step's reward, so a track runs as far as the feat does: Worlds and prestiges
 * never end, a raid's runs as far as its levels, and a collection's ends with the full roster.
 *
 * - **Worlds**: every World cleared, across every run. All four Seal types (the World-clear batch
 *   that used to pay on the super boss).
 * - **Prestige**: every prestige. All four Seal types (the old prestige batch) and Gems.
 * - **Raids**, one track each: every `MILESTONE_RAID_LEVEL_EVERY`th level. That raid's Keys.
 * - **Collections**, one track per gacha: every `MILESTONE_COLLECTION_EVERY` owned, then the full
 *   roster. That gacha's Seals.
 *
 * Each feat only grows, so a step once reached stays reached. Stored as the steps claimed per
 * track (`hq_state.milestones_claimed`); a claim takes every step reached since, at once.
 *
 * Pure, so the scene the client draws and the check the server enforces are one function.
 */

import {
    MILESTONE_COLLECTION_EVERY,
    MILESTONE_COLLECTION_SEALS_BASE,
    MILESTONE_COLLECTION_SEALS_STEP,
    MILESTONE_PRESTIGE_GEMS_BASE,
    MILESTONE_PRESTIGE_GEMS_STEP,
    MILESTONE_PRESTIGE_SEALS_BASE,
    MILESTONE_PRESTIGE_SEALS_STEP,
    MILESTONE_RAID_KEYS_BASE,
    MILESTONE_RAID_KEYS_STEP,
    MILESTONE_RAID_LEVEL_EVERY,
    MILESTONE_WORLD_SEALS_BASE,
    MILESTONE_WORLD_SEALS_PER_RUN,
    WORLD_COUNT
} from './constants'
import { GACHA_SYSTEMS, type GachaSystem } from './gacha'
import { GACHA_CONTENT } from './content/registry'
import { RAIDS, type RaidId } from './content/raids'

export type MilestoneKind = 'worlds' | 'prestige' | 'raid' | 'collection'

/** One currency a step pays. `all_seals` is every Seal type, that many each. */
export type MilestoneReward =
    | { kind: 'all_seals', amount: number }
    | { kind: 'seals', system: GachaSystem, amount: number }
    | { kind: 'gems', amount: number }
    | { kind: 'keys', raid: RaidId, amount: number }

/** Every feat a track counts, as of now. */
export interface MilestoneSnapshot {
    worldsCleared: number
    prestiges: number
    /** Each raid's best level; a raid never entered is 0. */
    raidLevels: Readonly<Partial<Record<RaidId, number>>>
    /** Items owned per gacha. */
    owned: Readonly<Partial<Record<GachaSystem, number>>>
}

export interface MilestoneTrack {
    /** Stable: it keys the stored claims, so it must never change. */
    id: string
    kind: MilestoneKind
    raid: RaidId | null
    system: GachaSystem | null
    /** Step k (from 1) wants `every × k` of the feat… */
    every: number
    /** …up to this, the last step's target; null runs forever. */
    cap: number | null
    progress: (s: MilestoneSnapshot) => number
    /** What step k (from 1) pays. */
    reward: (k: number) => MilestoneReward[]
}

const linear = (base: number, step: number, k: number) => base + step * (k - 1)

export const MILESTONE_TRACKS: readonly MilestoneTrack[] = [
    {
        id: 'milestone_worlds',
        kind: 'worlds',
        raid: null,
        system: null,
        every: 1,
        cap: null,
        progress: s => s.worldsCleared,
        // every World of a run pays alike; each full run before it adds to them all
        reward: k => [{ kind: 'all_seals', amount: MILESTONE_WORLD_SEALS_BASE + MILESTONE_WORLD_SEALS_PER_RUN * Math.floor((k - 1) / WORLD_COUNT) }]
    },
    {
        id: 'milestone_prestige',
        kind: 'prestige',
        raid: null,
        system: null,
        every: 1,
        cap: null,
        progress: s => s.prestiges,
        reward: k => [
            { kind: 'all_seals', amount: linear(MILESTONE_PRESTIGE_SEALS_BASE, MILESTONE_PRESTIGE_SEALS_STEP, k) },
            { kind: 'gems', amount: linear(MILESTONE_PRESTIGE_GEMS_BASE, MILESTONE_PRESTIGE_GEMS_STEP, k) }
        ]
    },
    ...RAIDS.map((raid): MilestoneTrack => ({
        id: `milestone_${raid.id}`,
        kind: 'raid',
        raid: raid.id,
        system: null,
        every: MILESTONE_RAID_LEVEL_EVERY,
        cap: null,
        progress: s => s.raidLevels[raid.id] ?? 0,
        reward: k => [{ kind: 'keys', raid: raid.id, amount: linear(MILESTONE_RAID_KEYS_BASE, MILESTONE_RAID_KEYS_STEP, k) }]
    })),
    ...GACHA_SYSTEMS.map((system): MilestoneTrack => ({
        id: `milestone_collection_${system}`,
        kind: 'collection',
        raid: null,
        system,
        every: MILESTONE_COLLECTION_EVERY,
        cap: GACHA_CONTENT[system].entries.length,
        progress: s => s.owned[system] ?? 0,
        reward: k => [{ kind: 'seals', system, amount: linear(MILESTONE_COLLECTION_SEALS_BASE, MILESTONE_COLLECTION_SEALS_STEP, k) }]
    }))
]

const TRACK_BY_ID = new Map(MILESTONE_TRACKS.map(t => [t.id, t]))

export function getMilestoneTrack(id: string): MilestoneTrack | undefined {
    return TRACK_BY_ID.get(id)
}

/** How many steps the track has; null for one that runs forever. */
export function milestoneSteps(track: MilestoneTrack): number | null {
    return track.cap === null ? null : Math.ceil(track.cap / track.every)
}

/** Step k's target (from 1): `every × k`, the last one the cap. */
export function milestoneTarget(track: MilestoneTrack, k: number): number {
    const target = track.every * k
    return track.cap === null ? target : Math.min(track.cap, target)
}

/** Steps reached at a progress. */
export function milestoneReached(track: MilestoneTrack, progress: number): number {
    const steps = milestoneSteps(track)
    if (steps !== null && track.cap !== null && progress >= track.cap) return steps
    const reached = Math.max(0, Math.floor(progress / track.every))
    return steps === null ? reached : Math.min(steps, reached)
}

/** Rewards summed to one line per currency, in the order each first appears. */
export function mergeMilestoneRewards(rewards: Iterable<MilestoneReward>): MilestoneReward[] {
    const total = new Map<string, MilestoneReward>()
    for (const r of rewards) {
        const key = r.kind === 'seals' ? `seals:${r.system}` : r.kind === 'keys' ? `keys:${r.raid}` : r.kind
        const had = total.get(key)
        total.set(key, had ? { ...had, amount: had.amount + r.amount } : { ...r })
    }
    return [...total.values()]
}

/** What steps `from + 1` to `to` pay together, one line per currency. */
export function milestoneRewardTotal(track: MilestoneTrack, from: number, to: number): MilestoneReward[] {
    const all: MilestoneReward[] = []
    for (let k = from + 1; k <= to; k++) all.push(...track.reward(k))
    return mergeMilestoneRewards(all)
}

/** Worlds cleared across every run: each prestige is a full run of them, plus this run's. */
export function worldsClearedOf(prestige: number, world: number, runCleared: boolean): number {
    return prestige * WORLD_COUNT + (world - 1) + (runCleared ? 1 : 0)
}

/** A track as the scene draws it. */
export interface MilestoneRow {
    id: string
    kind: MilestoneKind
    raid: RaidId | null
    system: GachaSystem | null
    progress: number
    claimed: number
    reached: number
    /** Null for a track that runs forever. */
    steps: number | null
    /** The step after the last claimed: its target and pay; null once every step is claimed. */
    next: { step: number, target: number, reward: MilestoneReward[] } | null
    /** Everything a claim would take now; empty when nothing is waiting. */
    claimable: MilestoneReward[]
}

export function milestoneRows(snapshot: MilestoneSnapshot, claimed: Readonly<Record<string, number>>): MilestoneRow[] {
    return MILESTONE_TRACKS.map((track) => {
        const progress = track.progress(snapshot)
        const reached = milestoneReached(track, progress)
        const steps = milestoneSteps(track)
        // a stored count past the formula (a cap that shrank) reads as every step claimed
        const done = Math.min(claimed[track.id] ?? 0, steps ?? Infinity)
        const step = done + 1
        return {
            id: track.id,
            kind: track.kind,
            raid: track.raid,
            system: track.system,
            progress,
            claimed: done,
            reached,
            steps,
            next: steps !== null && step > steps ? null : { step, target: milestoneTarget(track, step), reward: track.reward(step) },
            claimable: reached > done ? milestoneRewardTotal(track, done, reached) : []
        }
    })
}
