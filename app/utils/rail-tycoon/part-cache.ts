// Rail Tycoon — the browser's copy of the worlds it visited.
//
// One IndexedDB record per world: its decoded parts as last built or left. Opening the world offers
// their hashes, and the room sends only the parts that changed since. The hashes are worked out again
// on every read, so a record that was altered or half written offers what it really holds: at worst
// the room sends those parts in full. The newest RT_PART_CACHE_WORLDS worlds are kept. Every failure
// (no IndexedDB, a private window, a full disk) reads as an empty cache.

import { rtPartHash, type RtWorldParts } from '#shared/utils/rail-tycoon/save'
import type { RtLocalParts } from './lockstep'

/** Worlds whose parts stay cached. */
export const RT_PART_CACHE_WORLDS = 6

const DB_NAME = 'rail-tycoon'
const PARTS = 'parts'
const VISITS = 'visits'

/** What an open can offer: the cached hashes by part index, and the parts by hash. */
export interface RtCachedParts {
    have: string[]
    local: RtLocalParts
}

const EMPTY: RtCachedParts = { have: [], local: new Map() }

let opening: Promise<IDBDatabase | null> | null = null

function rtPartDb(): Promise<IDBDatabase | null> {
    opening ??= new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1)
            request.onupgradeneeded = () => {
                request.result.createObjectStore(PARTS)
                request.result.createObjectStore(VISITS)
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve(null)
            request.onblocked = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
    return opening
}

function done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function committed(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
    })
}

/** The parts cached for a world, or none. */
export async function rtCachedParts(worldId: string): Promise<RtCachedParts> {
    try {
        const db = await rtPartDb()
        if (!db) return EMPTY
        const stored: unknown = await done(db.transaction(PARTS).objectStore(PARTS).get(worldId))
        if (!Array.isArray(stored) || !stored.every(part => part instanceof Uint8Array)) return EMPTY
        const have: string[] = []
        const local = new Map<string, Uint8Array>()
        for (const part of stored as Uint8Array[]) {
            const hash = rtPartHash(part)
            have.push(hash)
            local.set(hash, part)
        }
        return { have, local }
    } catch {
        return EMPTY
    }
}

/** Caches a world's parts and forgets the worlds visited longest ago. */
export async function rtCacheParts(worldId: string, parts: RtWorldParts): Promise<void> {
    try {
        const db = await rtPartDb()
        if (!db) return
        const tx = db.transaction([PARTS, VISITS], 'readwrite')
        const visits = tx.objectStore(VISITS)
        // a view clones its whole buffer, so each part gets one of its own size
        tx.objectStore(PARTS).put(parts.map(part => part.slice()), worldId)
        visits.put(Date.now(), worldId)
        const ids = await done(visits.getAllKeys())
        const times = await done(visits.getAll())
        const old = ids
            .map((id, i) => ({ id, at: Number(times[i]) }))
            .sort((a, b) => b.at - a.at)
            .slice(RT_PART_CACHE_WORLDS)
        for (const { id } of old) {
            tx.objectStore(PARTS).delete(id)
            visits.delete(id)
        }
        await committed(tx)
    } catch {
        // a cache that cannot be written only costs the next open some bytes
    }
}

/** Drops a world's cached parts (it was deleted). */
export async function rtForgetParts(worldId: string): Promise<void> {
    try {
        const db = await rtPartDb()
        if (!db) return
        const tx = db.transaction([PARTS, VISITS], 'readwrite')
        tx.objectStore(PARTS).delete(worldId)
        tx.objectStore(VISITS).delete(worldId)
        await committed(tx)
    } catch {
        // nothing to forget
    }
}
