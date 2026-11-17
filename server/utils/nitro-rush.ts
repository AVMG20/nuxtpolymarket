import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { nitroRushGhosts, nitroRushLaps, nitroRushPlays } from '#server/database/schema'
import { decodeGhost, replacesGhost, type StoredGhost } from '#shared/utils/nitro-rush/ghost'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'
import { NO_PLAYS, PLAY_WINDOW_DAYS, type TrackPlays } from '#shared/utils/nitro-rush/popularity'

export const NR_LEADERBOARD_TOP = 20
/** Longer than any honest lap, so a stray clock can't land on the board. */
const MAX_LAP_MS = 30 * 60 * 1000

export interface NrBoardRow {
    rank: number
    name: string
    lapMs: number
    you: boolean
}

export interface NrBoard {
    trackId: string
    /** Players with a time on this course. */
    entries: number
    top: NrBoardRow[]
    /** The viewer's own row, also when it sits below the top list; null before their first lap. */
    me: NrBoardRow | null
}

/** One course on the track menu: its record and the viewer's own best. */
export interface NrTrackSummary {
    trackId: string
    entries: number
    /** `mine` follows the board's ranking, so an equal time set later doesn't count as the record. */
    record: { name: string, lapMs: number, mine: boolean } | null
    myLapMs: number | null
    plays: TrackPlays
}

/** The ghost a player races on a course. */
export interface NrGhost {
    ghost: StoredGhost
    standing: boolean
}

/** A lap the server will accept: on a known course (`def`, from `nrTrackDef`) and a time the car could physically set, at least `minLapMs`. */
export function validLap(def: TrackDef | null, lapMs: unknown): { trackId: string, lapMs: number, minLapMs: number } | null {
    if (!def || typeof lapMs !== 'number' || !Number.isInteger(lapMs)) return null
    const minLapMs = nrMinLapMs(def)
    if (lapMs < minLapMs || lapMs > MAX_LAP_MS) return null
    return { trackId: def.id, lapMs, minLapMs }
}

const minLapCache = new Map<string, number>()
/** Published courses come and go; past this many the cache starts over. */
const MIN_LAP_CACHE_LIMIT = 500

// A course id never changes road (a published one gets a new id), so its minimum holds.
function nrMinLapMs(def: TrackDef) {
    let ms = minLapCache.get(def.id)
    if (ms === undefined) {
        ms = Math.ceil(new Track(def).minLapSeconds * 1000)
        if (minLapCache.size >= MIN_LAP_CACHE_LIMIT) minLapCache.clear()
        minLapCache.set(def.id, ms)
    }
    return ms
}

/** A ghost the server will keep: on a known course, one that unpacks, and a lap the car could drive; only a loop has a standing lap. Pass `minLapMs` for a course with no id yet. */
export function validGhost(def: TrackDef | null, ghost: unknown, standing: unknown, minLapMs?: number): NrGhost & { trackId: string } | null {
    if (!def || typeof standing !== 'boolean') return null
    if (standing && def.closed === false) return null
    const decoded = decodeGhost(ghost)
    if (!decoded) return null
    // Only the fields a ghost has, so nothing else rides into the row; the car only as one decode accepted.
    const { v, hz, end, o, d } = ghost as StoredGhost
    if (end < (minLapMs ?? nrMinLapMs(def))) return null
    return { trackId: def.id, ghost: decoded.car ? { v, hz, end, o, d, car: decoded.car } : { v, hz, end, o, d }, standing }
}

/** Keeps a ghost unless the player's is already the one to race; the row lock settles parallel saves on that one. */
export async function saveNrGhost(userId: string, trackId: string, { ghost, standing }: NrGhost) {
    return db.transaction(async (tx) => {
        const now = new Date()
        const [created] = await tx.insert(nitroRushGhosts)
            .values({ userId, trackId, lapMs: ghost.end, standing, ghost, updatedAt: now })
            .onConflictDoNothing()
            .returning({ id: nitroRushGhosts.id })
        if (created) return true
        const mine = and(eq(nitroRushGhosts.userId, userId), eq(nitroRushGhosts.trackId, trackId))
        const [kept] = await tx.select({ lapMs: nitroRushGhosts.lapMs, standing: nitroRushGhosts.standing })
            .from(nitroRushGhosts).where(mine).for('update')
        if (!kept || !replacesGhost({ end: kept.lapMs, standing: kept.standing }, { time: ghost.end, standing })) return false
        await tx.update(nitroRushGhosts).set({ lapMs: ghost.end, standing, ghost, updatedAt: now }).where(mine)
        return true
    })
}

export async function nrGhost(userId: string, trackId: string): Promise<NrGhost | null> {
    const [row] = await db.select({ ghost: nitroRushGhosts.ghost, standing: nitroRushGhosts.standing })
        .from(nitroRushGhosts)
        .where(and(eq(nitroRushGhosts.userId, userId), eq(nitroRushGhosts.trackId, trackId)))
    return row ?? null
}

/** The course record's ghost: the fastest player with one to race; null when that's the viewer, who races their own. */
export interface NrRecordGhost extends NrGhost {
    name: string
    lapMs: number
}

export async function nrRecordGhost(trackId: string, userId: string): Promise<NrRecordGhost | null> {
    const result = await db.execute(sql`
        select l.user_id, u.name, l.lap_ms, g.ghost, g.standing
        from nitro_rush_laps l
        join "user" u on u.id = l.user_id
        join nitro_rush_ghosts g on g.user_id = l.user_id and g.track_id = l.track_id
        where l.track_id = ${trackId}
        order by l.lap_ms asc, l.set_at asc, l.user_id collate "C"
        limit 1
    `)
    const row = result.rows[0] as { user_id: string, name: string, lap_ms: number, ghost: StoredGhost, standing: boolean } | undefined
    if (!row || row.user_id === userId) return null
    return { name: row.name, lapMs: Number(row.lap_ms), ghost: row.ghost, standing: row.standing }
}

/** Counts a finished lap towards the course's popularity, but not within `minLapMs` (its fastest possible lap) of the player's last; one statement, so a burst counts once. */
export async function recordNrPlay(userId: string, trackId: string, minLapMs: number, tx: DbExecutor = db) {
    const rows = await tx.insert(nitroRushPlays).values({ userId, trackId, laps: 1, lastLapAt: new Date() })
        .onConflictDoUpdate({
            target: [nitroRushPlays.userId, nitroRushPlays.trackId],
            set: { laps: sql`${nitroRushPlays.laps} + 1`, lastLapAt: sql`excluded.last_lap_at` },
            // Both sides from this server's clock: the column is zoneless, and now() would bring in the session's zone.
            setWhere: sql`${nitroRushPlays.lastLapAt} < excluded.last_lap_at - make_interval(secs => ${minLapMs / 1000})`
        })
        .returning({ laps: nitroRushPlays.laps })
    return rows.length > 0
}

/** A play inside the popularity window. */
export const playedLately = sql`${nitroRushPlays.lastLapAt} > now() - make_interval(days => ${PLAY_WINDOW_DAYS})`

/** Each course's plays, in one grouped query. */
async function nrTrackPlays(trackIds: string[]): Promise<Map<string, TrackPlays>> {
    const rows = await db.select({
        trackId: nitroRushPlays.trackId,
        racers: sql<number>`(count(*) filter (where ${playedLately}))::int`,
        laps: sql<number>`sum(${nitroRushPlays.laps})::int`
    }).from(nitroRushPlays).where(inArray(nitroRushPlays.trackId, trackIds)).groupBy(nitroRushPlays.trackId)
    return new Map(rows.map(r => [r.trackId, { racers: r.racers, laps: r.laps }]))
}

/** Records a lap; it only replaces the player's entry when quicker, so parallel submits keep the best. */
export async function submitNrLap(userId: string, trackId: string, lapMs: number) {
    const now = new Date()
    const [row] = await db.insert(nitroRushLaps)
        .values({ userId, trackId, lapMs, setAt: now })
        .onConflictDoUpdate({
            target: [nitroRushLaps.userId, nitroRushLaps.trackId],
            set: { lapMs, setAt: now },
            setWhere: sql`${nitroRushLaps.lapMs} > ${lapMs}`
        })
        .returning({ id: nitroRushLaps.id })
    return { improved: !!row }
}

/** A finished lap from `validLap`: a play, and the player's entry if quicker. Answers with the board and the course's plays as they now stand. */
export async function finishNrLap(userId: string, lap: NonNullable<ReturnType<typeof validLap>>) {
    const [{ improved }] = await Promise.all([submitNrLap(userId, lap.trackId, lap.lapMs), recordNrPlay(userId, lap.trackId, lap.minLapMs)])
    const [board, plays] = await Promise.all([nrLeaderboard(lap.trackId, userId), nrTrackPlays([lap.trackId])])
    return { improved, board, plays: plays.get(lap.trackId) ?? NO_PLAYS }
}

export async function nrLeaderboard(trackId: string, userId: string): Promise<NrBoard> {
    const result = await db.execute(sql`
        with ranked as (
            select l.user_id, u.name, l.lap_ms,
                   row_number() over (order by l.lap_ms asc, l.set_at asc, l.user_id collate "C")::int as rank
            from nitro_rush_laps l
            join "user" u on u.id = l.user_id
            where l.track_id = ${trackId}
        )
        select r.user_id, r.name, r.lap_ms, r.rank, (select count(*) from ranked)::int as entries
        from ranked r
        where r.rank <= ${NR_LEADERBOARD_TOP} or r.user_id = ${userId}
        order by r.rank
    `)
    const rows = result.rows as { user_id: string, name: string, lap_ms: number, rank: number, entries: number }[]
    const toRow = (r: typeof rows[number]): NrBoardRow => ({ rank: Number(r.rank), name: r.name, lapMs: Number(r.lap_ms), you: r.user_id === userId })
    const mine = rows.find(r => r.user_id === userId)
    return {
        trackId,
        entries: rows.length ? Number(rows[0]!.entries) : 0,
        top: rows.filter(r => Number(r.rank) <= NR_LEADERBOARD_TOP).map(toRow),
        me: mine ? toRow(mine) : null
    }
}

/** Every course in `trackIds` (all of them by default), in that order; a course nobody has driven gets an empty row. */
export async function nrTrackSummaries(userId: string, trackIds: string[] = TRACKS.map(t => t.id)): Promise<NrTrackSummary[]> {
    if (!trackIds.length) return []
    const [result, plays] = await Promise.all([db.execute(sql`
        with ranked as (
            select l.track_id, l.user_id, u.name, l.lap_ms,
                   row_number() over (partition by l.track_id order by l.lap_ms asc, l.set_at asc, l.user_id collate "C")::int as rank,
                   count(*) over (partition by l.track_id)::int as entries
            from nitro_rush_laps l
            join "user" u on u.id = l.user_id
            where l.track_id in (${sql.join(trackIds.map(id => sql`${id}`), sql`, `)})
        )
        select track_id, user_id, name, lap_ms, rank, entries
        from ranked
        where rank = 1 or user_id = ${userId}
    `), nrTrackPlays(trackIds)])
    const rows = result.rows as { track_id: string, user_id: string, name: string, lap_ms: number, rank: number, entries: number }[]
    return trackIds.map((trackId) => {
        const top = rows.find(r => r.track_id === trackId && Number(r.rank) === 1)
        const mine = rows.find(r => r.track_id === trackId && r.user_id === userId)
        return {
            trackId,
            entries: top ? Number(top.entries) : 0,
            record: top ? { name: top.name, lapMs: Number(top.lap_ms), mine: top.user_id === userId } : null,
            myLapMs: mine ? Number(mine.lap_ms) : null,
            plays: plays.get(trackId) ?? NO_PLAYS
        }
    })
}
