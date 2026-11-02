/**
 * Rail Tycoon world storage: a world row's gzipped binary save in, a live RtWorld out, and
 * revision-guarded checkpoints back.
 *
 * Every export carries the rt prefix, because Nitro auto-imports server/utils recursively.
 * The stored bytes are untrusted: a compressed save over RT_MAX_SAVE_BYTES is never fetched,
 * gunzip stops at RT_GUNZIP_MAX_BYTES (zip-bomb guard), and the decoder refuses anything malformed.
 */
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { and, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { railTycoonMembers, railTycoonWorlds } from '#server/database/schema'
import { RT_GUNZIP_MAX_BYTES, RT_MAX_SAVE_BYTES } from '#shared/utils/rail-tycoon/limits'
import { decodeWorldOrThrow } from '#shared/utils/rail-tycoon/save'
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

/**
 * The world in a stored save. Gunzip runs off the event loop with its output capped, so a bomb
 * fails with ERR_BUFFER_TOO_LARGE instead of allocating; any decode failure, including an
 * unexpected non-RtBadData error, is a failed load rather than a thrown one.
 */
async function rtWorldFromSave(save: Uint8Array): Promise<RtSaveOutcome> {
    let raw: Uint8Array
    try {
        raw = await rtGunzip(save, { maxOutputLength: RT_GUNZIP_MAX_BYTES })
    } catch (error) {
        return { ok: false, reason: rtLoadFailureReason('gunzip', error) }
    }
    try {
        return { ok: true, world: decodeWorldOrThrow(raw) }
    } catch (error) {
        return { ok: false, reason: rtLoadFailureReason('decode', error) }
    }
}

/**
 * Brings a persisted world back into memory with the row metadata a room needs, or null when the
 * row is missing or its save does not load. A save that does not load is logged once at error
 * level with the world id and the reason, never the bytes. One SELECT reads the metadata and the
 * save together, so the revision returned is the one the decoded save was written at; the bytes
 * of an oversized save never leave the database.
 */
export async function rtLoadWorld(id: string, exec: DbExecutor = db): Promise<RtLoadedWorld | null> {
    const [row] = await exec.select({
        id: railTycoonWorlds.id,
        ownerId: railTycoonWorlds.ownerId,
        status: railTycoonWorlds.status,
        revision: railTycoonWorlds.revision,
        lastActiveAt: railTycoonWorlds.lastActiveAt,
        inviteCode: railTycoonWorlds.inviteCode,
        saveBytes: sql<number>`octet_length(${railTycoonWorlds.save})`.mapWith(Number),
        save: sql<Uint8Array | null>`case when octet_length(${railTycoonWorlds.save}) <= ${RT_MAX_SAVE_BYTES} then ${railTycoonWorlds.save} end`
    })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.id, id))
    if (!row) return null

    const outcome: RtSaveOutcome = row.save
        ? await rtWorldFromSave(row.save)
        : { ok: false, reason: `compressed save is ${row.saveBytes} bytes, over the ${RT_MAX_SAVE_BYTES} cap` }
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

/** The checkpoint's statements, all on `exec`: lock, compare the revision, write, then the member row. */
async function rtWriteCheckpoint(
    exec: DbExecutor,
    id: string,
    save: Buffer,
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
        .set({ revision: expectedRevision + 1, save, bytes: save.length, tick, savedAt: now, lastActiveAt: now })
        .where(and(eq(railTycoonWorlds.id, id), eq(railTycoonWorlds.revision, expectedRevision)))
        .returning({ revision: railTycoonWorlds.revision })
    if (!saved) throw createError({ statusCode: 409, statusMessage: 'World was saved by another writer' })

    if (member) await exec.insert(railTycoonMembers).values({ worldId: id, userId: member.userId, companyId: member.companyId })
    return saved.revision
}

/**
 * Writes a checkpoint of world `id` and returns its new revision. `encodedBytes` is the world
 * encoded synchronously at a tick boundary and must not be reused while this runs; it is
 * gzipped off the event loop before any lock is taken. The row is locked FOR UPDATE and its
 * integer revision must equal `expectedRevision`, or this throws 409; a missing world is 404 and
 * a compressed save over RT_MAX_SAVE_BYTES is 413, so a save rtLoadWorld would refuse is never
 * stored. `now` is the server clock and becomes savedAt and lastActiveAt.
 *
 * With options.tx every statement runs on the caller's transaction (which should already hold the
 * world row lock); without it the save opens its own. options.member is inserted in that same
 * transaction, so a failed insert rolls the save back (with options.tx, by aborting the caller's).
 */
export async function rtSaveCheckpoint(
    id: string,
    encodedBytes: Uint8Array,
    tick: number,
    expectedRevision: number,
    now: Date,
    options: RtCheckpointOptions = {}
): Promise<number> {
    const save = await rtGzip(encodedBytes)
    if (save.length > RT_MAX_SAVE_BYTES) {
        throw createError({ statusCode: 413, statusMessage: `World save is ${save.length} bytes compressed, over the ${RT_MAX_SAVE_BYTES} cap` })
    }

    const write = (exec: DbExecutor) => rtWriteCheckpoint(exec, id, save, tick, expectedRevision, now, options.member)
    return options.tx ? write(options.tx) : db.transaction(write)
}
