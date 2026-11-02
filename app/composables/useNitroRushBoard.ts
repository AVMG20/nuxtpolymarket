import type { Ref } from 'vue'
import { BoardCache } from '~/utils/nitro-rush/board'
import type { TrackRecord } from '~/utils/nitro-rush/types'
import type { NrBoard, NrTrackSummary } from '#server/utils/nitro-rush'
import { isCustomTrackId } from '#shared/utils/nitro-rush/custom'

/** A board this recent is shown without asking the server again. */
const BOARD_FRESH_MS = 30_000
/** Waits this long after a selection, so clicking through the cards asks for the last one only. */
const BOARD_DEBOUNCE_MS = 250
/** Boards kept in memory; past this the cache starts over. */
const BOARD_CACHE_LIMIT = 200

/**
 * The Nitro Rush leaderboard: the open track's board, a summary per track for the menu, and
 * lap submission. A faster best from another device replaces this browser's record.
 * A player's unpublished courses have no board: their times stay in this browser.
 */
export function useNitroRushBoard(records: Ref<Record<string, TrackRecord>>, onServerBest: (trackId: string) => void) {
    const toast = useToast()
    const board = ref<NrBoard | null>(null)
    /** True from a selection until its board is in or the request failed. */
    const boardLoading = ref(false)
    const summaries = ref<Record<string, NrTrackSummary>>({})
    let boardTrack = ''
    let boardRequest = 0
    let boardTimer: ReturnType<typeof setTimeout> | undefined
    const cache = new BoardCache(BOARD_CACHE_LIMIT)

    /** A fresher board than the menu summary was built from. */
    function noteBoard(b: NrBoard) {
        const top = b.top[0]
        summaries.value = {
            ...summaries.value,
            [b.trackId]: { trackId: b.trackId, entries: b.entries, record: top ? { name: top.name, lapMs: top.lapMs, mine: top.you } : null, myLapMs: b.me?.lapMs ?? null }
        }
    }

    /** Shows the track's board from the cache at once, and asks for a fresh one once the selection settles. */
    function loadBoard(trackId: string) {
        const request = ++boardRequest
        boardTrack = trackId
        clearTimeout(boardTimer)
        const cached = cache.get(trackId)
        board.value = cached?.board ?? null
        boardLoading.value = false
        if (isCustomTrackId(trackId) || (cached && Date.now() - cached.at < BOARD_FRESH_MS)) return
        boardLoading.value = !cached
        boardTimer = setTimeout(() => fetchBoard(trackId, request), BOARD_DEBOUNCE_MS)
    }

    async function fetchBoard(trackId: string, request: number) {
        const stamp = cache.stamp()
        try {
            const b = await apiFetch<NrBoard>('/api/nitro-rush/leaderboard', { query: { track: trackId } })
            const kept = cache.keep(b, stamp)
            if (request !== boardRequest) return
            // A lap landed while this was in flight: its board stays up and this one is dropped.
            if (!kept) {
                boardLoading.value = false
                return
            }
            board.value = b
            boardLoading.value = false
            noteBoard(b)
            // A best set on another device: race against it, without this browser's splits from a slower lap.
            // Its ghost stays: still a real lap to chase, and it never leaves this browser.
            const server = b.me ? b.me.lapMs / 1000 : null
            const local = records.value[trackId]?.bestLap ?? null
            if (server !== null && (local === null || server < local - 0.0005)) {
                records.value = { ...records.value, [trackId]: { ...records.value[trackId], bestLap: server, bestSplits: null } }
                onServerBest(trackId)
            }
        } catch {
            // Only the HUD's rank line and the menu's top 5 go without it.
            if (request === boardRequest) boardLoading.value = false
        }
    }

    /** Summaries from a menu list; a board loaded since stays, being fresher. */
    function addSummaries(list: NrTrackSummary[]) {
        summaries.value = { ...summaries.value, ...Object.fromEntries(list.filter(t => t.trackId !== boardTrack || !board.value).map(t => [t.trackId, t])) }
    }

    async function loadSummaries() {
        try {
            addSummaries(await apiFetch<NrTrackSummary[]>('/api/nitro-rush/tracks'))
        } catch {
            // The cards fall back to this browser's own times.
        }
    }

    async function submitLap(trackId: string, seconds: number) {
        if (isCustomTrackId(trackId)) return
        try {
            const res = await apiPost('/api/nitro-rush/lap', { trackId, lapMs: Math.round(seconds * 1000) })
            // Stamped on arrival: every fetch started before now may hold the board from before this lap.
            cache.keep(res.board, cache.stamp())
            if (trackId === boardTrack) board.value = res.board
            noteBoard(res.board)
        } catch (e) {
            toast.add({ title: apiErrorMessage(e, 'Your lap could not be saved to the leaderboard'), color: 'warning' })
        }
    }

    onScopeDispose(() => clearTimeout(boardTimer))

    return { board, boardLoading, summaries, loadBoard, loadSummaries, addSummaries, submitLap }
}
