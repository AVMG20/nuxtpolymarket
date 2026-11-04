import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { nitroRushGhosts, nitroRushLaps, nitroRushTrackVotes, nitroRushTracks, user } from '#server/database/schema'
import { nrTrackSummaries, validGhost, type NrGhost, type NrTrackSummary } from '#server/utils/nitro-rush'
import { compileCustomTrack, isPublishedTrackId, MAX_PUBLISHED_TRACKS, newPublishedTrackId, sameRoad, sanitizeCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { decodeGhost } from '#shared/utils/nitro-rush/ghost'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

/** Published courses: players' own tracks, raced by everyone on a shared leaderboard. */

/** The newest this many from other players make the community list, along with this many of the best voted. */
const COMMUNITY_LIMIT = 100
/** Compiled roads kept in memory; past this the cache starts over. */
const DEF_CACHE_LIMIT = 500
/** Longer than any id `newPublishedTrackId` makes. */
const TRACK_ID_MAX = 64
/** Votes carried to a replaced road per insert, well inside Postgres' parameter limit. */
const VOTE_MOVE_CHUNK = 5000

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
    author: string
    summary: NrTrackSummary
    votes: NrTrackVotes
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// A published id never changes road, so its compiled course can be kept.
const defs = new Map<string, TrackDef>()

/** A built-in or published course; null for anything else, a player's private course included. */
export async function nrTrackDef(trackId: unknown): Promise<TrackDef | null> {
    if (typeof trackId !== 'string') return null
    const builtIn = findTrack(trackId)
    if (builtIn || !isPublishedTrackId(trackId)) return builtIn
    const [row] = await db.select({ name: nitroRushTracks.name, closed: nitroRushTracks.closed, sections: nitroRushTracks.sections })
        .from(nitroRushTracks).where(eq(nitroRushTracks.id, trackId))
    if (!row) return null
    const cached = defs.get(trackId)
    if (cached) return cached
    const { def } = compileCustomTrack({ id: trackId, ...row })
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

/** Takes a published course down with every time and ghost set on it; its votes cascade with it. */
async function removeTrack(tx: Tx, id: string) {
    await tx.delete(nitroRushLaps).where(eq(nitroRushLaps.trackId, id))
    await tx.delete(nitroRushGhosts).where(eq(nitroRushGhosts.trackId, id))
    await tx.delete(nitroRushTracks).where(eq(nitroRushTracks.id, id))
}

/** The builder's ghost when it is a lap really driven on `def`'s road, else null. */
function drivenLap(def: TrackDef, ghost: unknown, standing: unknown): NrGhost | null {
    const road = new Track(def)
    // Not from the min-lap cache: `def` has no published id yet, and a dead key there would crowd out live ones.
    const valid = validGhost(def, ghost, standing, Math.ceil(road.minLapSeconds * 1000))
    const decoded = valid && decodeGhost(valid.ghost)
    return valid && decoded && ghostDrivesTrack(road, decoded) ? { ghost: valid.ghost, standing: valid.standing } : null
}

/**
 * Publishes the player's course, or updates their published copy: a new name keeps its board, a changed road
 * replaces it under a new id, starting from the builder's lap and ghost and keeping its votes. Answers with the published id.
 */
export async function publishNrTrack(userId: string, raw: unknown, lap: { ghost?: unknown, standing?: unknown } = {}): Promise<string> {
    const track = sanitizeCustomTrack(raw)
    const name = track?.name.trim()
    if (!track || !name) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    const { def } = compileCustomTrack(track)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Finish the track before publishing it' })
    return db.transaction(async (tx) => {
        await lockAuthor(tx, userId)
        // For update, which a vote's key share waits on: no vote lands on the old road while its votes move.
        const [old] = await tx.select().from(nitroRushTracks)
            .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.sourceId, track.id))).for('update')
        if (old && sameRoad({ ...old, id: old.sourceId }, track)) {
            await tx.update(nitroRushTracks).set({ name }).where(eq(nitroRushTracks.id, old.id))
            return old.id
        }
        if (!old) {
            const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(nitroRushTracks).where(eq(nitroRushTracks.authorId, userId))
            if ((row?.count ?? 0) >= MAX_PUBLISHED_TRACKS) throw createError({ statusCode: 400, statusMessage: `You can publish up to ${MAX_PUBLISHED_TRACKS} tracks` })
        }
        // Only a road new to the board needs a lap; a rename above keeps the one it has.
        const driven = drivenLap(def, lap.ghost, lap.standing)
        if (!driven) throw createError({ statusCode: 400, statusMessage: 'Drive a lap first' })
        const id = newPublishedTrackId()
        // Lifted off before the old road goes, since the new one can't exist beside it (one copy per source course).
        const votes = old
            ? await tx.delete(nitroRushTrackVotes).where(eq(nitroRushTrackVotes.trackId, old.id))
                .returning({ userId: nitroRushTrackVotes.userId, value: nitroRushTrackVotes.value })
            : []
        if (old) await removeTrack(tx, old.id)
        const now = new Date()
        const lapMs = driven.ghost.end
        await tx.insert(nitroRushTracks).values({ id, authorId: userId, sourceId: track.id, name, closed: track.closed, sections: track.sections })
        for (let i = 0; i < votes.length; i += VOTE_MOVE_CHUNK) {
            await tx.insert(nitroRushTrackVotes).values(votes.slice(i, i + VOTE_MOVE_CHUNK).map(v => ({ ...v, trackId: id })))
        }
        await tx.insert(nitroRushLaps).values({ userId, trackId: id, lapMs, setAt: now })
        await tx.insert(nitroRushGhosts).values({ userId, trackId: id, lapMs, standing: driven.standing, ghost: driven.ghost, updatedAt: now })
        return id
    })
}

/** Takes the player's published copy of their course `sourceId` down. */
export async function unpublishNrTrack(userId: string, sourceId: unknown) {
    if (typeof sourceId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    await db.transaction(async (tx) => {
        await lockAuthor(tx, userId)
        const [row] = await tx.select({ id: nitroRushTracks.id }).from(nitroRushTracks)
            .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.sourceId, sourceId)))
        if (!row) throw createError({ statusCode: 404, statusMessage: 'Track not published' })
        await removeTrack(tx, row.id)
    })
}

const upCount = sql<number>`(count(*) filter (where ${nitroRushTrackVotes.value} > 0))::int`
const downCount = sql<number>`(count(*) filter (where ${nitroRushTrackVotes.value} < 0))::int`

/** Sets the player's vote on another player's published course to `vote`, so a repeat lands on the same state. */
export async function voteNrTrack(userId: string, trackId: unknown, vote: unknown): Promise<NrTrackVotes & { trackId: string }> {
    if (typeof trackId !== 'string' || trackId.length > TRACK_ID_MAX || !isPublishedTrackId(trackId)) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    if (vote !== 1 && vote !== -1 && vote !== 0) throw createError({ statusCode: 400, statusMessage: 'Invalid vote' })
    return db.transaction(async (tx) => {
        // Holds an unpublish off until the vote lands, so a course taken down mid-vote is a 404, not a key error.
        const [track] = await tx.select({ authorId: nitroRushTracks.authorId }).from(nitroRushTracks)
            .where(eq(nitroRushTracks.id, trackId)).for('key share')
        if (!track) throw createError({ statusCode: 404, statusMessage: 'Track was removed' })
        if (track.authorId === userId) throw createError({ statusCode: 403, statusMessage: 'Can\'t vote on your own track' })
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

/** Every course's votes and the viewer's own, in one grouped query. */
async function nrTrackVotes(userId: string, ids: string[]): Promise<Map<string, NrTrackVotes>> {
    if (!ids.length) return new Map()
    const rows = await db.select({
        trackId: nitroRushTrackVotes.trackId,
        up: upCount,
        down: downCount,
        myVote: sql<number>`coalesce(max(${nitroRushTrackVotes.value}) filter (where ${nitroRushTrackVotes.userId} = ${userId}), 0)::int`
    }).from(nitroRushTrackVotes).where(inArray(nitroRushTrackVotes.trackId, ids)).groupBy(nitroRushTrackVotes.trackId)
    return new Map(rows.map(r => [r.trackId, { up: r.up, down: r.down, myVote: Math.sign(r.myVote) as NrVote }]))
}

/**
 * The viewer's own published courses, and from everyone else the newest plus the best voted (newest first),
 * each with its record and the viewer's best. The best voted are there so Popular reaches past the newest.
 */
export async function nrPublishedTracks(userId: string): Promise<{ community: NrPublishedTrack[], mine: NrPublishedTrack[] }> {
    const columns = {
        id: nitroRushTracks.id,
        sourceId: nitroRushTracks.sourceId,
        name: nitroRushTracks.name,
        closed: nitroRushTracks.closed,
        sections: nitroRushTracks.sections,
        author: user.name,
        publishedAt: nitroRushTracks.publishedAt
    }
    const select = () => db.select(columns).from(nitroRushTracks).innerJoin(user, eq(user.id, nitroRushTracks.authorId))
    const score = sql<number>`sum(${nitroRushTrackVotes.value})`
    const [mine, newest, voted] = await Promise.all([
        select().where(eq(nitroRushTracks.authorId, userId)),
        select().where(ne(nitroRushTracks.authorId, userId)).orderBy(desc(nitroRushTracks.publishedAt)).limit(COMMUNITY_LIMIT),
        select().innerJoin(nitroRushTrackVotes, eq(nitroRushTrackVotes.trackId, nitroRushTracks.id))
            .where(ne(nitroRushTracks.authorId, userId))
            .groupBy(nitroRushTracks.id, user.id)
            .having(sql`${score} > 0`)
            .orderBy(desc(score), desc(nitroRushTracks.publishedAt))
            .limit(COMMUNITY_LIMIT)
    ])
    const community = [...new Map([...newest, ...voted].map(t => [t.id, t])).values()]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    const ids = [...mine, ...community].map(t => t.id)
    const [summaries, votes] = await Promise.all([nrTrackSummaries(userId, ids), nrTrackVotes(userId, ids)])
    const withSummary = ({ publishedAt: _, ...t }: typeof mine[number]): NrPublishedTrack => ({
        ...t,
        summary: summaries.find(s => s.trackId === t.id)!,
        votes: votes.get(t.id) ?? { up: 0, down: 0, myVote: 0 }
    })
    return { community: community.map(withSummary), mine: mine.map(withSummary) }
}
