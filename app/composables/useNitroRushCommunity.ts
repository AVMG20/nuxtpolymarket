import { ownTrackEntries } from '~/utils/nitro-rush/community'
import type { CommunityTrackEntry } from '~/utils/nitro-rush/types'
import type { NrPublishedTrack } from '#server/utils/nitro-rush-tracks'
import type { NrTrackSummary } from '#server/utils/nitro-rush'
import { compileCustomTrack, isSectionId, type CompiledCustomTrack, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** What this needs of the player's own courses. */
export interface OwnTracks {
    tracks: Ref<CustomTrack[]>
    compile: (t: CustomTrack) => CompiledCustomTrack
}

/**
 * Published courses: everyone else's on the community list, and the player's own published copies,
 * which `entries` pairs with their courses in this browser for the My Tracks tab.
 */
export function useNitroRushCommunity(own: OwnTracks, onSummaries: (list: NrTrackSummary[]) => void) {
    const toast = useToast()
    const community = ref<NrPublishedTrack[]>([])
    const mine = ref<NrPublishedTrack[]>([])
    /** The course being published or taken down, by its local id. */
    const busy = ref<string | null>(null)
    // A published id never changes road, so each compiles once.
    const defs = new Map<string, TrackDef | null>()

    function compile(t: NrPublishedTrack): TrackDef | null {
        let def = defs.get(t.id)
        if (def === undefined) {
            // Sections this version of the game doesn't know yet can't be driven.
            def = t.sections.every(isSectionId) ? compileCustomTrack({ id: t.id, name: t.name, closed: t.closed, sections: t.sections }).def : null
        } else if (def && def.name !== t.name) {
            // Renamed: same road, same id.
            def = { ...def, name: t.name }
        }
        defs.set(t.id, def)
        return def
    }

    const communityEntries = computed<CommunityTrackEntry[]>(() => community.value.flatMap((track) => {
        const def = compile(track)
        return def ? [{ track, def }] : []
    }))

    const entries = computed(() => ownTrackEntries(own.tracks.value, mine.value, t => own.compile(t).def, compile))

    async function load() {
        try {
            const res = await apiFetch<{ community: NrPublishedTrack[], mine: NrPublishedTrack[] }>('/api/nitro-rush/published')
            community.value = res.community
            mine.value = res.mine
            onSummaries([...res.community, ...res.mine].map(t => t.summary))
        } catch {
            // The menu shows what it had, and only the player's own courses on first load.
        }
    }

    /** The published course with this id, drivable; a name in it may be another player's. */
    function trackDef(id: string): TrackDef | null {
        const t = mine.value.find(p => p.id === id) ?? community.value.find(p => p.id === id)
        return t ? compile(t) : null
    }

    /** Publishes or updates the course; answers with its published id, or null when it failed. */
    async function publish(track: CustomTrack): Promise<string | null> {
        if (busy.value) return null
        busy.value = track.id
        try {
            const { id } = await apiPost('/api/nitro-rush/publish', { track })
            await load()
            return id
        } catch (e) {
            toast.add({ title: apiErrorMessage(e, 'The track could not be published'), color: 'warning' })
            return null
        } finally {
            busy.value = null
        }
    }

    async function unpublish(sourceId: string): Promise<boolean> {
        if (busy.value) return false
        busy.value = sourceId
        try {
            await apiPost('/api/nitro-rush/unpublish', { sourceId })
            await load()
            return true
        } catch (e) {
            toast.add({ title: apiErrorMessage(e, 'The track could not be taken down'), color: 'warning' })
            return false
        } finally {
            busy.value = null
        }
    }

    return { communityEntries, entries, busy, load, trackDef, publish, unpublish }
}
