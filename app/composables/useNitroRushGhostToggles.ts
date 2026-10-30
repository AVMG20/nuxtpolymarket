import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'
import type { GhostToggles } from '~/utils/nitro-rush/types'

/** Which ghosts race along, remembered in this browser; all of them by default. */
export function useNitroRushGhostToggles() {
    const toggles = ref<GhostToggles>({ best: true, record: true, live: true })

    function load() {
        // `on` is the single switch from before there were three; it meant the best lap.
        const s = readStorage<Partial<GhostToggles> & { on?: boolean }>(STORAGE_KEYS.ghost, {})
        toggles.value = { best: s.best ?? s.on ?? true, record: s.record ?? true, live: s.live ?? true }
    }

    function toggle(kind: keyof GhostToggles) {
        toggles.value = { ...toggles.value, [kind]: !toggles.value[kind] }
        writeStorage(STORAGE_KEYS.ghost, toggles.value)
    }

    return { toggles, load, toggle }
}
