import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { nitroRushGhosts, nitroRushLaps, nitroRushTracks, user } from '#server/database/schema'
import { nrTrackSummaries, type NrTrackSummary } from '#server/utils/nitro-rush'
import { compileCustomTrack, isPublishedTrackId, MAX_PUBLISHED_TRACKS, newPublishedTrackId, sameRoad, sanitizeCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

/** Published courses: players' own tracks, raced by everyone on a shared leaderboard. */

/** The newest this many from other players make the community list. */
const COMMUNITY_LIMIT = 100
/** Compiled roads kept in memory; past this the cache starts over. */
const DEF_CACHE_LIMIT = 500

export interface NrPublishedTrack {
    id: string
    /** The author's own copy of the course, which their My Tracks tab matches it to. */
    sourceId: string
    name: string
    closed: boolean
    sections: SectionId[]
    author: string
    summary: NrTrackSummary
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
async function lockAuthor(tx: Tx, userId: string) {
    await tx.execute(sql`select 1 from "user" where id = ${userId} for update`)
}

/** Takes a published course down with every time and ghost set on it. */
async function removeTrack(tx: Tx, id: string) {
    await tx.delete(nitroRushLaps).where(eq(nitroRushLaps.trackId, id))
    await tx.delete(nitroRushGhosts).where(eq(nitroRushGhosts.trackId, id))
    await tx.delete(nitroRushTracks).where(eq(nitroRushTracks.id, id))
}

/**
 * Publishes the player's course, or updates their published copy: a new name keeps its board, a
 * changed road replaces it under a new id. Answers with the published id.
 */
export async function publishNrTrack(userId: string, raw: unknown): Promise<string> {
    const track = sanitizeCustomTrack(raw)
    const name = track?.name.trim()
    if (!track || !name) throw createError({ statusCode: 400, statusMessage: 'Invalid track' })
    if (!compileCustomTrack(track).def) throw createError({ statusCode: 400, statusMessage: 'Finish the track before publishing it' })
    return db.transaction(async (tx) => {
        await lockAuthor(tx, userId)
        const [old] = await tx.select().from(nitroRushTracks)
            .where(and(eq(nitroRushTracks.authorId, userId), eq(nitroRushTracks.sourceId, track.id)))
        if (old && sameRoad({ ...old, id: old.sourceId }, track)) {
            await tx.update(nitroRushTracks).set({ name }).where(eq(nitroRushTracks.id, old.id))
            return old.id
        }
        if (old) {
            await removeTrack(tx, old.id)
        } else {
            const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(nitroRushTracks).where(eq(nitroRushTracks.authorId, userId))
            if ((row?.count ?? 0) >= MAX_PUBLISHED_TRACKS) throw createError({ statusCode: 400, statusMessage: `You can publish up to ${MAX_PUBLISHED_TRACKS} tracks` })
        }
        const id = newPublishedTrackId()
        await tx.insert(nitroRushTracks).values({ id, authorId: userId, sourceId: track.id, name, closed: track.closed, sections: track.sections })
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

/** The viewer's own published courses, and the newest from everyone else, each with its record and the viewer's best. */
export async function nrPublishedTracks(userId: string): Promise<{ community: NrPublishedTrack[], mine: NrPublishedTrack[] }> {
    const columns = {
        id: nitroRushTracks.id,
        sourceId: nitroRushTracks.sourceId,
        name: nitroRushTracks.name,
        closed: nitroRushTracks.closed,
        sections: nitroRushTracks.sections,
        author: user.name
    }
    const select = () => db.select(columns).from(nitroRushTracks).innerJoin(user, eq(user.id, nitroRushTracks.authorId))
    const [mine, community] = await Promise.all([
        select().where(eq(nitroRushTracks.authorId, userId)),
        select().where(ne(nitroRushTracks.authorId, userId)).orderBy(desc(nitroRushTracks.publishedAt)).limit(COMMUNITY_LIMIT)
    ])
    const summaries = await nrTrackSummaries(userId, [...mine, ...community].map(t => t.id))
    const withSummary = (t: typeof mine[number]): NrPublishedTrack => ({ ...t, summary: summaries.find(s => s.trackId === t.id)! })
    return { community: community.map(withSummary), mine: mine.map(withSummary) }
}
