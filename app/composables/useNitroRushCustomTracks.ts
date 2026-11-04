import { compileCustomTrack, sanitizeCustomTrack, type CompiledCustomTrack, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'

/**
 * The player's own Nitro Rush courses, kept in this browser. Tracks are
 * replaced, never mutated, so each one compiles once.
 */
export function useNitroRushCustomTracks() {
    const tracks = ref<CustomTrack[]>([])
    const compiled = new WeakMap<CustomTrack, CompiledCustomTrack>()

    function load() {
        const stored = readStorage<{ tracks: unknown[] }>(STORAGE_KEYS.customTracks, { tracks: [] }).tracks
        tracks.value = (Array.isArray(stored) ? stored : []).map(sanitizeCustomTrack).filter(t => t !== null)
    }

    function persist() {
        writeStorage(STORAGE_KEYS.customTracks, { tracks: tracks.value })
    }

    /** Adds the course, or replaces the one with its id. */
    function save(track: CustomTrack) {
        const i = tracks.value.findIndex(t => t.id === track.id)
        tracks.value = i < 0 ? [...tracks.value, track] : tracks.value.map(t => t.id === track.id ? track : t)
        persist()
    }

    function remove(id: string) {
        tracks.value = tracks.value.filter(t => t.id !== id)
        persist()
    }

    function find(id: string) {
        return tracks.value.find(t => t.id === id) ?? null
    }

    function compile(track: CustomTrack) {
        let c = compiled.get(track)
        if (!c) {
            c = compileCustomTrack(track)
            compiled.set(track, c)
        }
        return c
    }

    /** The drivable course for an id, or null when there's none or it isn't finished. */
    function trackDef(id: string) {
        const t = find(id)
        return t ? compile(t).def : null
    }

    return { tracks, load, save, remove, find, compile, trackDef }
}
