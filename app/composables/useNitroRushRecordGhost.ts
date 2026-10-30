import { RECORD_GHOST_COLOR } from '~/utils/nitro-rush/config'
import { replayGhost } from '~/utils/nitro-rush/ghost'
import type { GhostFrame, GhostSource } from '~/utils/nitro-rush/types'
import type { NrRecordGhost } from '#server/utils/nitro-rush'
import { isCustomTrackId } from '#shared/utils/nitro-rush/custom'
import { decodeGhost, type Ghost } from '#shared/utils/nitro-rush/ghost'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** What this needs from the engine: a place to hand its ghost to. */
export interface RecordGhostEngine {
    addGhostSource: (src: GhostSource) => () => void
}

/**
 * The course record holder's ghost, raced by everyone but the holder. `load` it for each course
 * and again once a lap may have moved the record. A player's own courses have no record.
 */
export function useNitroRushRecordGhost(opts: { engine: () => RecordGhostEngine | null, show: Ref<boolean> }) {
    const frame: GhostFrame = { id: 'record', pose: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, color: RECORD_GHOST_COLOR }
    let current: { ghost: Ghost, standing: boolean, closed: boolean } | null = null
    let unregister: (() => void) | null = null
    let request = 0

    const source: GhostSource = (_now, lapTime) => {
        if (!opts.show.value || !current || lapTime === null) return []
        replayGhost(current.ghost, current.standing, current.closed, lapTime, frame.pose)
        return [frame]
    }

    async function load(def: TrackDef) {
        const r = ++request
        unregister ??= opts.engine()?.addGhostSource(source) ?? null
        if (isCustomTrackId(def.id)) {
            current = null
            return
        }
        try {
            const { record } = await apiFetch<{ record: NrRecordGhost | null }>('/api/nitro-rush/record-ghost', { query: { track: def.id } })
            if (r !== request) return
            const ghost = record && decodeGhost(record.ghost)
            current = ghost ? { ghost, standing: record.standing, closed: def.closed !== false } : null
            if (record) frame.label = `RECORD · ${record.name}`
        } catch {
            // No record ghost for now; the next course or lap asks again.
            if (r === request) current = null
        }
    }

    onBeforeUnmount(() => {
        unregister?.()
        unregister = null
    })

    return { load }
}
