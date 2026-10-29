import type { Ref } from 'vue'
import type { TrackRecord } from '~/utils/nitro-rush/types'
import type { NrBoard, NrTrackSummary } from '#server/utils/nitro-rush'
import { isCustomTrackId } from '#shared/utils/nitro-rush/custom'

/**
 * The Nitro Rush leaderboard: the open track's board, a summary per track for the menu, and
 * lap submission. A faster best from another device replaces this browser's record.
 * A player's own courses have no board: their times stay in this browser.
 */
export function useNitroRushBoard(records: Ref<Record<string, TrackRecord>>, onServerBest: (trackId: string) => void) {
    const toast = useToast()
    const board = ref<NrBoard | null>(null)
    const summaries = ref<Record<string, NrTrackSummary>>({})
    let boardTrack = ''
    let boardRequest = 0

    /** A fresher board than the menu summary was built from. */
    function noteBoard(b: NrBoard) {
        const top = b.top[0]
        summaries.value = {
            ...summaries.value,
            [b.trackId]: { trackId: b.trackId, entries: b.entries, record: top ? { name: top.name, lapMs: top.lapMs } : null, myLapMs: b.me?.lapMs ?? null }
        }
    }

    async function loadBoard(trackId: string) {
        const request = ++boardRequest
        boardTrack = trackId
        board.value = null
        if (isCustomTrackId(trackId)) return
        try {
            const b = await apiFetch<NrBoard>('/api/nitro-rush/leaderboard', { query: { track: trackId } })
            if (request !== boardRequest) return
            board.value = b
            noteBoard(b)
            // A best set on another device: race against it, without this browser's splits from a slower lap.
            // Its ghost stays: still a real lap to chase, and it never leaves this browser.
            const server = b.me ? b.me.lapMs / 1000 : null
            const local = records.value[trackId]?.bestLap ?? null
            if (server !== null && (local === null || server < local - 0.0005)) {
                records.value = { ...records.value, [trackId]: { bestLap: server, bestSplits: null, ghost: records.value[trackId]?.ghost } }
                onServerBest(trackId)
            }
        } catch {
            // Only the HUD's rank line goes without it.
        }
    }

    async function loadSummaries() {
        try {
            const list = await apiFetch<NrTrackSummary[]>('/api/nitro-rush/tracks')
            summaries.value = { ...Object.fromEntries(list.map(t => [t.trackId, t])), ...summaries.value }
        } catch {
            // The cards fall back to this browser's own times.
        }
    }

    async function submitLap(trackId: string, seconds: number) {
        if (isCustomTrackId(trackId)) return
        try {
            const res = await apiPost('/api/nitro-rush/lap', { trackId, lapMs: Math.round(seconds * 1000) })
            if (trackId === boardTrack) board.value = res.board
            noteBoard(res.board)
        } catch (e) {
            toast.add({ title: apiErrorMessage(e, 'Your lap could not be saved to the leaderboard'), color: 'warning' })
        }
    }

    return { board, summaries, loadBoard, loadSummaries, submitLap }
}
