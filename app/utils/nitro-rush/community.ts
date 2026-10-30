import type { CustomTrackEntry } from './types'
import type { NrPublishedTrack } from '#server/utils/nitro-rush-tracks'
import { sameRoad, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/**
 * The My Tracks list: each course in this browser with its published copy, then the player's
 * published courses with no copy here (published from another device, or deleted here).
 */
export function ownTrackEntries(
    local: CustomTrack[],
    mine: NrPublishedTrack[],
    compileLocal: (t: CustomTrack) => TrackDef | null,
    compilePublished: (t: NrPublishedTrack) => TrackDef | null
): CustomTrackEntry[] {
    const here = local.map((track): CustomTrackEntry => {
        const def = compileLocal(track)
        const published = mine.find(p => p.sourceId === track.id) ?? null
        const same = !!published && sameRoad({ ...published, id: track.id }, track)
        const renamed = !!published && published.name !== track.name.trim()
        const change = !def ? null : !published ? 'new' : !same ? 'replace' : renamed ? 'rename' : null
        return { track, def, published, change, playId: same ? published!.id : track.id }
    })
    const elsewhere = mine.filter(p => !local.some(t => t.id === p.sourceId)).flatMap((published): CustomTrackEntry[] => {
        const def = compilePublished(published)
        if (!def) return []
        const track: CustomTrack = { id: published.sourceId, name: published.name, closed: published.closed, sections: published.sections }
        return [{ track, def, published, change: null, playId: published.id }]
    })
    return [...here, ...elsewhere]
}
