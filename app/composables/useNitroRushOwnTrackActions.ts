import type { Ref } from 'vue'
import type { CustomTrackEntry, TrackRecord } from '~/utils/nitro-rush/types'
import type { CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'
import type { NrGhost } from '#server/utils/nitro-rush'

/** What the track actions need from the game. */
export interface OwnTrackActionDeps {
    ownEntry: (sourceId: string) => CustomTrackEntry | undefined
    publishTrack: (track: CustomTrack, lap: NrGhost | null) => Promise<string | null>
    unpublishTrack: (sourceId: string) => Promise<boolean>
    removeTrack: (id: string) => void
    records: Ref<Record<string, TrackRecord>>
    forgetRecord: (id: string) => void
    trackId: Ref<string>
    resolveTrack: (id: string) => TrackDef | null
    loadTrack: (def: TrackDef) => void
    click: () => void
}

/** Publishing, taking down and deleting the player's courses, keeping the engine on a course that still exists. */
export function useNitroRushOwnTrackActions(deps: OwnTrackActionDeps) {
    const { ownEntry, records, trackId, forgetRecord, resolveTrack, loadTrack } = deps

    /** Publishes the course, or updates its published copy; a changed road starts a fresh board under a new id. */
    async function publish(sourceId: string) {
        const entry = ownEntry(sourceId)
        if (!entry) return
        deps.click()
        const old = entry.published?.id
        // The lap set on this road here: a changed road wipes it, so it can't be one from before the edit.
        const r = records.value[sourceId]
        const id = await deps.publishTrack(entry.track, r?.ghost ? { ghost: r.ghost, standing: !!r.ghostStanding } : null)
        if (!id) return
        if (old && old !== id) forgetRecord(old)
        // On the engine under its old id, or as the local course that now has a board: drive the published copy.
        if (trackId.value === old || trackId.value === sourceId) loadTrack(resolveTrack(id) ?? entry.def ?? TRACKS[0]!)
    }

    /** Answers with the published id it took down, leaving what the engine drives next to the caller. */
    async function takeDown(sourceId: string) {
        const old = ownEntry(sourceId)?.published?.id
        if (!old || !(await deps.unpublishTrack(sourceId))) return null
        forgetRecord(old)
        return old
    }

    async function unpublish(sourceId: string) {
        deps.click()
        const old = await takeDown(sourceId)
        if (old && trackId.value === old) loadTrack(resolveTrack(sourceId) ?? TRACKS[0]!)
    }

    /** Drops the copy in this browser; `publishedId` is the course's other name on the engine, if it's just gone too. */
    function removeLocal(id: string, publishedId?: string) {
        deps.removeTrack(id)
        forgetRecord(id)
        if (trackId.value === id || trackId.value === publishedId) loadTrack(TRACKS[0]!)
    }

    /** Deletes the course outright: a published copy left up would keep it on the list. */
    async function deleteTrack(sourceId: string) {
        deps.click()
        const published = !!ownEntry(sourceId)?.published
        const old = published ? await takeDown(sourceId) : null
        if (published && !old) return
        removeLocal(sourceId, old ?? undefined)
    }

    return { publish, unpublish, removeLocal, deleteTrack }
}
