import type { NrBoard, NrBoardRow, NrTrackSummary } from '#server/utils/nitro-rush'
import type { TrackPlays } from '#shared/utils/nitro-rush/popularity'

/** Rows the select screen's top list has room for. */
export const PANEL_TOP = 5

/** The top `n` of a board, and the viewer's own row when it falls below them. */
export function topRows(board: NrBoard, n = PANEL_TOP): { top: NrBoardRow[], own: NrBoardRow | null } {
    const top = board.top.slice(0, n)
    return { top, own: board.me && !top.some(r => r.you) ? board.me : null }
}

/** A track's menu summary from its board, with `plays` from wherever they're freshest. */
export function boardSummary(b: NrBoard, plays: TrackPlays): NrTrackSummary {
    const top = b.top[0]
    return { trackId: b.trackId, entries: b.entries, record: top ? { name: top.name, lapMs: top.lapMs, mine: top.you } : null, myLapMs: b.me?.lapMs ?? null, plays }
}

/** A menu list merged into `current`; `boardTrack`'s loaded board is fresher for the record and times, so only its plays are taken. */
export function mergeSummaries(current: Record<string, NrTrackSummary>, list: NrTrackSummary[], boardTrack: string | null): Record<string, NrTrackSummary> {
    const next = { ...current }
    for (const t of list) {
        const kept = t.trackId === boardTrack ? next[t.trackId] : undefined
        next[t.trackId] = kept ? { ...kept, plays: t.plays } : t
    }
    return next
}

/**
 * Boards by track, each tagged with when its request started. A board from a request that started before the one
 * already kept is older than it (a fetch that resolves after a lap submit), so it's dropped.
 */
export class BoardCache {
    private boards = new Map<string, { board: NrBoard, at: number, stamp: number }>()
    private stamps = 0
    private readonly limit: number

    /** Past `limit` tracks the cache starts over. */
    constructor(limit: number) {
        this.limit = limit
    }

    /** Call as a request starts, or once a response is in when the server's state is known to include it. */
    stamp() {
        return ++this.stamps
    }

    get(trackId: string) {
        return this.boards.get(trackId)
    }

    /** False when a newer board for the track is already kept. */
    keep(board: NrBoard, stamp: number, now = Date.now()): boolean {
        const kept = this.boards.get(board.trackId)
        if (kept && kept.stamp > stamp) return false
        if (!kept && this.boards.size >= this.limit) this.boards.clear()
        this.boards.set(board.trackId, { board, at: now, stamp })
        return true
    }
}
