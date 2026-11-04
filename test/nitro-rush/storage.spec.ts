import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearRetiredStorage, readStorage, STORAGE_KEYS, writeStorage } from '../../app/utils/nitro-rush/storage'

function stubStorage() {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    })
    return items
}

describe('clearRetiredStorage', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('forgets records from before the board wipe', () => {
        const items = stubStorage()
        items.set('nitro-rush:records', JSON.stringify({ oval: { bestLap: 20.156 } }))
        clearRetiredStorage()
        expect(items.has('nitro-rush:records')).toBe(false)
        expect(readStorage(STORAGE_KEYS.records, {})).toEqual({})
    })

    it('keeps laps driven since, and the player\'s courses', () => {
        const items = stubStorage()
        writeStorage(STORAGE_KEYS.records, { oval: { bestLap: 23 } })
        writeStorage(STORAGE_KEYS.customTracks, { tracks: [] })
        clearRetiredStorage()
        expect(readStorage(STORAGE_KEYS.records, {})).toEqual({ oval: { bestLap: 23 } })
        expect(items.has(STORAGE_KEYS.customTracks)).toBe(true)
    })

    it('survives blocked storage', () => {
        vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('blocked') } })
        expect(() => clearRetiredStorage()).not.toThrow()
    })
})
