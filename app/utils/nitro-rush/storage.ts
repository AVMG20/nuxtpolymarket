/** What this browser remembers between visits; all of it is a convenience the game can play without. */

export const STORAGE_KEYS = {
    records: 'nitro-rush:records',
    paint: 'nitro-rush:paint',
    audio: 'nitro-rush:audio',
    track: 'nitro-rush:track'
} as const

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
