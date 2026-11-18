import { encodeGhost, replacesGhost, type Ghost, type KeptGhost, type StoredGhost } from '#shared/utils/nitro-rush/ghost'
import type { LapEvent } from '#shared/utils/nitro-rush/timing'
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

/** What a finished lap changes; `record` is null when it changes nothing. A lap that couldn't record a ghost keeps the old one, which is still a real lap. */
export function settleLap(rec: TrackRecord, lap: Extract<LapEvent, { type: 'lap' }>, closed: boolean, kept: KeptGhost | null, lapGhost: Ghost | null) {
    const isBest = rec.bestLap === null || lap.time < rec.bestLap
    const standing = closed && lap.lap === 0
    const stored = lapGhost && replacesGhost(kept, { time: lap.time, standing }) ? encodeGhost(lapGhost) : null
    let record: TrackRecord | null = null
    if (isBest || stored) {
        const next: TrackRecord = isBest ? { ...rec, bestLap: lap.time, bestSplits: [...lap.splits, lap.time] } : { ...rec }
        record = stored ? withGhost(next, stored, standing) : next
    }
    return { isBest, record, stored, standing }
}

/**
 * The best lap's time at checkpoint `sector`, when it was that lap's `touched`th checkpoint too; null otherwise, so a lap
 * round the other way or in another order shows no gap. Splits saved before the course had these checkpoints are no use.
 */
export function bestSplit(splits: readonly (number | null)[] | null, count: number, sector: number, touched: number): number | null {
    if (splits?.length !== count + 1) return null
    const best = splits[sector]
    if (best === null || best === undefined) return null
    const order = splits.slice(0, count).filter(t => t !== null && t <= best).length
    return order === touched ? best : null
}

/** The quicker of this browser's best and the server's, which may have been set on another device; in seconds. */
export function bestLap(r: TrackRecord | undefined, s: NrTrackSummary | undefined): number | null {
    const local = r?.bestLap ?? null
    const server = s?.myLapMs ?? null
    if (server === null) return local
    return local === null ? server / 1000 : Math.min(local, server / 1000)
}
