/**
 * Preferred Loadouts (`loadouts.md` §4): each raid, and the Arena for attacking, can point at one
 * saved Loadout slot. A fresh engage snapshots the live loadout and applies the preferred one;
 * retries in the same session change nothing; leaving puts the snapshot back.
 *
 * Every fresh engage opens a session, with a preferred Loadout or without, and the run holds while
 * one is open. It lives on the server (`hq_state.pre_raid_snapshot`), so it survives a reload, and
 * one nobody closed (a tab shut mid-raid) is closed lazily by the next settle once the gap outlasts
 * presence, or by any action that isn't the raid's. Nothing here runs on a timer.
 *
 * Pure: the decision each engage makes is `planLoadoutEngage`, and the server only applies it.
 */

import { RAIDS, type RaidId } from './content/raids'

/** What can point at a Loadout: the five raids, and the Arena's attack (built with the Arena). */
export type LoadoutTarget = RaidId | 'arena'

export const LOADOUT_TARGETS: readonly LoadoutTarget[] = [...RAIDS.map(raid => raid.id), 'arena']

export function isLoadoutTarget(value: unknown): value is LoadoutTarget {
    return typeof value === 'string' && (LOADOUT_TARGETS as readonly string[]).includes(value)
}

/** Target → saved slot index. A target missing has no preferred Loadout. */
export type LoadoutPreferences = Partial<Record<LoadoutTarget, number>>

/** The live components a Loadout holds (`loadouts.md` §1), the Ascendant's picks the sixth (#43). */
export interface LiveLoadoutColumns {
    partyChampionIds: string[]
    formation: Record<string, 'front' | 'back'>
    equippedSkillIds: string[]
    equippedArtifactIds: string[]
    equippedGear: Record<string, string>
    ascendantSkillIds: string[]
}

/**
 * An open raid session: which target opened it and, when that raid applied its preferred
 * Loadout, the slot it applied and the live loadout as it stood before the first engage. A raid
 * with none still opens one, so the run holds there too; it has nothing to put back.
 */
export type LoadoutSession =
    | ({ target: LoadoutTarget, slotIndex: number } & LiveLoadoutColumns)
    | { target: LoadoutTarget, slotIndex: null }

/** What an engage does before its fight runs. */
export type LoadoutEngagePlan =
    /** A retry in the open session: what it applied (or didn't) is still live. */
    | { kind: 'keep' }
    /**
     * Open this target's session, applying `slotIndex` when there is one. A session open for
     * anything else is closed first, its loadout put back, so the snapshot is always the player's own.
     */
    | { kind: 'open', slotIndex: number | null }

/**
 * The decision an engage of `target` makes, given the preferred slot (null when there is none, or
 * when the slot it names holds nothing it could apply) and the open session, if any. A session for
 * this target on this slot (or on none, for none) is a retry: nothing changes. Anything else opens
 * this target's session, over the pre-raid loadout.
 */
export function planLoadoutEngage(
    target: LoadoutTarget,
    preferred: number | null,
    session: { target: LoadoutTarget | null, slotIndex: number | null } | null
): LoadoutEngagePlan {
    // a session whose target no longer reads is never this raid's: it is put back
    if (session && session.target === target && session.slotIndex === preferred) return { kind: 'keep' }
    return { kind: 'open', slotIndex: preferred }
}

/** The live loadout columns off a state row, copied, for a snapshot. */
export function liveLoadoutOf(state: LiveLoadoutColumns): LiveLoadoutColumns {
    return {
        partyChampionIds: [...state.partyChampionIds],
        formation: { ...state.formation },
        equippedSkillIds: [...state.equippedSkillIds],
        equippedArtifactIds: [...state.equippedArtifactIds],
        equippedGear: { ...state.equippedGear },
        ascendantSkillIds: [...state.ascendantSkillIds]
    }
}

/** Open a session for `target`, over the live loadout `before` when it applies `slotIndex`. */
export function openLoadoutSession(target: LoadoutTarget, slotIndex: number | null, before: LiveLoadoutColumns): LoadoutSession {
    return slotIndex === null ? { target, slotIndex: null } : { target, slotIndex, ...liveLoadoutOf(before) }
}

/** The live columns a session puts back when it closes; null for one that applied nothing. */
export function restoredLoadout(session: LoadoutSession): LiveLoadoutColumns | null {
    return session.slotIndex === null ? null : liveLoadoutOf(session)
}

/**
 * A stored snapshot as read. `open` whenever it reads, with its loadout columns (null for a session
 * that applied none) and its target and slot only where they are still valid. A target renamed
 * since, or a slot that no longer reads beside columns, leaves the target null, and the session is
 * then treated as another raid's: closed, never kept. `unreadable` when columns are there but don't
 * read: the player's own loadout can't be recovered from it, so the server refuses rather than
 * overwrite it.
 */
export type StoredLoadoutSnapshot =
    | { kind: 'none' }
    | { kind: 'open', columns: LiveLoadoutColumns | null, target: LoadoutTarget | null, slotIndex: number | null }
    | { kind: 'unreadable' }

const COLUMN_KEYS = ['partyChampionIds', 'formation', 'equippedSkillIds', 'equippedArtifactIds', 'equippedGear', 'ascendantSkillIds'] as const

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string')
const isIdMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string')

export function readLoadoutSnapshot(value: unknown): StoredLoadoutSnapshot {
    if (value === null || value === undefined) return { kind: 'none' }
    if (typeof value !== 'object') return { kind: 'unreadable' }
    const v = value as Partial<Record<keyof LiveLoadoutColumns | 'target' | 'slotIndex', unknown>>
    const target = isLoadoutTarget(v.target) ? v.target : null
    // a session that applied nothing stores no columns
    if (COLUMN_KEYS.every(key => v[key] === undefined)) return { kind: 'open', columns: null, target, slotIndex: null }
    if (!isIdList(v.partyChampionIds) || !isIdList(v.equippedSkillIds) || !isIdList(v.equippedArtifactIds) || !isIdList(v.ascendantSkillIds)) return { kind: 'unreadable' }
    if (!isIdMap(v.equippedGear) || !isIdMap(v.formation) || Object.values(v.formation).some(row => row !== 'front' && row !== 'back')) return { kind: 'unreadable' }
    const slotIndex = typeof v.slotIndex === 'number' && Number.isInteger(v.slotIndex) && v.slotIndex >= 0 ? v.slotIndex : null
    return {
        kind: 'open',
        columns: liveLoadoutOf(v as unknown as LiveLoadoutColumns),
        target: slotIndex === null ? null : target,
        slotIndex
    }
}

/** A stored session with a valid target (and slot, where it applied one), or null for anything else. */
export function loadoutSessionOf(value: unknown): LoadoutSession | null {
    const read = readLoadoutSnapshot(value)
    if (read.kind !== 'open' || read.target === null) return null
    if (read.columns === null) return { target: read.target, slotIndex: null }
    return { target: read.target, slotIndex: read.slotIndex!, ...read.columns }
}

/** The stored preference map, with anything that isn't a target and a whole slot index dropped. */
export function loadoutPreferencesOf(value: unknown): LoadoutPreferences {
    const out: LoadoutPreferences = {}
    if (!value || typeof value !== 'object') return out
    for (const [target, slot] of Object.entries(value as Record<string, unknown>)) {
        if (isLoadoutTarget(target) && typeof slot === 'number' && Number.isInteger(slot) && slot >= 0) out[target] = slot
    }
    return out
}
