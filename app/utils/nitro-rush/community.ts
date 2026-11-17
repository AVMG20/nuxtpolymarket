import type { CustomTrackEntry } from './types'
import { readStorage, STORAGE_KEYS, writeStorage } from './storage'
import type { NrPublishedTrack, NrTrackVotes, NrVote } from '#server/utils/nitro-rush-tracks'
import type { NrTrackSummary } from '#server/utils/nitro-rush'
import { byPlays, NO_PLAYS, PLAY_WINDOW_DAYS, type TrackPlays } from '#shared/utils/nitro-rush/popularity'
import { isSectionId, sameRoad, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** A published course as one to drive or build, under `id`. */
export function publishedCourse(p: NrPublishedTrack, id = p.id): CustomTrack {
    const track: CustomTrack = { id, name: p.name, closed: p.closed, sections: p.sections }
    if (p.branches?.length) track.branches = p.branches
    if (p.fields?.length) track.fields = p.fields
    return track
}

/** Whether this version of the game knows every section of a published course, which it needs to drive it. */
export const knowsSections = (p: NrPublishedTrack) => p.sections.every(isSectionId) && (p.branches ?? []).every(b => b.sections.every(isSectionId))

/**
 * The My Tracks list: each course in this browser with its published or unpublished copy, then the player's
 * published courses with no copy here (published from another device, or deleted here).
 */
export function ownTrackEntries(
    local: CustomTrack[],
    mine: NrPublishedTrack[],
    hiddenTracks: NrPublishedTrack[],
    compileLocal: (t: CustomTrack) => TrackDef | null,
    compilePublished: (t: NrPublishedTrack) => TrackDef | null
): CustomTrackEntry[] {
    const here = local.map((track): CustomTrackEntry => {
        const def = compileLocal(track)
        const published = mine.find(p => p.sourceId === track.id) ?? null
        // Matched by road like the server's restore, so a renamed or rebuilt copy finds it too.
        const hidden = !published && def ? hiddenTracks.find(h => sameRoad(publishedCourse(h, track.id), track)) ?? null : null
        const same = !!published && sameRoad(publishedCourse(published, track.id), track)
        const renamed = !!published && published.name !== track.name.trim()
        const change = !def ? null : hidden ? 'restore' : !published ? 'new' : !same ? 'replace' : renamed ? 'rename' : null
        return { track, def, published, hidden, change, playId: same ? published!.id : track.id }
    })
    const elsewhere = mine.filter(p => !local.some(t => t.id === p.sourceId)).flatMap((published): CustomTrackEntry[] => {
        const def = compilePublished(published)
        if (!def) return []
        const track = publishedCourse(published, published.sourceId)
        return [{ track, def, published, hidden: null, change: null, playId: published.id }]
    })
    return [...here, ...elsewhere]
}

/** A course list's own order (newest first, or by series), or ranked by votes or by how much it is raced. */
export type TrackSort = 'listed' | 'top' | 'popular'
export const TRACK_SORTS: readonly TrackSort[] = ['listed', 'top', 'popular']

/** The lists that each remember their own sort. */
export type SortedList = 'builtIn' | 'community'

/** The sort this browser last picked for `list`; anything stale or unknown opens in the list's own order. */
export function rememberedSort(list: SortedList): TrackSort {
    const stored = readStorage<Partial<Record<SortedList, unknown>>>(STORAGE_KEYS.sort, {})[list]
    return TRACK_SORTS.find(s => s === stored) ?? 'listed'
}

export function rememberSort(list: SortedList, sort: TrackSort) {
    writeStorage(STORAGE_KEYS.sort, { ...readStorage(STORAGE_KEYS.sort, {}), [list]: sort })
}

/** Net votes, which the chips show and TOP sorts by. */
export const voteScore = (v: NrTrackVotes) => v.up - v.down

export const voteCounts = (v: NrTrackVotes) => `${v.up} up · ${v.down} down`

export const NO_VOTES: NrTrackVotes = { up: 0, down: 0, myVote: 0 }

/** `votes` with the viewer's vote changed to `value`, as the server will count it. */
export function withVote(votes: NrTrackVotes, value: NrVote): NrTrackVotes {
    const was = votes.myVote
    return {
        up: votes.up - (was === 1 ? 1 : 0) + (value === 1 ? 1 : 0),
        down: votes.down - (was === -1 ? 1 : 0) + (value === -1 ? 1 : 0),
        myVote: value
    }
}

export const playCounts = (p: TrackPlays) => `${p.laps} ${p.laps === 1 ? 'lap' : 'laps'} · ${p.racers} ${p.racers === 1 ? 'racer' : 'racers'} in the last ${PLAY_WINDOW_DAYS} days`

/** What the menu knows of each course, by id. */
export interface TrackStats {
    votes: Record<string, NrTrackVotes>
    summaries: Record<string, NrTrackSummary>
}

/** The list in the chosen order; the sort is stable, so ties keep the list's own order. */
export function sortTracks<T>(entries: T[], sort: TrackSort, idOf: (e: T) => string, stats: TrackStats): T[] {
    if (sort === 'listed') return entries
    const votes = (e: T) => voteScore(stats.votes[idOf(e)] ?? NO_VOTES)
    const plays = (e: T) => stats.summaries[idOf(e)]?.plays ?? NO_PLAYS
    return [...entries].sort(sort === 'top' ? (a, b) => votes(b) - votes(a) : (a, b) => byPlays(plays(a), plays(b)))
}
