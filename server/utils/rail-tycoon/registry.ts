/**
 * Rail Tycoon world registry: the chooser's data and the owner's controls.
 *
 * Every export carries the rt prefix, because Nitro auto-imports server/utils
 * recursively. Each function takes the authenticated user id from its caller,
 * never from client input. The hub calls these from inside its per-world
 * serialization; value-changing ones are still race-safe on their own.
 */
import { timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { railTycoonMembers, railTycoonWorlds, user } from '#server/database/schema'
import { clampUtf8 } from '#shared/utils/rail-tycoon/bytes'
import {
    isRtInviteCode,
    RT_INVITE_CODE_ALPHABET,
    RT_INVITE_CODE_LENGTH,
    RT_MAX_OPEN_WORLDS,
    RT_MAX_WORLDS_PER_OWNER
} from '#shared/utils/rail-tycoon/limits'
import { RT_MAP_SIDES } from '#shared/utils/rail-tycoon/map'
import { RT_PROTOCOL_BOUNDS } from '#shared/utils/rail-tycoon/protocol'
import { encodeWorldParts } from '#shared/utils/rail-tycoon/save'
import type { RtWorldSettings } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { randomInt } from '#shared/utils/random'
import { rtCompressParts, rtLoadWorld, rtSaveCheckpoint, rtWriteChunks } from './store'

export type RtWorldStatus = typeof railTycoonWorlds.$inferSelect['status']

/** The chooser shows at most this many worlds, most recently active first. */
const RT_LIST_LIMIT = 50

/** A world row without its save, which can run to megabytes. */
const RT_WORLD_META = {
    id: railTycoonWorlds.id,
    ownerId: railTycoonWorlds.ownerId,
    name: railTycoonWorlds.name,
    status: railTycoonWorlds.status,
    inviteCode: railTycoonWorlds.inviteCode,
    side: railTycoonWorlds.side,
    maxCompanies: railTycoonWorlds.maxCompanies,
    revision: railTycoonWorlds.revision,
    bytes: railTycoonWorlds.bytes,
    tick: railTycoonWorlds.tick,
    savedAt: railTycoonWorlds.savedAt,
    lastActiveAt: railTycoonWorlds.lastActiveAt,
    createdAt: railTycoonWorlds.createdAt
}

export interface RtWorldListing {
    id: string
    name: string
    status: RtWorldStatus
    ownerId: string
    isOwner: boolean
    memberCount: number
    maxCompanies: number | null
    /** The caller's company in this world, or null when the caller owns it without a company. */
    myCompanyId: number | null
    lastActiveAt: Date
    /** Every member sees the code, so any member can invite. */
    inviteCode: string
    isPublic: boolean
}

/** The member count subquery of a world list, by the world row's id. */
const rtMemberCount = sql<number>`(select count(*) from rail_tycoon_members as rt_counted where rt_counted.world_id = ${railTycoonWorlds.id})`.mapWith(Number)

/** Worlds the user owns or has joined, most recently active first, at most 50. */
export async function rtListWorldsForUser(userId: string): Promise<RtWorldListing[]> {
    const rows = await db.select({
        id: railTycoonWorlds.id,
        name: railTycoonWorlds.name,
        status: railTycoonWorlds.status,
        ownerId: railTycoonWorlds.ownerId,
        maxCompanies: railTycoonWorlds.maxCompanies,
        lastActiveAt: railTycoonWorlds.lastActiveAt,
        inviteCode: railTycoonWorlds.inviteCode,
        isPublic: railTycoonWorlds.isPublic,
        myCompanyId: railTycoonMembers.companyId,
        memberCount: rtMemberCount
    })
        .from(railTycoonWorlds)
        .leftJoin(railTycoonMembers, and(eq(railTycoonMembers.worldId, railTycoonWorlds.id), eq(railTycoonMembers.userId, userId)))
        .where(or(eq(railTycoonWorlds.ownerId, userId), isNotNull(railTycoonMembers.userId)))
        .orderBy(desc(railTycoonWorlds.lastActiveAt), asc(railTycoonWorlds.id))
        .limit(RT_LIST_LIMIT)

    return rows.map(row => ({ ...row, isOwner: row.ownerId === userId }))
}

/** One row of the public lobby; the invite code is listed, since a public world is open to anyone. */
export interface RtPublicWorld {
    id: string
    name: string
    ownerName: string
    memberCount: number
    maxCompanies: number | null
    lastActiveAt: Date
    inviteCode: string
    avatar: string | null
}

/** Open public worlds the user neither owns nor has joined, most recently active first, at most 50. */
export async function rtListPublicWorlds(userId: string): Promise<RtPublicWorld[]> {
    return db.select({
        id: railTycoonWorlds.id,
        name: railTycoonWorlds.name,
        ownerName: user.name,
        memberCount: rtMemberCount,
        maxCompanies: railTycoonWorlds.maxCompanies,
        lastActiveAt: railTycoonWorlds.lastActiveAt,
        inviteCode: railTycoonWorlds.inviteCode,
        avatar: railTycoonWorlds.avatar
    })
        .from(railTycoonWorlds)
        .innerJoin(user, eq(user.id, railTycoonWorlds.ownerId))
        .leftJoin(railTycoonMembers, and(eq(railTycoonMembers.worldId, railTycoonWorlds.id), eq(railTycoonMembers.userId, userId)))
        .where(and(
            eq(railTycoonWorlds.isPublic, true),
            eq(railTycoonWorlds.status, 'open'),
            ne(railTycoonWorlds.ownerId, userId),
            isNull(railTycoonMembers.userId)
        ))
        .orderBy(desc(railTycoonWorlds.lastActiveAt), asc(railTycoonWorlds.id))
        .limit(RT_LIST_LIMIT)
}

/** The avatars of the worlds the user owns or has joined, by world id; a world without one is left out. */
export async function rtWorldAvatars(userId: string): Promise<Record<string, string>> {
    const rows = await db.select({ id: railTycoonWorlds.id, avatar: railTycoonWorlds.avatar })
        .from(railTycoonWorlds)
        .leftJoin(railTycoonMembers, and(eq(railTycoonMembers.worldId, railTycoonWorlds.id), eq(railTycoonMembers.userId, userId)))
        .where(and(
            or(eq(railTycoonWorlds.ownerId, userId), isNotNull(railTycoonMembers.userId)),
            isNotNull(railTycoonWorlds.avatar)
        ))
        .orderBy(desc(railTycoonWorlds.lastActiveAt), asc(railTycoonWorlds.id))
        .limit(RT_LIST_LIMIT)
    const avatars: Record<string, string> = {}
    for (const row of rows) if (row.avatar !== null) avatars[row.id] = row.avatar
    return avatars
}

export interface RtWorldLook {
    /** Listed in the public lobby while open. */
    isPublic?: boolean
    /** A serialized emblem, or null to clear it. The caller has checked it with serializeEmblem. */
    avatar?: string | null
}

/**
 * The owner's lobby setting and drawing. The owner check is in the update's WHERE, so there is no
 * read before the write; a world that is not the user's is 403 and a missing one 404.
 */
export async function rtSetWorldLook(userId: string, worldId: string, look: RtWorldLook): Promise<{ isPublic: boolean, avatar: string | null }> {
    const set: RtWorldLook = {}
    if (look.isPublic !== undefined) set.isPublic = look.isPublic
    if (look.avatar !== undefined) set.avatar = look.avatar
    if (Object.keys(set).length === 0) rtBadRequest('Nothing to change')
    const [updated] = await db.update(railTycoonWorlds)
        .set(set)
        .where(and(eq(railTycoonWorlds.id, worldId), eq(railTycoonWorlds.ownerId, userId)))
        .returning({ isPublic: railTycoonWorlds.isPublic, avatar: railTycoonWorlds.avatar })
    if (updated) return updated
    return rtRefuseOwnerWrite(db, userId, worldId, 'World not found')
}

/** Characters of a world id: 130 bits from lowercase Crockford base32, under the wire's 32-byte cap. */
const RT_WORLD_ID_LENGTH = 26
const RT_WORLD_ID_ALPHABET = RT_INVITE_CODE_ALPHABET.toLowerCase()

/** UTF-16 units of a raw name looked at before trimming; bounds the work a hostile string costs. */
const RT_NAME_INPUT_UNITS = 256

/** First key of the two-key advisory lock that serializes one owner's creates; app-unique ('RTWC'). */
const RT_CREATE_LOCK_SPACE = 0x52545743

// C0 and C1 controls, and lone surrogates: the wire refuses both in a world name
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const RT_CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/
const RT_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function rtBadRequest(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message })
}

/** `length` symbols of `alphabet`, each drawn with the site's CSPRNG. */
function rtRandomCode(alphabet: string, length: number): string {
    let code = ''
    for (let i = 0; i < length; i++) code += alphabet[randomInt(0, alphabet.length - 1)]
    return code
}

/**
 * The world name as stored: trimmed, 1 to nameBytes of UTF-8, no control characters and no lone
 * surrogates, so every stored name is one the wire carries. Anything else is a 400.
 */
function rtCleanWorldName(name: unknown): string {
    const tooLong = `World name must be 1 to ${RT_PROTOCOL_BOUNDS.nameBytes} bytes`
    if (typeof name !== 'string' || name.length > RT_NAME_INPUT_UNITS) rtBadRequest(tooLong)
    const trimmed = name.trim()
    if (trimmed === '' || clampUtf8(trimmed, RT_PROTOCOL_BOUNDS.nameBytes) !== trimmed) rtBadRequest(tooLong)
    if (RT_CONTROL_CHAR.test(trimmed) || RT_LONE_SURROGATE.test(trimmed)) rtBadRequest('World name holds a character it may not')
    return trimmed
}

export interface RtCreateOptions {
    /** Map side in tiles: 64, 128 or 256. */
    side: number
    /** 2 to 8. */
    maxCompanies: number
    /** Infrastructure sharing; true when left out. */
    sharing?: boolean
    /** Listed in the public lobby; false when left out. */
    isPublic?: boolean
}

/** The new world's settings from the caller's options, each checked here rather than trusted; else 400. */
function rtCreateSettings(options: unknown): RtWorldSettings {
    if (typeof options !== 'object' || options === null) rtBadRequest('World options are missing')
    const { side, maxCompanies, sharing } = options as Record<string, unknown>
    if (typeof side !== 'number' || !RT_MAP_SIDES.includes(side)) rtBadRequest('Map side must be 64, 128 or 256')
    const { minCompanies, companies } = RT_PROTOCOL_BOUNDS
    if (typeof maxCompanies !== 'number' || !Number.isInteger(maxCompanies) || maxCompanies < minCompanies || maxCompanies > companies) {
        rtBadRequest(`Max companies must be ${minCompanies} to ${companies}`)
    }
    if (sharing !== undefined && typeof sharing !== 'boolean') rtBadRequest('Sharing must be on or off')
    return { side, maxCompanies, sharing: sharing ?? true }
}

/** How many worlds the user owns: open ones, and all of them. */
async function rtOwnerWorldCounts(exec: DbExecutor, userId: string): Promise<{ open: number, total: number }> {
    const [row] = await exec.select({
        open: sql<number>`count(*) filter (where ${railTycoonWorlds.status} = 'open')`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number)
    })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.ownerId, userId))
    return row ?? { open: 0, total: 0 }
}

function rtRefuseAtCap(counts: { open: number, total: number }): void {
    if (counts.open >= RT_MAX_OPEN_WORLDS) {
        throw createError({ statusCode: 409, statusMessage: `You already have ${RT_MAX_OPEN_WORLDS} open worlds; stop one first` })
    }
    if (counts.total >= RT_MAX_WORLDS_PER_OWNER) {
        throw createError({ statusCode: 409, statusMessage: `You already have ${RT_MAX_WORLDS_PER_OWNER} worlds; delete one first` })
    }
}

export interface RtCreatedWorld {
    worldId: string
    /** Shown to the owner and every member, so any member can invite. */
    inviteCode: string
}

/**
 * Starts a new world from the chooser: the owner gets company 0, named after them. The name and
 * every option are checked here (400), since the hub passes what the client sent. A plain count
 * refuses an owner at the cap before the world is generated; the authority is the count
 * repeated under a per-owner advisory lock in the transaction that inserts, so of parallel creates
 * at the last free slot exactly one gets through and the rest get 409.
 */
export async function rtCreateWorld(userId: string, userName: string, name: string, options: RtCreateOptions): Promise<RtCreatedWorld> {
    const worldName = rtCleanWorldName(name)
    const settings = rtCreateSettings(options)
    const isPublic = options.isPublic ?? false
    if (typeof isPublic !== 'boolean') rtBadRequest('Public must be on or off')
    rtRefuseAtCap(await rtOwnerWorldCounts(db, userId))

    // the layout seed is site infrastructure, so it comes from the site's CSPRNG
    const world = RtWorld.create(generateWorld(randomInt(0, 0xffffffff), { side: settings.side }), settings)
    const companyId = world.addCompany(userName)
    if (companyId === null) throw createError({ statusCode: 500, statusMessage: 'A new world refused its owner' })
    const stored = await rtCompressParts(encodeWorldParts(world))

    const worldId = rtRandomCode(RT_WORLD_ID_ALPHABET, RT_WORLD_ID_LENGTH)
    // unique by the column's constraint; at 80 bits a clash is a failed create, not a retry
    const inviteCode = rtRandomCode(RT_INVITE_CODE_ALPHABET, RT_INVITE_CODE_LENGTH)
    const now = new Date()

    await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${RT_CREATE_LOCK_SPACE}::int, hashtext(${userId}))`)
        rtRefuseAtCap(await rtOwnerWorldCounts(tx, userId))
        await tx.insert(railTycoonWorlds).values({
            id: worldId,
            ownerId: userId,
            name: worldName,
            status: 'open',
            inviteCode,
            side: settings.side,
            maxCompanies: settings.maxCompanies,
            isPublic,
            revision: 0,
            save: stored.save,
            bytes: stored.bytes,
            tick: world.tick,
            savedAt: now,
            lastActiveAt: now
        })
        await rtWriteChunks(tx, worldId, stored.chunks)
        await tx.insert(railTycoonMembers).values({ worldId, userId, companyId })
    })
    return { worldId, inviteCode }
}

export interface RtJoinedWorld {
    worldId: string
    companyId: number
    /** False when the user was a member already and nothing changed. */
    joined: boolean
}

/**
 * Joins the world behind an invite code as a new company, while no room is live for it (the hub
 * routes a live world's join to RtRoom.join). Lock-then-read: the world row is locked FOR
 * UPDATE before anything is read, so parallel joins queue and each sees the save the one before it
 * wrote. An existing member gets their membership back unchanged; a closed or full world is 409, an
 * unknown code 404 and a malformed one 400. The member row's company is exactly the id addCompany
 * returned, and it commits with the save in the locked transaction.
 */
export async function rtJoinWorld(userId: string, userName: string, inviteCode: string): Promise<RtJoinedWorld> {
    if (!isRtInviteCode(inviteCode)) rtBadRequest('That is not an invite code')

    return db.transaction(async (tx) => {
        const [world] = await tx.select({
            id: railTycoonWorlds.id,
            status: railTycoonWorlds.status,
            maxCompanies: railTycoonWorlds.maxCompanies
        })
            .from(railTycoonWorlds)
            .where(eq(railTycoonWorlds.inviteCode, inviteCode))
            .for('update')
        if (!world) throw createError({ statusCode: 404, statusMessage: 'No world has that invite code' })

        const [member] = await tx.select({ companyId: railTycoonMembers.companyId })
            .from(railTycoonMembers)
            .where(and(eq(railTycoonMembers.worldId, world.id), eq(railTycoonMembers.userId, userId)))
        if (member) return { worldId: world.id, companyId: member.companyId, joined: false }
        if (world.status !== 'open') throw createError({ statusCode: 409, statusMessage: 'World is closed' })

        // every member runs a company, so this many members is a full world without decoding it
        const [{ members } = { members: 0 }] = await tx.select({ members: sql<number>`count(*)`.mapWith(Number) })
            .from(railTycoonMembers)
            .where(eq(railTycoonMembers.worldId, world.id))
        if (world.maxCompanies !== null && members >= world.maxCompanies) throw createError({ statusCode: 409, statusMessage: 'World is full' })

        const loaded = await rtLoadWorld(world.id, tx)
        if (!loaded) throw createError({ statusCode: 500, statusMessage: 'World save does not load' })
        const companyId = loaded.world.addCompany(userName)
        if (companyId === null) throw createError({ statusCode: 409, statusMessage: 'World is full' })

        await rtSaveCheckpoint(world.id, encodeWorldParts(loaded.world), loaded.world.tick, loaded.revision, new Date(), {
            tx,
            member: { userId, companyId }
        })
        return { worldId: world.id, companyId, joined: true }
    })
}

/** Why an owner-only write matched no row: 404 when the world is gone, 403 when it is not the user's. */
async function rtRefuseOwnerWrite(exec: DbExecutor, userId: string, worldId: string, conflict: string): Promise<never> {
    const [world] = await exec.select({ ownerId: railTycoonWorlds.ownerId })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.id, worldId))
    if (!world) throw createError({ statusCode: 404, statusMessage: 'World not found' })
    if (world.ownerId !== userId) throw createError({ statusCode: 403, statusMessage: 'Only the owner can do that' })
    throw createError({ statusCode: 409, statusMessage: conflict })
}

/**
 * The owner's stop button: the world becomes read-only and spectatable. The
 * conditional update is the guard, so of two parallel closes one gets 409.
 */
export async function rtCloseWorld(userId: string, worldId: string, exec: DbExecutor = db) {
    const [closed] = await exec.update(railTycoonWorlds)
        .set({ status: 'closed' })
        .where(and(
            eq(railTycoonWorlds.id, worldId),
            eq(railTycoonWorlds.ownerId, userId),
            eq(railTycoonWorlds.status, 'open')
        ))
        .returning(RT_WORLD_META)
    if (closed) return closed
    return rtRefuseOwnerWrite(exec, userId, worldId, 'World is already closed')
}

/**
 * Removes a world for good; its members go with it through the foreign key.
 * The hub unloads a live room only after this returns a row.
 */
export async function rtDeleteWorld(userId: string, worldId: string, exec: DbExecutor = db) {
    const [deleted] = await exec.delete(railTycoonWorlds)
        .where(and(eq(railTycoonWorlds.id, worldId), eq(railTycoonWorlds.ownerId, userId)))
        .returning(RT_WORLD_META)
    if (deleted) return deleted
    // Gone between the delete and the read: a parallel delete won, so this one finds nothing.
    return rtRefuseOwnerWrite(exec, userId, worldId, 'World not found')
}

export type RtAccess =
    | { role: 'player', status: 'open', companyId: number }
    | { role: 'spectator', status: RtWorldStatus, companyId: null }
    | { role: 'none', status: null, companyId: null }

const RT_NO_ACCESS: RtAccess = { role: 'none', status: null, companyId: null }

function rtInviteMatches(presented: string | undefined, actual: string): boolean {
    if (!isRtInviteCode(presented) || presented.length !== actual.length) return false
    return timingSafeEqual(Buffer.from(presented), Buffer.from(actual))
}

/**
 * Who may open a world and as what: a member of an open world plays
 * their company; the owner, a member of a closed world, or anyone presenting
 * the world's invite code watches; everyone else gets none. A missing world is
 * none too, with no status, so a stranger learns nothing about it.
 */
export async function rtGetAccess(userId: string, worldId: string, inviteCode?: string): Promise<RtAccess> {
    const [world] = await db.select({
        status: railTycoonWorlds.status,
        ownerId: railTycoonWorlds.ownerId,
        inviteCode: railTycoonWorlds.inviteCode,
        companyId: railTycoonMembers.companyId
    })
        .from(railTycoonWorlds)
        .leftJoin(railTycoonMembers, and(eq(railTycoonMembers.worldId, railTycoonWorlds.id), eq(railTycoonMembers.userId, userId)))
        .where(eq(railTycoonWorlds.id, worldId))
    if (!world) return RT_NO_ACCESS

    if (world.companyId !== null && world.status === 'open') return { role: 'player', status: 'open', companyId: world.companyId }
    if (world.companyId !== null || world.ownerId === userId || rtInviteMatches(inviteCode, world.inviteCode)) {
        return { role: 'spectator', status: world.status, companyId: null }
    }
    return RT_NO_ACCESS
}
