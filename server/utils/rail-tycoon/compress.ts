/**
 * Rail Tycoon parts compressed for storage, off the event loop. Kept apart from store.ts so the room
 * can make them for its pre-write checks without importing the database; the store writes the same
 * buffers, so a checkpoint is compressed once. Exports carry the rt prefix (Nitro auto-import).
 */
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { rtPartHash, type RtWorldParts } from '#shared/utils/rail-tycoon/save'

const rtGzip = promisify(gzip)

/** A world's parts gzipped for storage: the entity part for the row's save, then each chunk with its hash. */
export interface RtStoredParts {
    save: Buffer
    chunks: { hash: string, data: Buffer }[]
    /** Compressed bytes of the save and every chunk together. */
    bytes: number
}

/** Gzips every part; the size cap is the caller's to apply. */
export async function rtGzipParts(parts: RtWorldParts): Promise<RtStoredParts> {
    const zipped = await Promise.all(parts.map(part => rtGzip(part)))
    return {
        save: zipped[0]!,
        chunks: zipped.slice(1).map((data, k) => ({ hash: rtPartHash(parts[k + 1]!), data })),
        bytes: zipped.reduce((sum, part) => sum + part.length, 0)
    }
}
