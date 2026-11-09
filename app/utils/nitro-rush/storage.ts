/** What this browser remembers between visits; all of it is a convenience the game can play without. */

export const STORAGE_KEYS = {
    records: 'nitro-rush:records-2',
    paint: 'nitro-rush:paint',
    car: 'nitro-rush:car',
    audio: 'nitro-rush:audio',
    ghost: 'nitro-rush:ghost',
    track: 'nitro-rush:track',
    customTracks: 'nitro-rush:custom-tracks',
    builderView: 'nitro-rush:builder-view'
} as const

// Bests and ghosts from before a board wipe: kept, they'd block slower new laps from counting and re-upload the old ghost.
const RETIRED_KEYS = ['nitro-rush:records']

export function clearRetiredStorage() {
    try {
        for (const key of RETIRED_KEYS) localStorage.removeItem(key)
    } catch {
        // Blocked storage has nothing to clear.
    }
}

export function readStorage<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
        return fallback
    }
}

export function writeStorage(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Private mode or blocked storage: the game still plays, it just forgets.
    }
}
