/**
 * Preferred Loadouts (`loadouts.md` §4): each raid, and the Arena for attacking, can point at one
 * saved Loadout slot. A fresh engage snapshots the live loadout and applies the preferred one;
 * retries in the same session change nothing; leaving puts the snapshot back.
 *
 * The session lives on the server (`hq_state.pre_raid_snapshot`), so it survives a reload, and a
 * session nobody closed (a tab shut mid-raid) is closed lazily by the next read or action that
 * isn't the raid's. Nothing here runs on a timer.
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
 * An open session: the live loadout as it stood before the first engage, which target opened it,
 * and the slot it applied. Never written into a saved slot.
 */
export interface LoadoutSession extends LiveLoadoutColumns {
    target: LoadoutTarget
    slotIndex: number
}

/** What an engage does to the live loadout before its fight runs. */
export type LoadoutEngagePlan =
    /** No preferred Loadout and no session: the fight runs on what is live. */
    | { kind: 'none' }
    /** A retry in the open session: the preferred Loadout is already live. */
    | { kind: 'keep' }
    /** Snapshot what is live (or keep the session's snapshot, after putting it back) and apply the slot. */
    | { kind: 'apply', slotIndex: number, restoreFirst: boolean }
    /** A session left open for another target (or a preference since removed): put the snapshot back. */
    | { kind: 'restore' }

/**
 * The decision an engage of `target` makes, given the preferred slot (null when there is none, or
 * when the slot it names holds nothing it could apply) and the open session, if any.
 *
 * - A session for this target on this slot is a retry: nothing changes.
 * - A session for anything else is one the player left: its snapshot goes back first, and the
 *   snapshot stays the pre-raid state, never another raid's Loadout.
 * - Then the preferred slot, if there is one, is applied.
 */
export function planLoadoutEngage(
    target: LoadoutTarget,
    preferred: number | null,
    session: { target: LoadoutTarget | null, slotIndex: number | null } | null
): LoadoutEngagePlan {
    // a session whose target or slot no longer reads is never this raid's: it is put back
    if (session && preferred !== null && session.target === target && session.slotIndex === preferred) return { kind: 'keep' }
    if (preferred !== null) return { kind: 'apply', slotIndex: preferred, restoreFirst: session !== null }
    return session ? { kind: 'restore' } : { kind: 'none' }
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

/** Open a session for `target` on `slotIndex` over the live loadout `before`. */
export function openLoadoutSession(target: LoadoutTarget, slotIndex: number, before: LiveLoadoutColumns): LoadoutSession {
    return { target, slotIndex, ...liveLoadoutOf(before) }
}

/** The live columns a session puts back when it closes. */
export function restoredLoadout(session: LoadoutSession): LiveLoadoutColumns {
    return liveLoadoutOf(session)
}

/**
 * A stored snapshot as read. `open` whenever its six loadout columns read, which is all a revert
 * needs, with its target and slot only where they are still valid (a target renamed since reads as
 * null, and is then treated as another raid's session). `unreadable` when the columns themselves
 * don't: the player's own loadout can't be recovered from it, so the server refuses rather than
 * overwrite it.
 */
export type StoredLoadoutSnapshot =
    | { kind: 'none' }
    | { kind: 'open', columns: LiveLoadoutColumns, target: LoadoutTarget | null, slotIndex: number | null }
    | { kind: 'unreadable' }

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string')
const isIdMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string')

export function readLoadoutSnapshot(value: unknown): StoredLoadoutSnapshot {
    if (value === null || value === undefined) return { kind: 'none' }
    if (typeof value !== 'object') return { kind: 'unreadable' }
    const v = value as Partial<Record<keyof LoadoutSession, unknown>>
    if (!isIdList(v.partyChampionIds) || !isIdList(v.equippedSkillIds) || !isIdList(v.equippedArtifactIds) || !isIdList(v.ascendantSkillIds)) return { kind: 'unreadable' }
    if (!isIdMap(v.equippedGear) || !isIdMap(v.formation) || Object.values(v.formation).some(row => row !== 'front' && row !== 'back')) return { kind: 'unreadable' }
    return {
        kind: 'open',
        columns: liveLoadoutOf(v as unknown as LiveLoadoutColumns),
        target: isLoadoutTarget(v.target) ? v.target : null,
        slotIndex: typeof v.slotIndex === 'number' && Number.isInteger(v.slotIndex) && v.slotIndex >= 0 ? v.slotIndex : null
    }
}

/** A stored session with a valid target and slot, or null for anything else (none stored, or one that doesn't read whole). */
export function loadoutSessionOf(value: unknown): LoadoutSession | null {
    const read = readLoadoutSnapshot(value)
    if (read.kind !== 'open' || read.target === null || read.slotIndex === null) return null
    return { target: read.target, slotIndex: read.slotIndex, ...read.columns }
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

/**
 * Whether a session left open should be closed by a read: one the player can't still be in,
 * because the gap since their last settle is long enough to have ended their game session
 * (`HQ_SESSION_TIMEOUT_MS`, passed in). A read inside that gap leaves it to the client, which
 * closes it the moment it shows anything but the raid.
 */
export function loadoutSessionStale(lastSettledAt: number, now: number, timeoutMs: number): boolean {
    return now - lastSettledAt > timeoutMs
}
