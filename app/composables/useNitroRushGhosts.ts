import type { Ref } from 'vue'
import { keptGhost, withGhost } from '~/utils/nitro-rush/record'
import type { TrackRecord } from '~/utils/nitro-rush/types'
import type { NrGhost } from '#server/utils/nitro-rush'
import { isCustomTrackId } from '#shared/utils/nitro-rush/custom'
import { replacesGhost } from '#shared/utils/nitro-rush/ghost'

/**
 * Keeps each course's ghost on the server as well as in this browser, so it follows the player to
 * any device: whichever of the two the keep rule prefers wins. A player's unpublished courses stay in this browser.
 */
export function useNitroRushGhosts(records: Ref<Record<string, TrackRecord>>, onServerGhost: (trackId: string) => void) {
    async function loadGhost(trackId: string) {
        if (isCustomTrackId(trackId)) return
        let server: NrGhost | null
        try {
            server = (await apiFetch<{ ghost: NrGhost | null }>('/api/nitro-rush/ghost', { query: { track: trackId } })).ghost
        } catch {
            // This browser's ghost still races.
            return
        }
        const local = records.value[trackId]
        if (server && replacesGhost(keptGhost(local), { time: server.ghost.end, standing: server.standing })) {
            records.value = { ...records.value, [trackId]: withGhost(local, server.ghost, server.standing) }
            onServerGhost(trackId)
        } else if (local?.ghost && (!server || replacesGhost({ end: server.ghost.end, standing: server.standing }, { time: local.ghost.end, standing: !!local.ghostStanding }))) {
            // Driven here before ghosts were kept on the server, or while it was out of reach.
            submitGhost(trackId, local)
        }
    }

    async function submitGhost(trackId: string, r: TrackRecord) {
        if (isCustomTrackId(trackId) || !r.ghost) return
        try {
            await apiPost('/api/nitro-rush/ghost', { trackId, ghost: r.ghost, standing: !!r.ghostStanding })
        } catch {
            // Kept in this browser; the next visit to the course sends it again.
        }
    }

    return { loadGhost, submitGhost }
}
