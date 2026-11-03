/**
 * Rail Tycoon world storage: a world row's gzipped parts in, a live RtWorld out, and
 * revision-guarded checkpoints back.
 *
 * A world is stored as parts (save.ts encodeWorldParts): the row's save holds the entity part and
 * rail_tycoon_chunks one row per 16x16-tile chunk with its hash, so a checkpoint rewrites only the
 * chunks that changed. A row without chunks holds a whole-world save from before parts; it loads
 * as one, and its next checkpoint writes it as parts.
 *
 * Every export carries the rt prefix, because Nitro auto-imports server/utils recursively.
 * The stored bytes are untrusted: compressed parts over RT_MAX_SAVE_BYTES together are never
 * fetched, gunzip stops at RT_GUNZIP_MAX_BYTES (zip-bomb guard) for the parts together, and the
 * decoder refuses anything malformed.
 */
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { railTycoonChunks, railTycoonMembers, railTycoonWorlds } from '#server/database/schema'
import { RT_GUNZIP_MAX_BYTES, RT_MAX_SAVE_BYTES } from '#shared/utils/rail-tycoon/limits'
import { decodeWorldOrThrow, decodeWorldPartsOrThrow, RT_SAVE_MAGIC, rtPartHash, type RtWorldParts } from '#shared/utils/rail-tycoon/save'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import type { RtWorldStatus } from './registry'

const rtGunzip = promisify(gunzip)
const rtGzip = promisify(gzip)

/** Longest decoder message a failed load logs; the messages carry counts and ids, never save bytes. */
const RT_LOAD_LOG_REASON_CHARS = 200

/** A world row's metadata with its decoded world, as rtLoadWorld returns it. */
export interface RtLoadedWorld {
    id: string
    ownerId: string
    status: RtWorldStatus
    /** The revision rtSaveCheckpoint must be handed as expectedRevision for the next checkpoint. */
    revision: number
    lastActiveAt: Date
    /** Shown to the owner and every player of a live room. */
    inviteCode: string
    world: RtWorld
}

type RtSaveOutcome = { ok: true, world: RtWorld } | { ok: false, reason: string }

function rtLoadFailureReason(stage: string, error: unknown): string {
    if (!(error instanceof Error)) return `${stage}: non-error thrown`
    const code = (error as NodeJS.ErrnoException).code
    const message = `${typeof code === 'string' ? code : error.name}: ${error.message}`
    return `${stage}: ${message.slice(0, RT_LOAD_LOG_REASON_CHARS)}`
}

function rtStartsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
    return magic.every((byte, k) => bytes[k] === byte)
}

/**
 * The world in stored parts: the row's save first, then the chunks in order. Gunzip runs off the
 * event loop with its output capped by what the parts before it left of RT_GUNZIP_MAX_BYTES, so a
 * bomb fails with ERR_BUFFER_TOO_LARGE instead of allocating; any decode failure, including an
 * unexpected non-RtBadData error, is a failed load rather than a thrown one. A save with the
 * whole-world magic and no chunks loads as a whole world.
 */
async function rtWorldFromParts(stored: readonly Uint8Array[]): Promise<RtSaveOutcome> {
    const raw: Uint8Array[] = []
    let left = RT_GUNZIP_MAX_BYTES
    try {
        for (const part of stored) {
            const bytes = await rtGunzip(part, { maxOutputLength: Math.max(1, left) })
            left -= bytes.length
            raw.push(bytes)
        }
    } catch (error) {
        return { ok: false, reason: rtLoadFailureReason('gunzip', error) }
    }
    try {
        if (raw.length === 1 && rtStartsWith(raw[0]!, RT_SAVE_MAGIC)) return { ok: true, world: decodeWorldOrThrow(raw[0]!) }
        return { ok: true, world: decodeWorldPartsOrThrow(raw) }
    } catch (error) {
        return { ok: false, reason: rtLoadFailureReason('decode', error) }
    }
}

/** Compressed bytes of a world's stored parts, its save and every chunk. */
const rtStoredBytes = sql<number>`octet_length(${railTycoonWorlds.save}) + (select coalesce(sum(octet_length(rt_sized.data)), 0) from rail_tycoon_chunks as rt_sized where rt_sized.world_id = ${railTycoonWorlds.id})`.mapWith(Number)

/**
 * Brings a persisted world back into memory with the row metadata a room needs, or null when the
 * row is missing or its parts do not load. Parts that do not load are logged once at error
 * level with the world id and the reason, never the bytes. The row is read with its total stored
 * size first, so the bytes of an oversized world never leave the database; the save and the chunks
 * are then read in one statement, so they are one checkpoint's parts and the revision returned is
 * the one they were written at.
 */
export async function rtLoadWorld(id: string, exec: DbExecutor = db): Promise<RtLoadedWorld | null> {
    const [row] = await exec.select({
        id: railTycoonWorlds.id,
        ownerId: railTycoonWorlds.ownerId,
        status: railTycoonWorlds.status,
        revision: railTycoonWorlds.revision,
        lastActiveAt: railTycoonWorlds.lastActiveAt,
        inviteCode: railTycoonWorlds.inviteCode,
        storedBytes: rtStoredBytes
    })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.id, id))
    if (!row) return null

    let outcome: RtSaveOutcome
    if (row.storedBytes > RT_MAX_SAVE_BYTES) {
        outcome = { ok: false, reason: `compressed world is ${row.storedBytes} bytes, over the ${RT_MAX_SAVE_BYTES} cap` }
    } else {
        // one statement: a checkpoint committing in between cannot pair one revision's save with another's chunks
        const result = await exec.execute<{ revision: number, data: Uint8Array }>(sql`
            select ${railTycoonWorlds.revision} as revision, ${railTycoonWorlds.save} as data, -1 as chunk_id
            from ${railTycoonWorlds} where ${railTycoonWorlds.id} = ${id}
            union all
            select null, ${railTycoonChunks.data}, ${railTycoonChunks.chunkId}
            from ${railTycoonChunks} where ${railTycoonChunks.worldId} = ${id}
            order by chunk_id`)
        const rows = result.rows
        if (rows.length === 0) return null
        row.revision = Number(rows[0]!.revision)
        outcome = await rtWorldFromParts(rows.map(part => part.data))
    }
    if (!outcome.ok) {
        console.error(`[rail-tycoon] world ${JSON.stringify(row.id)} save does not load (${outcome.reason})`)
        return null
    }

    return {
        id: row.id,
        ownerId: row.ownerId,
        status: row.status,
        revision: row.revision,
        lastActiveAt: row.lastActiveAt,
        inviteCode: row.inviteCode,
        world: outcome.world
    }
}

/** What a checkpoint may do beyond writing the save. */
export interface RtCheckpointOptions {
    /** The caller's transaction, already holding the world row FOR UPDATE; every statement runs on it. */
    tx?: DbExecutor
    /** A member row (a live join's company) written in the same transaction as the save. */
    member?: { userId: string, companyId: number }
}

/** A world's parts gzipped for storage: the entity part for the row's save, then each chunk with its hash. */
export interface RtStoredParts {
    save: Buffer
    chunks: { hash: string, data: Buffer }[]
    /** Compressed bytes of the save and every chunk together. */
    bytes: number
}

/**
 * Gzips every part off the event loop. A world over RT_MAX_SAVE_BYTES compressed is 413, so parts
 * rtLoadWorld would refuse are never stored.
 */
export async function rtCompressParts(parts: RtWorldParts): Promise<RtStoredParts> {
    const zipped = await Promise.all(parts.map(part => rtGzip(part)))
    const bytes = zipped.reduce((sum, part) => sum + part.length, 0)
    if (bytes > RT_MAX_SAVE_BYTES) {
        throw createError({ statusCode: 413, statusMessage: `World save is ${bytes} bytes compressed, over the ${RT_MAX_SAVE_BYTES} cap` })
    }
    return {
        save: zipped[0]!,
        chunks: zipped.slice(1).map((data, k) => ({ hash: rtPartHash(parts[k + 1]!), data })),
        bytes
    }
}

/**
 * Writes the chunks whose stored hash differs (or that are not stored yet) and drops any past the
 * map's last chunk. Runs on the caller's transaction, which holds the world row.
 */
export async function rtWriteChunks(exec: DbExecutor, worldId: string, chunks: RtStoredParts['chunks']): Promise<number> {
    const stored = await exec.select({ chunkId: railTycoonChunks.chunkId, hash: railTycoonChunks.hash })
        .from(railTycoonChunks)
        .where(eq(railTycoonChunks.worldId, worldId))
        .orderBy(asc(railTycoonChunks.chunkId))
    const known = new Map(stored.map(row => [row.chunkId, row.hash]))
    const changed = chunks.flatMap((chunk, chunkId) => known.get(chunkId) === chunk.hash ? [] : [{ worldId, chunkId, hash: chunk.hash, data: chunk.data }])
    if (changed.length > 0) {
        await exec.insert(railTycoonChunks).values(changed).onConflictDoUpdate({
            target: [railTycoonChunks.worldId, railTycoonChunks.chunkId],
            set: { hash: sql`excluded.hash`, data: sql`excluded.data` }
        })
    }
    if (stored.length > chunks.length) {
        await exec.delete(railTycoonChunks).where(and(eq(railTycoonChunks.worldId, worldId), gte(railTycoonChunks.chunkId, chunks.length)))
    }
    return changed.length
}

/** The checkpoint's statements, all on `exec`: lock, compare the revision, write, then the member row. */
async function rtWriteCheckpoint(
    exec: DbExecutor,
    id: string,
    stored: RtStoredParts,
    tick: number,
    expectedRevision: number,
    now: Date,
    member: RtCheckpointOptions['member']
): Promise<number> {
    // A re-lock inside a caller's transaction that already holds the row is a no-op.
    const [locked] = await exec.select({ revision: railTycoonWorlds.revision })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.id, id))
        .for('update')
    if (!locked) throw createError({ statusCode: 404, statusMessage: 'World not found' })
    if (locked.revision !== expectedRevision) throw createError({ statusCode: 409, statusMessage: 'World was saved by another writer' })

    // The integer revision in the WHERE backs the lock; never a timestamp.
    const [saved] = await exec.update(railTycoonWorlds)
        .set({ revision: expectedRevision + 1, save: stored.save, bytes: stored.bytes, tick, savedAt: now, lastActiveAt: now })
        .where(and(eq(railTycoonWorlds.id, id), eq(railTycoonWorlds.revision, expectedRevision)))
        .returning({ revision: railTycoonWorlds.revision })
    if (!saved) throw createError({ statusCode: 409, statusMessage: 'World was saved by another writer' })
    await rtWriteChunks(exec, id, stored.chunks)

    if (member) await exec.insert(railTycoonMembers).values({ worldId: id, userId: member.userId, companyId: member.companyId })
    return saved.revision
}

/**
 * Writes a checkpoint of world `id` and returns its new revision. `parts` is the world encoded
 * synchronously at a tick boundary (encodeWorldParts) and must not be reused while this runs; it is
 * gzipped off the event loop before any lock is taken. The row is locked FOR UPDATE and its
 * integer revision must equal `expectedRevision`, or this throws 409; a missing world is 404 and
 * parts over RT_MAX_SAVE_BYTES compressed are 413, so a world rtLoadWorld would refuse is never
 * stored. Only the chunks whose hash changed are rewritten. `now` is the server clock and becomes
 * savedAt and lastActiveAt.
 *
 * With options.tx every statement runs on the caller's transaction (which should already hold the
 * world row lock); without it the save opens its own. options.member is inserted in that same
 * transaction, so a failed insert rolls the save back (with options.tx, by aborting the caller's).
 */
export async function rtSaveCheckpoint(
    id: string,
    parts: RtWorldParts,
    tick: number,
    expectedRevision: number,
    now: Date,
    options: RtCheckpointOptions = {}
): Promise<number> {
    const stored = await rtCompressParts(parts)
    const write = (exec: DbExecutor) => rtWriteCheckpoint(exec, id, stored, tick, expectedRevision, now, options.member)
    return options.tx ? write(options.tx) : db.transaction(write)
}
