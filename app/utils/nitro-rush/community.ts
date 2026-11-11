import type { CustomTrackEntry } from './types'
import type { NrPublishedTrack, NrTrackVotes } from '#server/utils/nitro-rush-tracks'
import { isSectionId, sameRoad, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** A published course as one to drive or build, under `id`. */
export function publishedCourse(p: NrPublishedTrack, id = p.id): CustomTrack {
    const track: CustomTrack = { id, name: p.name, closed: p.closed, sections: p.sections }
    if (p.branches?.length) track.branches = p.branches
    return track
}

/** Whether this version of the game knows every section of a published course, which it needs to drive it. */
export const knowsSections = (p: NrPublishedTrack) => p.sections.every(isSectionId) && (p.branches ?? []).every(b => b.sections.every(isSectionId))

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
        const same = !!published && sameRoad(publishedCourse(published, track.id), track)
        const renamed = !!published && published.name !== track.name.trim()
        const change = !def ? null : !published ? 'new' : !same ? 'replace' : renamed ? 'rename' : null
        return { track, def, published, change, playId: same ? published!.id : track.id }
    })
    const elsewhere = mine.filter(p => !local.some(t => t.id === p.sourceId)).flatMap((published): CustomTrackEntry[] => {
        const def = compilePublished(published)
        if (!def) return []
        const track = publishedCourse(published, published.sourceId)
        return [{ track, def, published, change: null, playId: published.id }]
    })
    return [...here, ...elsewhere]
}

export type CommunitySort = 'newest' | 'popular'

/** Net votes, which the chips show and Popular sorts by. */
export const voteScore = (v: NrTrackVotes) => v.up - v.down
export const trackScore = (t: NrPublishedTrack) => voteScore(t.votes)

export const voteCounts = (v: NrTrackVotes) => `${v.up} up · ${v.down} down`

/** The community list in the chosen order; it comes newest first and the sort is stable, so ties stay newest first. */
export function sortCommunity<T extends { track: NrPublishedTrack }>(entries: T[], sort: CommunitySort): T[] {
    if (sort === 'newest') return entries
    return [...entries].sort((a, b) => trackScore(b.track) - trackScore(a.track))
}
