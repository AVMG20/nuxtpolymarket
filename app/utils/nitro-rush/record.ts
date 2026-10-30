import type { KeptGhost, StoredGhost } from '#shared/utils/nitro-rush/ghost'
import { EMPTY_RECORD, type TrackRecord } from './types'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

/** `r` racing `ghost` from now on; `standing` marks a loop's first lap from the grid. */
export function withGhost(r: TrackRecord | undefined, ghost: StoredGhost, standing: boolean): TrackRecord {
    const { ghostStanding: _, ...rest } = { ...EMPTY_RECORD, ...r }
    return standing ? { ...rest, ghost, ghostStanding: true } : { ...rest, ghost }
}

/** The record's ghost as the keep rule compares it, in milliseconds; null without one. */
export function keptGhost(r: TrackRecord | undefined): KeptGhost | null {
    return r?.ghost ? { end: r.ghost.end, standing: !!r.ghostStanding } : null
}

/** The quicker of this browser's best and the server's, which may have been set on another device; in seconds. */
export function bestLap(r: TrackRecord | undefined, s: NrTrackSummary | undefined): number | null {
    const local = r?.bestLap ?? null
    const server = s?.myLapMs ?? null
    if (server === null) return local
    return local === null ? server / 1000 : Math.min(local, server / 1000)
}
