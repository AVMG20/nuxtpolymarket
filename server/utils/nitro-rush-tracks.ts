import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { nitroRushGhosts, nitroRushLaps, nitroRushPlays, nitroRushTrackVotes, nitroRushTracks, user } from '#server/database/schema'
import { nrTrackSummaries, playedLately, recordNrPlay, validGhost, type NrGhost, type NrTrackSummary } from '#server/utils/nitro-rush'
import { compileCustomTrack, isPublishedTrackId, MAX_CUSTOM_TRACKS, newPublishedTrackId, roadKey, sanitizeCustomTrack, type CustomBranch, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { decodeGhost } from '#shared/utils/nitro-rush/ghost'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

/** Published courses: players' own tracks, raced by everyone on a shared leaderboard. */

/** The newest this many from other players make the community list, along with this many of the best voted and the most played. */
const COMMUNITY_LIMIT = 100
/** Compiled roads kept in memory; past this the cache starts over. */
const DEF_CACHE_LIMIT = 500
/** Longer than any id `newPublishedTrackId` makes. */
const TRACK_ID_MAX = 64
/** Unpublished courses kept per author, boards and all, for publishing the same road to bring back. */
const HIDDEN_LIMIT = MAX_CUSTOM_TRACKS

/** A player's vote on a course: up, down, or none. */
export type NrVote = -1 | 0 | 1

/** A course's votes, and the viewer's own. */
export interface NrTrackVotes {
    up: number
    down: number
    myVote: NrVote
}

export interface NrPublishedTrack {
    id: string
    /** The author's own copy of the course, which their My Tracks tab matches it to. */
    sourceId: string
    name: string
    closed: boolean
    sections: SectionId[]
    /** Null on a course that never forks. */
    branches: CustomBranch[] | null
    author: string
    summary: NrTrackSummary
    votes: NrTrackVotes
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const isLive = isNull(nitroRushTracks.unpublishedAt)
const isHidden = isNotNull(nitroRushTracks.unpublishedAt)

const roadHash = (t: Parameters<typeof roadKey>[0]) => createHash('sha256').update(roadKey(t)).digest('hex')

// A published id never changes road, so its compiled course can be kept.
const defs = new Map<string, TrackDef>()

/** A built-in or published course; null for anything else, a player's private or unpublished course included. */
export async function nrTrackDef(trackId: unknown): Promise<TrackDef | null> {
    if (typeof trackId !== 'string') return null
    const builtIn = findTrack(trackId)
    if (builtIn || !isPublishedTrackId(trackId)) return builtIn
    const [row] = await db.select({ name: nitroRushTracks.name, closed: nitroRushTracks.closed, sections: nitroRushTracks.sections, branches: nitroRushTracks.branches })
        .from(nitroRushTracks).where(and(eq(nitroRushTracks.id, trackId), isLive))
    if (!row) return null
    const cached = defs.get(trackId)
    if (cached) return cached
    const { def } = compileCustomTrack({ id: trackId, ...row, branches: row.branches ?? undefined })
    if (!def) return null
    if (defs.size >= DEF_CACHE_LIMIT) defs.clear()
    defs.set(trackId, def)
    return def
}

// One publish or unpublish per player at a time, so the cap and the one-copy rule hold under a burst.
// No key update, not update: the vote insert's key check takes key share on the same row, and the two must not wait on each other.
async function lockAuthor(tx: Tx, userId: string) {
    await tx.execute(sql`select 1 from "user" where id = ${userId} for no key update`)
}

/** Deletes a published course with every time, ghost, vote and play on it. */
async function removeTrack(tx: Tx, id: string) {
    // The course first: it waits out a vote holding key share on it, so the vote deletes below see that vote too.
    await tx.delete(nitroRushTracks).where(eq(nitroRushTracks.id, id))
    await tx.delete(nitroRushTrackVotes).where(eq(nitroRushTrackVotes.trackId, id))
    await tx.delete(nitroRushPlays).where(eq(nitroRushPlays.trackId, id))
    await tx.delete(nitroRushLaps).where(eq(nitroRushLaps.trackId, id))
    await tx.delete(nitroRushGhosts).where(eq(nitroRushGhosts.trackId, id))
}

/** The builder's ghost when it is a lap really driven on `def`'s road, else null. */
function drivenLap(def: TrackDef, ghost: unknown, standing: unknown): NrGhost | null {
    const road = new Track(def)
    // Not from the min-lap cache: `def` has no published id yet, and a dead key there would crowd out live ones.
    const valid = validGhost(def, ghost, standing, Math.ceil(road.minLapSeconds * 1000))
    const decoded = valid && decodeGhost(valid.ghost)
    return valid && decoded && ghostDrivesTrack(road, decoded) ? { ghost: valid.ghost, standing: valid.standing } : null
}

async function assertUnderCap(tx: Tx, userId: string) {
    const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(nitroRushTracks).where(and(eq(nitroRushTracks.authorId, userId), isLive))
    if ((row?.count ?? 0) >= MAX_CUSTOM_TRACKS) throw createError({ statusCode: 400, statusMessage: `You can publish up to ${MAX_CUSTOM_TRACKS} tracks` })
}

/** Frees a hidden course's source id for a live one; keyed by its own id it can still come back by its road. */
async function detachHidden(tx: Tx, id: string) {
    await tx.update(nitroRushTracks).set({ sourceId: id }).where(eq(nitroRushTracks.id, id))
}

/** Drops the author's oldest unpublished courses past `HIDDEN_LIMIT`. */
async function pruneHidden(tx: Tx, userId: string) {
    const stale = await tx.select({ id: nitroRushTracks.id }).from(nitroRushTracks)
        .where(and(eq(nitroRushTracks.authorId, userId), isHidden))
        .orderBy(desc(nitroRushTracks.unpublishedAt), desc(nitroRushTracks.id))
        .offset(HIDDEN_LIMIT)
    for (const { id } of stale) await removeTrack(tx, id)
}

/**
 * Publishes the player's course, or updates their published copy: a new name keeps its board, a road they
 * unpublished comes back with its board, and a changed road replaces the live copy under a new id, starting
 * from the builder's lap and ghost and keeping its votes and plays. Answers with the published id.
 */
export async function publishNrTrack(userId: string, raw: unknown, lap: { ghost?: unknown, standing?: unknown } = {}): Promise<string> {
    const track = sanitizeCustomTrack(raw)
    const name = track?.name.trim()
    if (!track || !name) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    const { def } = compileCustomTrack(track)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Finish the track before publishing it' })
    const hash = roadHash(track)
    return db.transaction(async (tx) => {
        await lockAuthor(tx, userId)
        // For update, which a vote's key share waits on: no vote lands on the old road while its votes move.
        const [old] = await tx.select().from(nitroRushTracks)
            .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.sourceId, track.id))).for('update')
        const live = old && !old.unpublishedAt ? old : undefined
        if (live && roadHash(live) === hash) {
            await tx.update(nitroRushTracks).set({ name, roadHash: hash }).where(eq(nitroRushTracks.id, live.id))
            return live.id
        }
        if (!live) {
            await assertUnderCap(tx, userId)
            const [hidden] = await tx.select({ id: nitroRushTracks.id }).from(nitroRushTracks)
                .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.roadHash, hash), isHidden))
                .orderBy(desc(nitroRushTracks.unpublishedAt)).limit(1).for('update')
            if (old && old.id !== hidden?.id) await detachHidden(tx, old.id)
            if (hidden) {
                await tx.update(nitroRushTracks).set({ sourceId: track.id, name, unpublishedAt: null }).where(eq(nitroRushTracks.id, hidden.id))
                return hidden.id
            }
        }
        // Only a road new to the board needs a lap; a rename or a restore above keeps the one it has.
        const driven = drivenLap(def, lap.ghost, lap.standing)
        if (!driven) throw createError({ statusCode: 400, statusMessage: 'Drive a lap first' })
        const id = newPublishedTrackId()
        if (live) {
            // Moved off before the old road goes; the old row's lock above keeps any vote from landing in between.
            await tx.update(nitroRushTrackVotes).set({ trackId: id }).where(eq(nitroRushTrackVotes.trackId, live.id))
            await tx.update(nitroRushPlays).set({ trackId: id }).where(eq(nitroRushPlays.trackId, live.id))
            await removeTrack(tx, live.id)
        }
        const now = new Date()
        const lapMs = driven.ghost.end
        await tx.insert(nitroRushTracks).values({ id, authorId: userId, sourceId: track.id, name, closed: track.closed, sections: track.sections, branches: track.branches ?? null, roadHash: hash })
        await recordNrPlay(userId, id, tx)
        await tx.insert(nitroRushLaps).values({ userId, trackId: id, lapMs, setAt: now })
        await tx.insert(nitroRushGhosts).values({ userId, trackId: id, lapMs, standing: driven.standing, ghost: driven.ghost, updatedAt: now })
        return id
    })
}

/** Takes the player's published copy of their course `sourceId` down, keeping its board for the same road to come back to. */
export async function unpublishNrTrack(userId: string, sourceId: unknown) {
    if (typeof sourceId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    await db.transaction(async (tx) => {
        await lockAuthor(tx, userId)
        const [row] = await tx.select({ id: nitroRushTracks.id, closed: nitroRushTracks.closed, sections: nitroRushTracks.sections, branches: nitroRushTracks.branches })
            .from(nitroRushTracks)
            .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.sourceId, sourceId), isLive))
        if (!row) throw createError({ statusCode: 404, statusMessage: 'Track not published' })
        // Hashed here too, for a course published before road hashes were kept.
        await tx.update(nitroRushTracks).set({ unpublishedAt: new Date(), roadHash: roadHash(row) }).where(eq(nitroRushTracks.id, row.id))
        await pruneHidden(tx, userId)
    })
}

const upCount = sql<number>`(count(*) filter (where ${nitroRushTrackVotes.value} > 0))::int`
const downCount = sql<number>`(count(*) filter (where ${nitroRushTrackVotes.value} < 0))::int`

/** Sets the player's vote on a built-in course or another player's published one to `vote`, so a repeat lands on the same state. */
export async function voteNrTrack(userId: string, trackId: unknown, vote: unknown): Promise<NrTrackVotes & { trackId: string }> {
    if (typeof trackId !== 'string' || trackId.length > TRACK_ID_MAX) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    const builtIn = !!findTrack(trackId)
    if (!builtIn && !isPublishedTrackId(trackId)) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    if (vote !== 1 && vote !== -1 && vote !== 0) throw createError({ statusCode: 400, statusMessage: 'Invalid vote' })
    return db.transaction(async (tx) => {
        if (!builtIn) {
            // Holds a removal off until the vote lands, so a course deleted mid-vote leaves no vote behind; a hidden one keeps its votes anyway.
            const [track] = await tx.select({ authorId: nitroRushTracks.authorId }).from(nitroRushTracks)
                .where(and(eq(nitroRushTracks.id, trackId), isLive)).for('key share')
            if (!track) throw createError({ statusCode: 404, statusMessage: 'Track was removed' })
            if (track.authorId === userId) throw createError({ statusCode: 403, statusMessage: 'Can\'t vote on your own track' })
        }
        if (vote === 0) {
            await tx.delete(nitroRushTrackVotes).where(and(eq(nitroRushTrackVotes.userId, userId), eq(nitroRushTrackVotes.trackId, trackId)))
        } else {
            await tx.insert(nitroRushTrackVotes).values({ userId, trackId, value: vote })
                .onConflictDoUpdate({ target: [nitroRushTrackVotes.userId, nitroRushTrackVotes.trackId], set: { value: vote } })
        }
        const [tally] = await tx.select({ up: upCount, down: downCount }).from(nitroRushTrackVotes).where(eq(nitroRushTrackVotes.trackId, trackId))
        return { trackId, up: tally?.up ?? 0, down: tally?.down ?? 0, myVote: vote }
    })
}

/** Each listed course's votes and the viewer's own, zero for an unvoted one, in one grouped query. */
export async function nrTrackVotes(userId: string, ids: string[]): Promise<Map<string, NrTrackVotes>> {
    if (!ids.length) return new Map()
    const rows = await db.select({
        trackId: nitroRushTrackVotes.trackId,
        up: upCount,
        down: downCount,
        myVote: sql<number>`coalesce(max(${nitroRushTrackVotes.value}) filter (where ${nitroRushTrackVotes.userId} = ${userId}), 0)::int`
    }).from(nitroRushTrackVotes).where(inArray(nitroRushTrackVotes.trackId, ids)).groupBy(nitroRushTrackVotes.trackId)
    const counted = new Map(rows.map(r => [r.trackId, { up: r.up, down: r.down, myVote: Math.sign(r.myVote) as NrVote }]))
    return new Map(ids.map(id => [id, counted.get(id) ?? { up: 0, down: 0, myVote: 0 }]))
}

/**
 * The viewer's own published and unpublished courses, and from everyone else the newest plus the best voted and most played
 * (newest first), each with its record and the viewer's best. The last two are there so TOP and POPULAR reach past the newest.
 */
export async function nrPublishedTracks(userId: string): Promise<{ community: NrPublishedTrack[], mine: NrPublishedTrack[], hidden: NrPublishedTrack[] }> {
    const columns = {
        id: nitroRushTracks.id,
        sourceId: nitroRushTracks.sourceId,
        name: nitroRushTracks.name,
        closed: nitroRushTracks.closed,
        sections: nitroRushTracks.sections,
        branches: nitroRushTracks.branches,
        author: user.name,
        publishedAt: nitroRushTracks.publishedAt,
        unpublishedAt: nitroRushTracks.unpublishedAt
    }
    const select = () => db.select(columns).from(nitroRushTracks).innerJoin(user, eq(user.id, nitroRushTracks.authorId))
    const score = sql<number>`sum(${nitroRushTrackVotes.value})`
    const racers = sql<number>`count(*)`
    const [own, newest, voted, played] = await Promise.all([
        select().where(eq(nitroRushTracks.authorId, userId)),
        select().where(and(ne(nitroRushTracks.authorId, userId), isLive)).orderBy(desc(nitroRushTracks.publishedAt)).limit(COMMUNITY_LIMIT),
        select().innerJoin(nitroRushTrackVotes, eq(nitroRushTrackVotes.trackId, nitroRushTracks.id))
            .where(and(ne(nitroRushTracks.authorId, userId), isLive))
            .groupBy(nitroRushTracks.id, user.id)
            .having(sql`${score} > 0`)
            .orderBy(desc(score), desc(nitroRushTracks.publishedAt))
            .limit(COMMUNITY_LIMIT),
        select().innerJoin(nitroRushPlays, eq(nitroRushPlays.trackId, nitroRushTracks.id))
            .where(and(ne(nitroRushTracks.authorId, userId), isLive, playedLately))
            .groupBy(nitroRushTracks.id, user.id)
            .orderBy(desc(racers), desc(nitroRushTracks.publishedAt))
            .limit(COMMUNITY_LIMIT)
    ])
    const community = [...new Map([...newest, ...voted, ...played].map(t => [t.id, t])).values()]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    const ids = [...own, ...community].map(t => t.id)
    const [summaries, votes] = await Promise.all([nrTrackSummaries(userId, ids), nrTrackVotes(userId, ids)])
    const withSummary = ({ publishedAt: _, unpublishedAt: __, ...t }: typeof own[number]): NrPublishedTrack => ({
        ...t,
        summary: summaries.find(s => s.trackId === t.id)!,
        votes: votes.get(t.id)!
    })
    return {
        community: community.map(withSummary),
        mine: own.filter(t => !t.unpublishedAt).map(withSummary),
        hidden: own.filter(t => t.unpublishedAt).map(withSummary)
    }
}
