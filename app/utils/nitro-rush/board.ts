import type { NrBoard, NrBoardRow } from '#server/utils/nitro-rush'

/** Rows the select screen's top list has room for. */
export const PANEL_TOP = 5

/** The top `n` of a board, and the viewer's own row when it falls below them. */
export function topRows(board: NrBoard, n = PANEL_TOP): { top: NrBoardRow[], own: NrBoardRow | null } {
    const top = board.top.slice(0, n)
    return { top, own: board.me && !top.some(r => r.you) ? board.me : null }
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
