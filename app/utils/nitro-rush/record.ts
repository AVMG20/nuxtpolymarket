import type { KeptGhost, StoredGhost } from '#shared/utils/nitro-rush/ghost'
import { EMPTY_RECORD, type TrackRecord } from './types'

/** `r` racing `ghost` from now on; `standing` marks a loop's first lap from the grid. */
export function withGhost(r: TrackRecord | undefined, ghost: StoredGhost, standing: boolean): TrackRecord {
    const { ghostStanding: _, ...rest } = { ...EMPTY_RECORD, ...r }
    return standing ? { ...rest, ghost, ghostStanding: true } : { ...rest, ghost }
}

/** The record's ghost as the keep rule compares it, in milliseconds; null without one. */
export function keptGhost(r: TrackRecord | undefined): KeptGhost | null {
    return r?.ghost ? { end: r.ghost.end, standing: !!r.ghostStanding } : null
}
